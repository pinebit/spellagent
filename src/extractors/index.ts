import type { FileSnapshot } from '../core/contracts.js';
import { extractCode } from './code.js';
import { extractMarkdown } from './markdown.js';
import type { ExtractionResult } from './types.js';

export async function extractFile(source: string, snapshot: FileSnapshot, glossary: readonly string[]): Promise<ExtractionResult> {
  const result = snapshot.format === 'markdown'
    ? extractMarkdown({ source, snapshot, glossary })
    : await extractCode({ source, snapshot, glossary });
  for (let index = 0; index < result.segments.length; index += 1) {
    result.segments[index]!.context = [result.segments[index - 1]?.editableText, result.segments[index + 1]?.editableText]
      .filter((value): value is string => value !== undefined)
      .map(value => value.slice(0, 500));
  }
  return result;
}
