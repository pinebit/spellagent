import { describe, expect, it } from 'vitest';
import { parseProposals } from '../scripts/run-quality-eval.mjs';

describe('parseProposals', () => {
  it('extracts only rows from the Original/Replacement table, ignoring other tables', () => {
    const resultText = `
7 validated corrections previewed for \`doc.md\`; no files changed.

| Original | Replacement | Category | Reason |
| --- | --- | --- | --- |
| teh | the | spelling | Correct a misspelling. |
| recieve | receive | spelling | Correct a misspelling. |

Coverage:

| File | Segments | Changed |
| --- | --- | --- |
| doc.md | 4 | 2 |

Effective settings:

| Setting | Value |
| --- | --- |
| Dialect | en-US |
`;
    const proposals = parseProposals(resultText);
    expect(proposals).toEqual([
      { original: 'teh', replacement: 'the', category: 'spelling' },
      { original: 'recieve', replacement: 'receive', category: 'spelling' },
    ]);
  });

  it('returns an empty array when no correction table is present', () => {
    expect(parseProposals('0 validated corrections previewed for `doc.md`; no files changed.')).toEqual([]);
  });

  it('handles a column order different from the canonical one', () => {
    const resultText = `
| Category | Original | Replacement |
| --- | --- | --- |
| grammar | a apple | an apple |
`;
    expect(parseProposals(resultText)).toEqual([
      { original: 'a apple', replacement: 'an apple', category: 'grammar' },
    ]);
  });
});
