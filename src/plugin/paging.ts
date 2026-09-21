import type { Segment } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { utf16ToByteOffset } from '../extractors/positions.js';

export const PAGE_SEGMENTS = 32;
export const PAGE_CHARACTERS = 12_000;
export const PAGE_JSON_BYTES = 96 * 1024;
const SEGMENT_CHARACTERS = 10_000;
export type PreparedSegment = { kind: 'segment'; segment: Segment } |
  { kind: 'skipped'; segmentId: string; code: 'oversized_segment' | 'unmappable_segment' };

function sliceSegment(segment: Segment, start: number, end: number, part: number): Segment {
  const spans = segment.sourceMap.flatMap(span => {
    const left = Math.max(start, span.editableStartUtf16);
    const right = Math.min(end, span.editableEndUtf16);
    if (left >= right) return [];
    const text = segment.editableText.slice(span.editableStartUtf16, span.editableEndUtf16);
    if (Buffer.byteLength(text) !== span.source.endByte - span.source.startByte) throw new HelperError('unmappable_segment');
    return [{ editableStartUtf16: left - start, editableEndUtf16: right - start,
      source: { startByte: span.source.startByte + utf16ToByteOffset(text, left - span.editableStartUtf16),
        endByte: span.source.startByte + utf16ToByteOffset(text, right - span.editableStartUtf16) } }];
  });
  if (spans.reduce((sum, span) => sum + span.editableEndUtf16 - span.editableStartUtf16, 0) !== end - start) {
    throw new HelperError('unmappable_segment');
  }
  return { ...segment, id: `${segment.id}_p${part}`, editableText: segment.editableText.slice(start, end), sourceMap: spans,
    protectedRanges: segment.protectedRanges.filter(range => spans.some(span =>
      range.startByte < span.source.endByte && range.endByte > span.source.startByte)),
    context: segment.context.map(text => text.slice(0, 500)),
  };
}

export function prepareSegments(segments: readonly Segment[]): PreparedSegment[] {
  return segments.flatMap((segment): PreparedSegment[] => {
    if (segment.editableText.length <= SEGMENT_CHARACTERS) return [{ kind: 'segment', segment }];
    const boundaries = [...segment.editableText.matchAll(/(?:[.!?]["')\]]*\s+|(?:\r?\n|\r(?!\n)){2,})/gu)]
      .map(match => match.index + match[0].length);
    const result: PreparedSegment[] = [];
    let start = 0;
    while (start < segment.editableText.length) {
      let end = segment.editableText.length;
      if (end - start > SEGMENT_CHARACTERS) {
        const candidates = boundaries.filter(offset => offset > start && offset <= start + SEGMENT_CHARACTERS);
        end = candidates.reverse().find(offset => {
          const span = segment.sourceMap.find(item => offset >= item.editableStartUtf16 && offset <= item.editableEndUtf16);
          if (!span) return false;
          const text = segment.editableText.slice(span.editableStartUtf16, span.editableEndUtf16);
          const byte = span.source.startByte + utf16ToByteOffset(text, offset - span.editableStartUtf16);
          return !segment.protectedRanges.some(range => byte > range.startByte && byte < range.endByte);
        }) ?? start;
      }
      // Never return just the beginning of a segment whose remainder is unsafe.
      if (end === start) return [{ kind: 'skipped', segmentId: segment.id, code: 'oversized_segment' }];
      try { result.push({ kind: 'segment', segment: sliceSegment(segment, start, end, result.length + 1) }); }
      catch { return [{ kind: 'skipped', segmentId: segment.id, code: 'unmappable_segment' }]; }
      start = end;
    }
    return result;
  });
}

export function pageRecords<T>(records: readonly T[], cursor: number, characters: (record: T) => number = () => 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > records.length) throw new HelperError('invalid_cursor');
  const items: T[] = [];
  let usedCharacters = 0;
  let usedBytes = 0;
  let next = cursor;
  while (next < records.length && items.length < PAGE_SEGMENTS) {
    const record = records[next]!;
    const size = characters(record);
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (size > PAGE_CHARACTERS || bytes > PAGE_JSON_BYTES) throw new HelperError('record_too_large');
    if (usedCharacters + size > PAGE_CHARACTERS || usedBytes + bytes > PAGE_JSON_BYTES) break;
    items.push(record);
    usedCharacters += size;
    usedBytes += bytes;
    next += 1;
  }
  return { items, cursor, nextCursor: next < records.length ? next : null, characters: usedCharacters };
}
