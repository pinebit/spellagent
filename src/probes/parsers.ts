import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { createParser, type CodeLanguage } from '../extractors/parsers.js';
import { sourceRange, displayPosition } from '../extractors/positions.js';

const marker = 'Résumé 😀 e\u0301 prose';
// A non-ASCII prefix on the same line exposes byte/UTF-16 confusion immediately.
const fixtures: Record<CodeLanguage, string> = {
  javascript: `const x = "é😀"; /* ${marker} */\r\n`,
  typescript: `const x: string = "é😀"; /* ${marker} */\r\n`,
  tsx: `const x = <div title="é😀"/>; /* ${marker} */\r\n`,
  python: `x = "é😀"; # ${marker}\r\n`,
  java: `class X { String x = "é😀"; /* ${marker} */ }\r\n`,
  go: `package main\r\nvar x = "é😀" // ${marker}\r\n`,
  rust: `const X: &str = "é😀"; /* ${marker} */\r\n`,
};

export async function probeParsers() {
  const results: { language: string; startByte: number; endByte: number; offsetUnit: string }[] = [];
  for (const [name, fixture] of Object.entries(fixtures)) {
    const parser = await createParser(name as CodeLanguage);
    try {
      for (const eol of ['\r\n', '\n']) {
        const source = fixture.replaceAll('\r\n', eol);
        const tree = parser.parse(source);
        assert.ok(tree);
        try {
          assert.equal(tree.rootNode.hasError, false, `${name} parse errors`);
          const comment = tree.rootNode.descendantsOfType(['comment', 'line_comment', 'block_comment'])
            .find(node => node.text.includes(marker));
          assert.ok(comment, `${name} comment missing`);
          assert.equal(source.slice(comment.startIndex, comment.endIndex), comment.text);
          const range = sourceRange(source, comment.startIndex, comment.endIndex);
          assert.equal(Buffer.from(source).subarray(range.startByte, range.endByte).toString('utf8'), comment.text);
          assert.notEqual(comment.startIndex, range.startByte, `${name} fixture must exercise distinct units`);
          assert.equal(comment.startPosition.column, comment.startIndex - source.lastIndexOf('\n', comment.startIndex - 1) - 1);
          if (eol === '\r\n') results.push({ language: name, ...range, offsetUnit: 'utf16' });
        } finally { tree.delete(); }
      }
    } finally { parser.delete(); }
  }
  const markdown = `# é😀\r\n\r\n${marker} with **bold**.\r\n\r\n| A | B |\r\n| - | - |\r\n| é | 😀 |\r\n`;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const paragraph = tree.children.find(node => node.type === 'paragraph');
  assert.ok(paragraph?.position);
  const { start, end } = paragraph.position;
  assert.ok(start.offset !== undefined && end.offset !== undefined);
  const range = sourceRange(markdown, start.offset, end.offset);
  assert.equal(Buffer.from(markdown).subarray(range.startByte, range.endByte).toString('utf8'), `${marker} with **bold**.`);
  assert.deepEqual(displayPosition(markdown, start.offset), { line: 3, column: 1 });
  assert.ok(tree.children.some(node => node.type === 'table'));
  results.push({ language: 'markdown', ...range, offsetUnit: 'utf16' });
  return results;
}
