import type { Node as SyntaxNode } from 'web-tree-sitter';
import { createParser, type CodeLanguage } from './parsers.js';
import { displayPosition } from './positions.js';
import { makeSegment } from './protection.js';
import type { ExtractInput, ExtractionDiagnostic, ExtractionResult } from './types.js';

const COMMENT_TYPES = ['comment', 'line_comment', 'block_comment'];
const DIRECTIVES = new Set(['spellagent-disable', 'spellagent-enable', 'spellagent-disable-next-line']);

type Candidate = { start: number; end: number; line: number; doc: boolean };
type Comment = { node: SyntaxNode; normalized: string; line: number };

function normalizeWholeComment(text: string): string {
  return text.replace(/^\/[/!*]+|^#+|^\/\*+|\*+\/$/gu, '').replace(/^\s*\* ?/gmu, '').trim();
}

function lineCandidates(source: string, node: SyntaxNode, language: CodeLanguage): Candidate[] {
  const text = source.slice(node.startIndex, node.endIndex);
  const doc = language === 'rust' ? /^(?:\/\/\/|\/\/!|\/\*\*|\/\*!)/u.test(text) :
    language === 'java' || language === 'javascript' || language === 'typescript' || language === 'tsx' ? /^\/\*\*/u.test(text) : false;
  const result: Candidate[] = [];
  let local = 0;
  let protectedExample = false;
  for (const physical of text.split(/(?<=\n)/u)) {
    const withoutEol = physical.replace(/[\r\n]+$/u, '');
    let start = 0;
    let end = withoutEol.length;
    if (local === 0) {
      const opening = withoutEol.match(/^\s*(?:\/\/\/?!?|\/\*+!?|#)\s?/u);
      if (opening) start = opening[0].length;
    } else {
      const prefix = withoutEol.match(/^\s*\*?\s?/u);
      if (prefix) start = prefix[0].length;
    }
    if (local + physical.length >= text.length) {
      const closing = withoutEol.slice(start).match(/\s*\*\/$/u);
      if (closing?.index !== undefined) end = start + closing.index;
    }
    while (start < end && /[ \t]/u.test(withoutEol[start]!)) start += 1;
    while (end > start && /[ \t]/u.test(withoutEol[end - 1]!)) end -= 1;
    const goCode = language === 'go' && (/^\s*\/\/(?: {5,}|\t)/u.test(withoutEol) || /^\s*\*(?: {5,}|\t)/u.test(withoutEol));
    const content = withoutEol.slice(start, end).trim();
    if (doc && /^@(?:example|snippet)\b/u.test(content)) protectedExample = true;
    else if (doc && /^@[A-Za-z]+\b/u.test(content)) protectedExample = false;
    if (end > start && !protectedExample && !goCode) result.push({ start: node.startIndex + local + start, end: node.startIndex + local + end,
      line: displayPosition(source, node.startIndex + local + start).line, doc });
    local += physical.length;
  }
  return result;
}

function suppression(comments: readonly Comment[], lineCount: number) {
  const disabled = new Set<number>();
  const diagnostics: ExtractionDiagnostic[] = [];
  let from: number | undefined;
  for (const comment of comments) {
    if (!DIRECTIVES.has(comment.normalized)) continue;
    if (comment.normalized === 'spellagent-disable-next-line') disabled.add(comment.line + 1);
    else if (comment.normalized === 'spellagent-disable') {
      if (from !== undefined) diagnostics.push({ code: 'nested_disable', line: comment.line });
      else from = comment.line;
    } else if (from === undefined) diagnostics.push({ code: 'unmatched_enable', line: comment.line });
    else {
      for (let line = from; line <= comment.line; line += 1) disabled.add(line);
      from = undefined;
    }
  }
  if (from !== undefined) {
    for (let line = from; line <= lineCount; line += 1) disabled.add(line);
    diagnostics.push({ code: 'disable_to_eof', line: from });
  }
  return { disabled, diagnostics };
}

function isProtectedLine(text: string, language: CodeLanguage, doc: boolean, state: { fenced: boolean; javaCode: boolean }): boolean {
  const trimmed = text.trim();
  if (!trimmed || DIRECTIVES.has(trimmed)) return true;
  if (/\/\*|\*\//u.test(trimmed)) return true;
  if (/^(?:eslint|prettier|istanbul|webpack|sourceMappingURL|@ts-|jshint|jslint)\b/iu.test(trimmed)) return true;
  if (language === 'go' && /^(?:go:|\+build\b|#cgo\b)/u.test(trimmed)) return true;
  if (language === 'go' && /^(?:#\s|\[.+\]$)/u.test(trimmed)) return true;
  if (language === 'rust' && doc) {
    if (/^```/u.test(trimmed)) { state.fenced = !state.fenced; return true; }
    if (state.fenced || /^#(?:\s|$)/u.test(trimmed)) return true;
    if (/`|\[[^\]]+\]\([^)]*\)|<[^>]+>/u.test(trimmed)) return true;
  }
  if (doc && ['javascript', 'typescript', 'tsx'].includes(language)) {
    if (/^@[A-Za-z]+\b|\{@[A-Za-z]+\b|```/u.test(trimmed)) return true;
  }
  if (language === 'java' && doc) {
    if (/\{@(?:code|literal|link|linkplain|value|docRoot|inheritDoc|index|summary|systemProperty|snippet)\b/u.test(trimmed)) return true;
    if (/^@(?:param|return|throws|exception|see|since|author|version|deprecated|serial|hidden|uses|provides)\b/u.test(trimmed)) return true;
    if (/<(?:pre|code|snippet)\b/iu.test(trimmed)) state.javaCode = true;
    const protectedLine = state.javaCode || /<\/?[A-Za-z][^>]*>/u.test(trimmed);
    if (/<\/(?:pre|code|snippet)>/iu.test(trimmed)) state.javaCode = false;
    if (protectedLine) return true;
  }
  return false;
}

function pythonDocstrings(root: SyntaxNode, source: string): { safe: SyntaxNode[]; unsafe: SyntaxNode[] } {
  const found: SyntaxNode[] = [];
  const firstString = (container: SyntaxNode) => {
    const statement = container.namedChildren[0];
    const value = statement?.type === 'expression_statement' ? statement.namedChildren[0] : undefined;
    if (value?.type === 'string' || value?.type === 'concatenated_string') found.push(value);
  };
  const visit = (node: SyntaxNode) => {
    if (node.type === 'module') firstString(node);
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const body = node.childForFieldName('body');
      if (body) firstString(body);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  const safe: SyntaxNode[] = [];
  const unsafe: SyntaxNode[] = [];
  for (const node of found) {
    const text = source.slice(node.startIndex, node.endIndex);
    const opening = /^(?:[rRuU]{0,2})('''|"""|'|")/u.exec(text);
    if (node.type === 'string' && !text.includes('\\') && opening !== null && text.endsWith(opening[1]!)) safe.push(node);
    else unsafe.push(node);
  }
  return { safe, unsafe };
}

export async function extractCode(input: ExtractInput): Promise<ExtractionResult> {
  const language = input.snapshot.format as CodeLanguage;
  const parser = await createParser(language);
  try {
    const tree = parser.parse(input.source);
    if (!tree) return { segments: [], diagnostics: [{ code: 'parse_failed' }], notices: [] };
    try {
      if (tree.rootNode.hasError) return { segments: [], diagnostics: [{ code: 'parse_error' }], notices: [] };
      const nodes = tree.rootNode.descendantsOfType(COMMENT_TYPES);
      const comments: Comment[] = nodes.map(node => ({ node, normalized: normalizeWholeComment(input.source.slice(node.startIndex, node.endIndex)),
        line: displayPosition(input.source, node.startIndex).line }));
      const lineCount = input.source.split(/\r\n|\r|\n/u).length;
      const policy = suppression(comments, lineCount);
      const diagnostics = [...policy.diagnostics];
      for (const comment of comments) {
        if (/@(?:example|snippet)\b|```|^\s*#(?:\s|$)|<\/?(?:pre|code|snippet)\b|^\/\/(?: {5,}|\t)/mu.test(comment.node.text)) {
          diagnostics.push({ code: 'protected_documentation_construct', line: comment.line });
        }
        if (language === 'java' && /^\s*\/\/\//u.test(comment.node.text)) {
          diagnostics.push({ code: 'unsupported_java_markdown_doc', line: comment.line });
        }
      }
      if (language === 'go') {
        for (const node of nodes) {
          if (/^\s*import\s+["`]C["`]/u.test(input.source.slice(node.endIndex))) {
            diagnostics.push({ code: 'protected_cgo_preamble', line: displayPosition(input.source, node.startIndex).line });
          }
        }
      }
      const candidates = nodes.flatMap(node => {
        if (language === 'java' && /^\s*\/\/\//u.test(input.source.slice(node.startIndex, node.endIndex))) return [];
        if (language === 'go' && /^\s*import\s+["`]C["`]/u.test(input.source.slice(node.endIndex))) return [];
        return lineCandidates(input.source, node, language);
      });
      if (language === 'python') {
        const docstrings = pythonDocstrings(tree.rootNode, input.source);
        for (const node of docstrings.unsafe) {
          diagnostics.push({ code: 'unsupported_python_docstring', line: displayPosition(input.source, node.startIndex).line });
        }
        for (const node of docstrings.safe) {
          const text = input.source.slice(node.startIndex, node.endIndex);
          if (/^(?:[ \t]*)(?:>>>|\.\.\.)/mu.test(text)) {
            diagnostics.push({ code: 'protected_python_doctest', line: displayPosition(input.source, node.startIndex).line });
          }
          const opening = text.match(/^(?:[rRuU]{0,2})('''|"""|'|")/u)!;
          const quote = opening[0].length;
          const delimiterLength = opening[1]!.length;
          let local = quote;
          const body = text.slice(quote, -delimiterLength);
          for (const physical of body.split(/(?<=\n)/u)) {
            const clean = physical.replace(/[\r\n]+$/u, '');
            const leading = clean.match(/^\s*/u)![0].length;
            if (clean.slice(leading) && !/^>>>|^\.\.\./u.test(clean.slice(leading))) candidates.push({
              start: node.startIndex + local + leading, end: node.startIndex + local + clean.length,
              line: displayPosition(input.source, node.startIndex + local + leading).line, doc: true,
            });
            local += physical.length;
          }
        }
      }
      const state = { fenced: false, javaCode: false };
      const segments = [];
      for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
        const text = input.source.slice(candidate.start, candidate.end);
        if (policy.disabled.has(candidate.line)) continue;
        if (isProtectedLine(text, language, candidate.doc, state)) {
          diagnostics.push({ code: 'protected_comment_construct', line: candidate.line });
          continue;
        }
        if (language === 'java' && /\\u[0-9a-f]{4}/iu.test(text)) {
          diagnostics.push({ code: 'protected_java_unicode_escape', line: candidate.line });
          continue;
        }
        const segment = makeSegment(`${input.snapshot.id}_s${segments.length + 1}`, input.snapshot.id, input.source, candidate.start, candidate.end, input.glossary);
        if (segment) segments.push(segment);
      }
      return { segments, diagnostics, notices: [] };
    } finally { tree.delete(); }
  } finally { parser.delete(); }
}

export async function actualCommentTexts(source: string, language: CodeLanguage): Promise<{ text: string; start: number }[]> {
  const parser = await createParser(language);
  try {
    const tree = parser.parse(source);
    if (!tree) throw new Error('Parser returned no syntax tree');
    try {
      if (tree.rootNode.hasError) throw new Error('Source contains syntax errors');
      return tree.rootNode.descendantsOfType(COMMENT_TYPES).map(node => ({ text: source.slice(node.startIndex, node.endIndex), start: node.startIndex }));
    } finally { tree.delete(); }
  } finally { parser.delete(); }
}
