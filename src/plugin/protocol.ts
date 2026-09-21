import { z } from 'zod';
import { countSchema, hashSchema, invocationPreferencesSchema, relativePathSchema,
  segmentResponseSchema } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { loadPreferences, resolveProjectRoot } from '../discovery/config.js';
import { discover, extractLocalFile, sha256 } from '../discovery/discover.js';
import { assertChain, inspectPath, targetPath } from '../discovery/filesystem.js';
import { handleFixtureRequest } from './fixture-protocol.js';
import { pageRecords } from './paging.js';
import { validateResponses } from '../editing/validate.js';
import { atomicReplace, withProjectWriteLock } from '../editing/write.js';
import type { DiscoveryEntry } from '../discovery/discover.js';

export { PAGE_SEGMENTS, PAGE_CHARACTERS } from './paging.js';
export { HelperError as ProtocolError } from '../core/errors.js';
export const PROTOCOL_VERSION = 2;
export const EXTRACTION_VERSION = 'phase-c-1';
export const POLICY_VERSION = 'phase-c-1';
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const countByCode = (records: readonly DiscoveryEntry[], state: DiscoveryEntry['state']) => Object.fromEntries(
  [...records.reduce((counts, item) => {
    if (item.state === state) counts.set(item.code ?? 'unknown', (counts.get(item.code ?? 'unknown') ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)),
);
const noEligibleTextReason = (records: readonly DiscoveryEntry[]) => {
  const eligible = records.filter(item => item.state === 'eligible');
  if (eligible.some(item => (item.coverage?.suppressedSegments ?? 0) > 0)) return 'all_prose_suppressed';
  if (eligible.length > 0) return eligible.some(item => (item.coverage?.skippedSegments ?? 0) > 0)
    ? 'prose_unavailable' : 'no_extractable_prose';
  const skippedCodes = records.filter(item => item.state === 'skipped').map(item => item.code);
  if (records.some(item => item.state === 'failed')) return 'extraction_failure';
  if (skippedCodes.some(code => code === 'invalid_utf8' || code === 'binary')) return 'unsupported_encoding';
  if (skippedCodes.includes('too_large')) return 'oversized_files';
  if (skippedCodes.length > 0 && skippedCodes.every(code => code === 'unsupported_format' || code === 'plain_text_unsupported')) {
    return 'no_supported_file_types';
  }
  return skippedCodes.length > 0 ? 'all_candidates_excluded' : 'empty_scope';
};
const shared = {
  protocolVersion: z.literal(2), root: z.string().min(1).max(4096),
  preferences: invocationPreferencesSchema.default({}), cursor: countSchema.default(0),
  policyHash: hashSchema.optional(),
};
const editShared = {
  protocolVersion: z.literal(2), root: z.string().min(1).max(4096),
  preferences: invocationPreferencesSchema.default({}), path: relativePathSchema,
  policyHash: hashSchema, snapshotHash: hashSchema,
  responses: z.array(segmentResponseSchema).max(10_000),
};
const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...shared, operation: z.literal('discover'),
    targets: z.array(z.union([z.literal('.'), relativePathSchema])).max(256).default(['.']),
    scopeHash: hashSchema.optional(),
  }),
  z.strictObject({ ...shared, operation: z.literal('extract'), path: relativePathSchema,
    snapshotHash: hashSchema.optional(),
  }),
  z.strictObject({ ...editShared, operation: z.literal('validate-file') }),
  z.strictObject({ ...editShared, operation: z.literal('apply-file') }),
]);

const policyDigest = (root: string, preferences: unknown) =>
  sha256(JSON.stringify({ root, preferences, version: POLICY_VERSION, extraction: EXTRACTION_VERSION }));

export async function handleRequest(input: unknown, signal?: AbortSignal) {
  // Preserve Phase A's synthetic-only protocol as a qualification probe. It
  // cannot accept roots, user source, project preferences, or write requests.
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input && input.protocolVersion === 1) {
    return handleFixtureRequest(input);
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const invalidGlossaryIndexes = [...new Set(parsed.error.issues.flatMap(issue => {
      const glossary = issue.path.indexOf('glossary');
      const index = glossary >= 0 ? issue.path[glossary + 1] : undefined;
      return typeof index === 'number' ? [index] : [];
    }))].sort((left, right) => left - right);
    if (invalidGlossaryIndexes.length > 0) {
      throw new HelperError('invalid_glossary', { invalidGlossaryIndexes });
    }
    throw new HelperError('invalid_request');
  }
  const request = parsed.data;
  const root = await resolveProjectRoot(request.root);
  const identity = await inspectPath(root);
  const preferences = await loadPreferences(root, request.preferences);
  const policyHash = policyDigest(root, preferences);
  if ((request.operation === 'discover' || request.operation === 'extract') &&
      ((request.cursor > 0 && !request.policyHash) || (request.policyHash && request.policyHash !== policyHash))) {
    throw new HelperError('policy_mismatch');
  }
  const common = { protocolVersion: PROTOCOL_VERSION,
    extractionVersion: EXTRACTION_VERSION, policyVersion: POLICY_VERSION, policyHash };
  if (request.operation === 'discover') {
    const records = await discover({ root, paths: request.targets, preferences });
    const scopeHash = sha256(JSON.stringify({ records, policyHash }));
    if ((request.cursor > 0 && !request.scopeHash) || (request.scopeHash && request.scopeHash !== scopeHash)) {
      throw new HelperError('scope_mismatch');
    }
    await assertChain(identity.chain);
    const byFormat = Object.fromEntries([...records.reduce((formats, item) => {
      if (item.state !== 'eligible' || !item.snapshot || !item.coverage) return formats;
      const value = formats.get(item.snapshot.format) ?? { files: 0, eligibleSegments: 0, skippedSegments: 0, suppressedSegments: 0 };
      value.files += 1;
      value.eligibleSegments += item.coverage.eligibleSegments;
      value.skippedSegments += item.coverage.skippedSegments;
      value.suppressedSegments += item.coverage.suppressedSegments;
      formats.set(item.snapshot.format, value);
      return formats;
    }, new Map<string, { files: number; eligibleSegments: number; skippedSegments: number; suppressedSegments: number }>())]
      .sort(([left], [right]) => left.localeCompare(right)));
    const filesConsidered = records.filter(item => item.pathType === 'file').length;
    const filesEligible = records.filter(item => item.state === 'eligible').length;
    const summary = {
      filesEligible,
      filesConsidered,
      pathsSkipped: records.filter(item => item.state === 'skipped').length,
      pathsFailed: records.filter(item => item.state === 'failed').length,
      eligibleSegments: records.reduce((sum, item) => sum + (item.coverage?.eligibleSegments ?? 0), 0),
      skippedSegments: records.reduce((sum, item) => sum + (item.coverage?.skippedSegments ?? 0), 0),
      suppressedSegments: records.reduce((sum, item) => sum + (item.coverage?.suppressedSegments ?? 0), 0),
      diagnosticCount: records.reduce((sum, item) => sum + (item.coverage?.diagnostics ?? 0), 0),
      noticeCount: records.reduce((sum, item) => sum + (item.coverage?.notices ?? 0), 0),
      byFormat,
      skippedByReason: countByCode(records, 'skipped'),
      failedByReason: countByCode(records, 'failed'),
      narrowCoverage: filesEligible === 0 || (filesConsidered >= 10 && filesEligible / filesConsidered < 0.5),
      reviewedSegments: 0, filesChanged: 0,
    };
    const status = summary.pathsFailed ? 'incomplete' : summary.eligibleSegments ? 'preview' : 'no_eligible_text';
    return { ...common, mode: 'offline-preview' as const, sourceWrites: false,
      operation: 'discover' as const, scopeHash, totalRecords: records.length, summary,
      status, noEligibleTextReason: summary.eligibleSegments === 0 ? noEligibleTextReason(records) : undefined,
      effectiveScope: { root, targets: request.targets, dialect: preferences.dialect,
        includeHidden: preferences.includeHidden, glossary: preferences.glossary },
      ...pageRecords(records, request.cursor) };
  }
  if (request.operation === 'validate-file' || request.operation === 'apply-file') {
    if (request.policyHash !== policyHash) throw new HelperError('policy_mismatch');
    const processFile = async () => {
      const currentPreferences = await loadPreferences(root, request.preferences);
      if (policyDigest(root, currentPreferences) !== request.policyHash) throw new HelperError('policy_mismatch');
      const file = await extractLocalFile(root, request.path, currentPreferences);
      if (file.snapshot.sha256 !== request.snapshotHash) throw new HelperError('snapshot_mismatch');
      const validation = await validateResponses({ snapshot: file.snapshot, source: file.source,
        extraction: { segments: file.segments, suppressedSegments: file.suppressedSegments,
          diagnostics: file.diagnostics, notices: file.notices },
        prepared: file.prepared, responses: request.responses, glossary: currentPreferences.glossary });
      return { file, validation, currentPreferences };
    };
    if (request.operation === 'validate-file') {
      const { file, validation } = await processFile();
      await assertChain(identity.chain);
      return { ...common, mode: 'correction-preview' as const, sourceWrites: false,
        operation: 'validate-file' as const, path: request.path, snapshotHash: file.snapshot.sha256,
        status: 'validated' as const, reviewedSegments: request.responses.length,
        acceptedCount: validation.accepted.length, accepted: validation.accepted,
        filesChanged: 0, dialect: preferences.dialect, glossary: preferences.glossary };
    }
    return withProjectWriteLock(root, signal, async logDirectory => {
      const { file, validation } = await processFile();
      if (validation.accepted.length === 0) {
        await assertChain(identity.chain);
        return { ...common, mode: 'correction' as const, sourceWrites: false,
          operation: 'apply-file' as const, path: request.path, snapshotHash: file.snapshot.sha256,
          status: 'unchanged' as const, reviewedSegments: request.responses.length,
          acceptedCount: 0, filesChanged: 0, dialect: preferences.dialect, glossary: preferences.glossary };
      }
      const absolute = targetPath(root, request.path);
      await atomicReplace({ absolute, relative: request.path, expectedHash: file.snapshot.sha256,
        candidate: validation.candidateBytes, candidateHash: validation.candidateHash,
        proposalCount: validation.accepted.length, logDirectory, ...(signal ? { signal } : {}),
        beforeReplace: async () => {
          const finalPreferences = await loadPreferences(root, request.preferences);
          if (policyDigest(root, finalPreferences) !== request.policyHash) throw new HelperError('policy_mismatch');
          const finalFile = await extractLocalFile(root, request.path, finalPreferences);
          if (finalFile.snapshot.sha256 !== request.snapshotHash) throw new HelperError('snapshot_mismatch');
        } });
      return { ...common, mode: 'correction' as const, sourceWrites: true,
        operation: 'apply-file' as const, path: request.path, snapshotHash: file.snapshot.sha256,
        afterHash: validation.candidateHash, status: 'changed' as const,
        reviewedSegments: request.responses.length, acceptedCount: validation.accepted.length,
        categories: Object.fromEntries([...validation.accepted.reduce((counts, proposal) => {
          counts.set(proposal.category, (counts.get(proposal.category) ?? 0) + 1); return counts;
        }, new Map<string, number>())].sort()), filesChanged: 1,
        dialect: preferences.dialect, glossary: preferences.glossary };
    });
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
  return { ...common, mode: 'offline-preview' as const, sourceWrites: false,
    operation: 'extract' as const, path: request.path,
    snapshot: file.snapshot, snapshotHash: file.snapshot.sha256, coverage: file.coverage,
    dialect: preferences.dialect, glossary: preferences.glossary,
    totalRecords: records.length, totalSegments: file.prepared.length,
    ...pageRecords(records, request.cursor, record => record.kind === 'segment'
      ? record.editable.length + record.readOnlyContext.reduce((sum, context) => sum + context.length, 0) : 0),
  };
}
