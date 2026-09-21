import { z } from 'zod';
import { countSchema, hashSchema, invocationPreferencesSchema, relativePathSchema } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { loadPreferences, resolveProjectRoot } from '../discovery/config.js';
import { discover, extractLocalFile, sha256 } from '../discovery/discover.js';
import { assertChain, inspectPath } from '../discovery/filesystem.js';
import { handleFixtureRequest } from './fixture-protocol.js';
import { pageRecords } from './paging.js';

export { PAGE_SEGMENTS, PAGE_CHARACTERS } from './paging.js';
export { HelperError as ProtocolError } from '../core/errors.js';
export const PROTOCOL_VERSION = 2;
export const EXTRACTION_VERSION = 'phase-b-1';
export const POLICY_VERSION = 'phase-b-1';
export const MAX_REQUEST_BYTES = 64 * 1024;
const shared = {
  protocolVersion: z.literal(2), root: z.string().min(1).max(4096),
  preferences: invocationPreferencesSchema.default({}), cursor: countSchema.default(0),
  policyHash: hashSchema.optional(),
};
const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...shared, operation: z.literal('discover'),
    targets: z.array(z.union([z.literal('.'), relativePathSchema])).max(256).default(['.']),
    scopeHash: hashSchema.optional(),
  }),
  z.strictObject({ ...shared, operation: z.literal('extract'), path: relativePathSchema,
    snapshotHash: hashSchema.optional(),
  }),
]);

export async function handleRequest(input: unknown) {
  // Preserve Phase A's synthetic-only protocol as a qualification probe. It
  // cannot accept roots, user source, project preferences, or write requests.
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input && input.protocolVersion === 1) {
    return handleFixtureRequest(input);
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new HelperError('invalid_request');
  const request = parsed.data;
  const root = await resolveProjectRoot(request.root);
  const identity = await inspectPath(root);
  const preferences = await loadPreferences(root, request.preferences);
  const policyHash = sha256(JSON.stringify({ root, preferences, version: POLICY_VERSION, extraction: EXTRACTION_VERSION }));
  if ((request.cursor > 0 && !request.policyHash) || (request.policyHash && request.policyHash !== policyHash)) {
    throw new HelperError('policy_mismatch');
  }
  const common = { protocolVersion: PROTOCOL_VERSION, mode: 'offline-preview' as const,
    extractionVersion: EXTRACTION_VERSION, policyVersion: POLICY_VERSION, policyHash, sourceWrites: false };
  if (request.operation === 'discover') {
    const records = await discover({ root, paths: request.targets, preferences });
    const scopeHash = sha256(JSON.stringify({ records, policyHash }));
    if ((request.cursor > 0 && !request.scopeHash) || (request.scopeHash && request.scopeHash !== scopeHash)) {
      throw new HelperError('scope_mismatch');
    }
    await assertChain(identity.chain);
    const summary = {
      filesEligible: records.filter(item => item.state === 'eligible').length,
      pathsSkipped: records.filter(item => item.state === 'skipped').length,
      pathsFailed: records.filter(item => item.state === 'failed').length,
      eligibleSegments: records.reduce((sum, item) => sum + (item.coverage?.eligibleSegments ?? 0), 0),
      skippedSegments: records.reduce((sum, item) => sum + (item.coverage?.skippedSegments ?? 0), 0),
      diagnosticCount: records.reduce((sum, item) => sum + (item.coverage?.diagnostics ?? 0), 0),
      noticeCount: records.reduce((sum, item) => sum + (item.coverage?.notices ?? 0), 0),
      reviewedSegments: 0, filesChanged: 0,
    };
    return { ...common, operation: 'discover' as const, scopeHash, totalRecords: records.length, summary,
      status: summary.pathsFailed ? 'incomplete' : summary.eligibleSegments ? 'preview' : 'no_eligible_text',
      ...pageRecords(records, request.cursor) };
  }
  const file = await extractLocalFile(root, request.path, preferences);
  if ((request.cursor > 0 && !request.snapshotHash) || (request.snapshotHash && request.snapshotHash !== file.snapshot.sha256)) {
    throw new HelperError('snapshot_mismatch');
  }
  const records = [
    ...file.prepared.map(item => item.kind === 'segment'
      ? { kind: 'segment' as const, segmentId: item.segment.id, editable: item.segment.editableText, readOnlyContext: item.segment.context }
      : item),
    ...file.diagnostics.map(item => ({ kind: 'diagnostic' as const, ...item })),
    ...file.notices.map(code => ({ kind: 'notice' as const, code })),
  ];
  await assertChain(identity.chain);
  return { ...common, operation: 'extract' as const, path: request.path,
    snapshot: file.snapshot, snapshotHash: file.snapshot.sha256, coverage: file.coverage,
    dialect: preferences.dialect, totalRecords: records.length, totalSegments: file.prepared.length,
    ...pageRecords(records, request.cursor, record => record.kind === 'segment'
      ? record.editable.length + record.readOnlyContext.reduce((sum, context) => sum + context.length, 0) : 0),
  };
}
