import type { Segment } from '../core/contracts.js';
import { sourceRange } from './positions.js';

const protectedPatterns = [
  /https?:\/\/[^\s)\]}>,]+/gu,
  /(?:\.\.?\/|\/)[A-Za-z0-9._~/-]+/gu,
  /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/gu,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
  /\{\{[^{}\r\n]+\}\}|\$\{[^{}\r\n]+\}|%\([^)\r\n]+\)s/gu,
  /<[A-Z][A-Z0-9_-]*>/gu,
  /--[a-z0-9][a-z0-9-]*/giu,
  /@[a-z0-9._-]+\/[a-z0-9._-]+/giu,
  /\b(?:[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8})\b/gu,
  /\b[A-Za-z_$][A-Za-z0-9_$]*\(\)/gu,
];

function rangesFor(text: string, source: string, sourceStartUtf16: number, glossary: readonly string[]) {
  const ranges: { startByte: number; endByte: number }[] = [];
  const add = (start: number, end: number) => ranges.push(sourceRange(source, sourceStartUtf16 + start, sourceStartUtf16 + end));
  for (const pattern of protectedPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length);
  }
  for (const term of glossary) {
    let offset = 0;
    while (term && (offset = text.indexOf(term, offset)) >= 0) {
      add(offset, offset + term.length);
      offset += term.length;
    }
  }
  ranges.sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte);
  return ranges.filter((range, index) => index === 0 || range.startByte !== ranges[index - 1]!.startByte || range.endByte !== ranges[index - 1]!.endByte);
}

export function makeSegment(
  id: string,
  snapshotId: string,
  source: string,
  startUtf16: number,
  endUtf16: number,
  glossary: readonly string[],
  context: string[] = [],
): Segment | undefined {
  const editableText = source.slice(startUtf16, endUtf16);
  if (!/\p{L}/u.test(editableText)) return undefined;
  const sourceSpan = sourceRange(source, startUtf16, endUtf16);
  const protectedRanges = rangesFor(editableText, source, startUtf16, glossary);
  if (protectedRanges.some(range => range.startByte === sourceSpan.startByte && range.endByte === sourceSpan.endByte)) return undefined;
  return {
    id, snapshotId, editableText,
    sourceMap: [{ editableStartUtf16: 0, editableEndUtf16: editableText.length, source: sourceSpan }],
    protectedRanges,
    context,
  };
}
