import { describe, expect, it } from 'vitest';
import { probeParsers } from '../src/probes/parsers.js';
import { displayPosition, sourceRange, utf16ToByteOffset } from '../src/extractors/positions.js';

describe('parser feasibility', () => {
  it('parses every initial grammar and maps Unicode/CRLF to exact bytes', async () => {
    expect((await probeParsers()).map(result => result.language)).toEqual([
      'javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust', 'markdown',
    ]);
  });
  it('rejects invalid boundaries and counts displayed code points', () => {
    const source = '\uFEFFé😀\r\nend';
    expect(utf16ToByteOffset(source, 4)).toBe(9);
    expect(() => utf16ToByteOffset(source, 3)).toThrow('surrogate');
    expect(() => utf16ToByteOffset(source, -1)).toThrow();
    expect(() => utf16ToByteOffset(source, 1.5)).toThrow();
    expect(() => sourceRange(source, 4, 1)).toThrow();
    expect(displayPosition(source, 4)).toEqual({ line: 1, column: 4 });
    expect(displayPosition(source, 6)).toEqual({ line: 2, column: 1 });
  });
});
