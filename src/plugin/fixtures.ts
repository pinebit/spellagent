import type { FileSnapshot } from '../core/contracts.js';

type Fixture = { format: FileSnapshot['format']; source: string };
// Synthetic-only Phase A inputs. No source files or project configuration are read.
export const fixtures = {
  markdown: { format: 'markdown', source: '# Example\n\nThis sentense has a typo.\n\nKeep `const untouched = true` unchanged.\n' },
  javascript: { format: 'javascript', source: 'const text = "é😀"; // This sentense has a typo.\r\n' },
  typescript: { format: 'typescript', source: 'const text: string = "é😀"; // This sentense has a typo.\r\n' },
  tsx: { format: 'tsx', source: 'const view = <div title="é😀"/>; // This sentense has a typo.\n' },
  python: { format: 'python', source: '"""This sentense has a typo."""\nvalue = "é😀" # Keep this comment.\n' },
  java: { format: 'java', source: 'class Example { String text = "é😀"; /* This sentense has a typo. */ }\n' },
  go: { format: 'go', source: 'package example\nvar text = "é😀" // This sentense has a typo.\n' },
  rust: { format: 'rust', source: 'const TEXT: &str = "é😀"; // This sentense has a typo.\n' },
  pages: { format: 'markdown', source: Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} has a sentense to review.`).join('\n\n') + '\n' },
  oversized: { format: 'markdown', source: 'A deliberately oversized synthetic paragraph. '.repeat(400) + '\n' },
} as const satisfies Record<string, Fixture>;

export type FixtureName = keyof typeof fixtures;
