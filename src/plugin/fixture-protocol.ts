import { HelperError as ProtocolError } from '../core/errors.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { extractFile } from '../extractors/index.js';
import type { FileSnapshot } from '../core/contracts.js';
import { fixtures, type FixtureName } from './fixtures.js';

const PROTOCOL_VERSION = 1;
const EXTRACTION_VERSION = 'phase-b-fixtures-1';
const PAGE_SEGMENTS = 32;
const PAGE_CHARACTERS = 12_000;

const fixtureNames = Object.keys(fixtures) as [FixtureName, ...FixtureName[]];
const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ protocolVersion: z.literal(1), operation: z.literal('list-fixtures') }),
  z.strictObject({ protocolVersion: z.literal(1), operation: z.literal('extract-fixture'),
    fixture: z.enum(fixtureNames), cursor: z.number().int().nonnegative().safe().default(0),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
]);

export async function handleFixtureRequest(input: unknown) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new ProtocolError('invalid_request');
  const request = parsed.data;
  if (request.operation === 'list-fixtures') {
    return { protocolVersion: PROTOCOL_VERSION, operation: 'list-fixtures' as const, mode: 'synthetic-only',
      fixtures: fixtureNames, capabilities: ['extract-fixture'], sourceWrites: false };
  }
  const fixture = fixtures[request.fixture];
  const hash = createHash('sha256').update(fixture.source).digest('hex');
  if ((request.cursor > 0 && !request.snapshotHash) ||
      (request.snapshotHash !== undefined && request.snapshotHash !== hash)) {
    throw new ProtocolError('snapshot_mismatch');
  }
  const snapshot: FileSnapshot = {
    id: `fixture_${request.fixture}`, path: `fixtures/${request.fixture}`, sha256: hash,
    format: fixture.format, byteLength: Buffer.byteLength(fixture.source),
    encoding: 'utf8', bom: false, eol: fixture.source.includes('\r\n') ? 'crlf' : 'lf',
  };
  const extraction = await extractFile(fixture.source, snapshot, []);
  const records = extraction.segments.map(segment => ({
    segmentId: segment.id, editable: segment.editableText, readOnlyContext: segment.context,
  }));
  if (request.cursor > records.length) throw new ProtocolError('invalid_cursor');
  const segments: typeof records = [];
  const skipped: { segmentId: string; code: string }[] = [];
  let cursor = request.cursor;
  let characters = 0;
  while (cursor < records.length && segments.length + skipped.length < PAGE_SEGMENTS) {
    const record = records[cursor]!;
    const size = record.editable.length + record.readOnlyContext.reduce((sum, text) => sum + text.length, 0);
    if (size > PAGE_CHARACTERS) {
      skipped.push({ segmentId: record.segmentId, code: 'oversized_segment' });
      cursor += 1;
      continue;
    }
    if (characters + size > PAGE_CHARACTERS) break;
    segments.push(record);
    characters += size;
    cursor += 1;
  }
  return {
    protocolVersion: PROTOCOL_VERSION, operation: 'extract-fixture' as const,
    mode: 'synthetic-only', extractionVersion: EXTRACTION_VERSION,
    fixture: request.fixture, snapshotHash: hash, totalSegments: records.length,
    cursor: request.cursor, nextCursor: cursor < records.length ? cursor : null,
    segments, skipped, characters, diagnostics: extraction.diagnostics, notices: extraction.notices,
    sourceWrites: false,
  };
}
