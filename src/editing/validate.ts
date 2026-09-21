import { createHash } from 'node:crypto';
import { MAX_FILE_BYTES, type FileSnapshot, type Proposal, type Segment, type SegmentResponse } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { extractFile } from '../extractors/index.js';
import { utf16ToByteOffset } from '../extractors/positions.js';
import type { ExtractionResult } from '../extractors/types.js';
import type { PreparedSegment } from '../plugin/paging.js';

export type AcceptedProposal = Proposal & { segmentId: string };
type ByteEdit = AcceptedProposal & { startByte: number; endByte: number };

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const lineBreaks = (value: string) => value.match(/\r\n|\r|\n/gu) ?? [];
const edgeWhitespace = (value: string) => [value.match(/^\s*/u)?.[0] ?? '', value.match(/\s*$/u)?.[0] ?? ''];

function count(value: string, token: string) {
  let result = 0;
  for (let offset = 0; (offset = value.indexOf(token, offset)) >= 0; offset += token.length) result += 1;
  return result;
}

function assertSafeReplacement(original: string, replacement: string, format: FileSnapshot['format']) {
  if (original === replacement) throw new HelperError('unchanged_proposal');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(replacement)) {
    throw new HelperError('unsafe_replacement');
  }
  const originalEdges = edgeWhitespace(original);
  const replacementEdges = edgeWhitespace(replacement);
  if (originalEdges[0] !== replacementEdges[0] || originalEdges[1] !== replacementEdges[1]) {
    throw new HelperError('whitespace_changed');
  }
  if (JSON.stringify(lineBreaks(original)) !== JSON.stringify(lineBreaks(replacement))) {
    throw new HelperError('line_structure_changed');
  }
  if (replacement.length > original.length * 2 + 64 || Math.abs(replacement.length - original.length) > 128) {
    throw new HelperError('replacement_too_large');
  }
  const tokens = format === 'markdown'
    ? ['`', '[', ']', '(', ')', '{', '}', '<', '>', '#', '*', '_', '~', '!', '|', '\\']
    : ['/*', '*/', '//', '```', '\\'];
  if (format === 'python') tokens.push("'''", '"""');
  for (const token of tokens) {
    if (count(original, token) !== count(replacement, token)) throw new HelperError('unsafe_delimiter_change');
  }
}

function uniqueOffset(text: string, original: string) {
  const first = text.indexOf(original);
  if (first < 0) throw new HelperError('original_not_found');
  if (text.indexOf(original, first + 1) >= 0) throw new HelperError('ambiguous_original');
  return first;
}

function mappedRange(segment: Segment, start: number, end: number) {
  const span = segment.sourceMap.find(item => start >= item.editableStartUtf16 && end <= item.editableEndUtf16);
  if (!span) throw new HelperError('unmappable_proposal');
  const mapped = segment.editableText.slice(span.editableStartUtf16, span.editableEndUtf16);
  return {
    startByte: span.source.startByte + utf16ToByteOffset(mapped, start - span.editableStartUtf16),
    endByte: span.source.startByte + utf16ToByteOffset(mapped, end - span.editableStartUtf16),
  };
}

function sameExtractionShape(before: ExtractionResult, after: ExtractionResult) {
  const shape = (value: ExtractionResult) => JSON.stringify({
    segments: value.segments.length,
    suppressedSegments: value.suppressedSegments,
    diagnostics: value.diagnostics,
    notices: [...value.notices].sort(),
  });
  return shape(before) === shape(after);
}

export async function validateResponses(options: {
  snapshot: FileSnapshot;
  source: string;
  extraction: ExtractionResult;
  prepared: readonly PreparedSegment[];
  responses: readonly SegmentResponse[];
  glossary: readonly string[];
}) {
  const eligible = options.prepared.flatMap(item => item.kind === 'segment' ? [item.segment] : []);
  const expected = new Map(eligible.map(segment => [segment.id, segment]));
  const received = new Map<string, SegmentResponse>();
  for (const response of options.responses) {
    if (received.has(response.segmentId)) throw new HelperError('duplicate_segment_response');
    if (!expected.has(response.segmentId)) throw new HelperError('unknown_segment_response');
    received.set(response.segmentId, response);
  }
  if (received.size !== expected.size) throw new HelperError('incomplete_segment_responses', {
    expectedSegments: expected.size, receivedSegments: received.size,
  });

  const sourceBytes = Buffer.from(options.source, 'utf8');
  const edits: ByteEdit[] = [];
  for (const segment of eligible) {
    const response = received.get(segment.id)!;
    for (const proposal of response.proposals) {
      assertSafeReplacement(proposal.original, proposal.replacement, options.snapshot.format);
      const start = uniqueOffset(segment.editableText, proposal.original);
      const range = mappedRange(segment, start, start + proposal.original.length);
      if (segment.protectedRanges.some(item => range.startByte < item.endByte && range.endByte > item.startByte)) {
        throw new HelperError('protected_range');
      }
      if (sourceBytes.subarray(range.startByte, range.endByte).toString('utf8') !== proposal.original) {
        throw new HelperError('source_mapping_mismatch');
      }
      edits.push({ ...proposal, segmentId: segment.id, ...range });
    }
  }
  edits.sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte);
  for (let index = 1; index < edits.length; index += 1) {
    if (edits[index]!.startByte < edits[index - 1]!.endByte) throw new HelperError('overlapping_proposals');
  }

  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const edit of edits) {
    pieces.push(sourceBytes.subarray(cursor, edit.startByte), Buffer.from(edit.replacement, 'utf8'));
    cursor = edit.endByte;
  }
  pieces.push(sourceBytes.subarray(cursor));
  const candidateBytes = Buffer.concat(pieces);
  if (candidateBytes.length > MAX_FILE_BYTES) throw new HelperError('candidate_too_large');
  const candidate = candidateBytes.toString('utf8');
  if (candidate.startsWith('\uFEFF') !== options.source.startsWith('\uFEFF') ||
      /(?:\r\n|\r|\n)$/u.test(candidate) !== /(?:\r\n|\r|\n)$/u.test(options.source)) {
    throw new HelperError('file_structure_changed');
  }
  const candidateSnapshot = { ...options.snapshot, sha256: hash(candidateBytes), byteLength: candidateBytes.length };
  let candidateExtraction: ExtractionResult;
  try { candidateExtraction = await extractFile(candidate, candidateSnapshot, options.glossary); }
  catch { throw new HelperError('candidate_parse_failed'); }
  if (candidateExtraction.diagnostics.some(item => item.code === 'parse_error' || item.code === 'parse_failed') ||
      !sameExtractionShape(options.extraction, candidateExtraction)) {
    throw new HelperError('structural_invariant_failed');
  }
  return {
    candidateBytes,
    candidateHash: candidateSnapshot.sha256,
    accepted: edits.map(({ startByte: _start, endByte: _end, ...proposal }) => proposal),
  };
}
