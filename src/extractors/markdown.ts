import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { displayPosition } from './positions.js';
import { makeSegment } from './protection.js';
import type { ExtractInput, ExtractionDiagnostic, ExtractionResult } from './types.js';

type Position = { start: { offset?: number; line: number }; end: { offset?: number; line: number } };
type MdNode = { type: string; value?: string; alt?: string | null; position?: Position; children?: MdNode[] };
const DISALLOWED_CONTAINERS = new Set(['code', 'inlineCode', 'html', 'definition', 'yaml']);
const DIRECTIVE = /^<!--\s*(spellagent-(?:disable|enable|disable-next-line))\s*-->$/u;

function frontmatterEnd(source: string): number | undefined {
  const opening = /^---(?:\r\n|\r|\n)/u.exec(source);
  if (!opening) return undefined;
  const match = /^(?:---|\.\.\.)(?:\r\n|\r|\n|$)/mu.exec(source.slice(opening[0].length));
  return match ? opening[0].length + match.index + match[0].length : undefined;
}

function directives(root: MdNode, lineCount: number) {
  const entries: { kind: string; line: number }[] = [];
  const html: { text: string; start: number }[] = [];
  const visit = (node: MdNode) => {
    if (node.type === 'html' && node.value !== undefined && node.position?.start.offset !== undefined) {
      html.push({ text: node.value, start: node.position.start.offset });
      const match = node.value.trim().match(DIRECTIVE);
      if (match) entries.push({ kind: match[1]!, line: node.position.start.line });
    }
    node.children?.forEach(visit);
  };
  visit(root);
  const disabled = new Set<number>();
  const diagnostics: ExtractionDiagnostic[] = [];
  let from: number | undefined;
  for (const entry of entries.sort((a, b) => a.line - b.line)) {
    if (entry.kind === 'spellagent-disable-next-line') disabled.add(entry.line + 1);
    else if (entry.kind === 'spellagent-disable') {
      if (from === undefined) from = entry.line;
      else diagnostics.push({ code: 'nested_disable', line: entry.line });
    } else if (from === undefined) diagnostics.push({ code: 'unmatched_enable', line: entry.line });
    else {
      for (let line = from; line <= entry.line; line += 1) disabled.add(line);
      from = undefined;
    }
  }
  if (from !== undefined) {
    for (let line = from; line <= lineCount; line += 1) disabled.add(line);
    diagnostics.push({ code: 'disable_to_eof', line: from });
  }
  return { disabled, diagnostics, html };
}

// Remark text nodes can span several physical lines. Splitting only at line
// boundaries where the suppression status actually changes keeps ordinary
// multi-line paragraphs as one segment while still letting a `disable`
// boundary that lands mid-node suppress exactly the lines it covers.
function lineParts(source: string, start: number, end: number): { start: number; end: number }[] {
  const parts: { start: number; end: number }[] = [];
  const NEWLINE = /\r\n|\r|\n/gu;
  NEWLINE.lastIndex = start;
  let cursor = start;
  let match: RegExpExecArray | null;
  while (cursor < end && (match = NEWLINE.exec(source)) && match.index < end) {
    const lineEnd = match.index + match[0].length;
    parts.push({ start: cursor, end: Math.min(lineEnd, end) });
    cursor = lineEnd;
    NEWLINE.lastIndex = cursor;
  }
  if (cursor < end) parts.push({ start: cursor, end });
  return parts;
}

function mergeByDisabledStatus(source: string, parts: readonly { start: number; end: number }[], disabled: Set<number>) {
  const merged: { start: number; end: number; disabled: boolean }[] = [];
  for (const part of parts) {
    const status = disabled.has(displayPosition(source, part.start).line);
    const last = merged.at(-1);
    if (last && last.disabled === status) last.end = part.end;
    else merged.push({ start: part.start, end: part.end, disabled: status });
  }
  return merged;
}

export function markdownCommentTexts(source: string): { text: string; start: number }[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(source) as MdNode;
  return directives(root, 0).html;
}

export function extractMarkdown(input: ExtractInput): ExtractionResult {
  const root = unified().use(remarkParse).use(remarkGfm).parse(input.source) as MdNode;
  const policy = directives(root, input.source.split(/\r\n|\r|\n/u).length);
  const frontmatter = frontmatterEnd(input.source);
  const ranges: { start: number; end: number; heading: boolean }[] = [];
  const protectedLines = new Set<number>();
  const visit = (node: MdNode, ancestors: readonly MdNode[]) => {
    if (DISALLOWED_CONTAINERS.has(node.type)) {
      if (node.position) protectedLines.add(node.position.start.line);
      return;
    }
    const position = node.position;
    const blocked = ancestors.some(parent => DISALLOWED_CONTAINERS.has(parent.type));
    if (!blocked && node.type === 'text' && position?.start.offset !== undefined && position.end.offset !== undefined) {
      ranges.push({ start: position.start.offset, end: position.end.offset, heading: ancestors.some(parent => parent.type === 'heading') });
    }
    if (!blocked && (node.type === 'image' || node.type === 'imageReference') && node.alt && position?.start.offset !== undefined && position.end.offset !== undefined) {
      const raw = input.source.slice(position.start.offset, position.end.offset);
      const open = raw.indexOf('![');
      const close = raw.indexOf(']', open + 2);
      if (open >= 0 && close >= 0) ranges.push({ start: position.start.offset + open + 2, end: position.start.offset + close, heading: false });
    }
    node.children?.forEach(child => visit(child, [...ancestors, node]));
  };
  visit(root, []);
  const segments = [];
  let suppressedSegments = 0;
  const notices = new Set<string>();
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const startLine = displayPosition(input.source, range.start).line;
    const endLine = displayPosition(input.source, Math.max(range.start, range.end - 1)).line;
    const subranges = startLine === endLine
      ? [{ start: range.start, end: range.end, disabled: policy.disabled.has(startLine) }]
      : mergeByDisabledStatus(input.source, lineParts(input.source, range.start, range.end), policy.disabled);
    for (const part of subranges) {
      const line = displayPosition(input.source, part.start).line;
      const text = input.source.slice(part.start, part.end);
      if (part.disabled) {
        if (/\p{L}/u.test(text)) suppressedSegments += 1;
        continue;
      }
      if (frontmatter !== undefined && part.start < frontmatter) continue;
      if (/\{#[A-Za-z][^}]*\}|\\[^\p{L}\p{N}\s]|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/iu.test(text)) {
        protectedLines.add(line); continue;
      }
      const segment = makeSegment(`${input.snapshot.id}_s${segments.length + 1}`, input.snapshot.id, input.source, part.start, part.end, input.glossary);
      if (segment) {
        segments.push(segment);
        if (range.heading) notices.add('anchor_may_change');
      }
    }
  }
  const diagnostics = [...policy.diagnostics, ...[...protectedLines].sort((a, b) => a - b).map(line => ({ code: 'protected_markdown_construct', line }))];
  if (frontmatter !== undefined) diagnostics.unshift({ code: 'protected_frontmatter', line: 1 });
  return { segments, suppressedSegments, diagnostics, notices: [...notices] };
}
