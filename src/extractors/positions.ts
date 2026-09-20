/** Offsets from web-tree-sitter and remark are UTF-16 code units, not UTF-8 bytes. */
export function utf16ToByteOffset(text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new RangeError('UTF-16 offset outside source');
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    throw new RangeError('Offset splits a surrogate pair');
  }
  return Buffer.byteLength(text.slice(0, offset), 'utf8');
}

export function sourceRange(text: string, start: number, end: number) {
  if (end < start) throw new RangeError('Reversed source range');
  return { startByte: utf16ToByteOffset(text, start), endByte: utf16ToByteOffset(text, end) };
}

export function displayPosition(text: string, offset: number) {
  utf16ToByteOffset(text, offset);
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length, column: [...(lines.at(-1) ?? '')].length + 1 };
}
