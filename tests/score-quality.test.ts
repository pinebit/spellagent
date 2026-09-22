import { describe, expect, it } from 'vitest';
import { scoreQuality } from '../scripts/score-quality.mjs';

describe('scoreQuality', () => {
  it('computes precision and recall against gold labels', () => {
    const gold = [
      {
        path: 'a.md',
        dialect: 'en-US',
        corrections: [
          { segmentHint: 's1', original: 'teh', replacement: 'the', category: 'spelling' },
          { segmentHint: 's2', original: 'recieve', replacement: 'receive', category: 'spelling' },
        ],
        cleanSegmentCount: 1,
      },
    ];
    const predictions = [
      {
        path: 'a.md',
        proposals: [
          { original: 'teh', replacement: 'the', category: 'spelling' },
          { original: 'clean', replacement: 'clean-but-wrong', category: 'spelling' },
        ],
      },
    ];
    const result = scoreQuality(gold, predictions);
    expect(result.truePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
    expect(result.falsePositives).toBe(1);
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.recall).toBeCloseTo(0.5);
    expect(result.unexpectedChanges).toHaveLength(1);
  });

  it('flags any change inside a safety fixture as an unexpected change', () => {
    const gold = [{ path: 'safety.ts', dialect: 'en-US', corrections: [], cleanSegmentCount: 3 }];
    const predictions = [{ path: 'safety.ts', proposals: [{ original: 'x', replacement: 'y', category: 'other' }] }];
    const result = scoreQuality(gold, predictions);
    expect(result.unexpectedChanges).toHaveLength(1);
    expect(result.falsePositives).toBe(1);
  });

  it('treats a file with no predictions as fully missed recall', () => {
    const gold = [
      {
        path: 'b.md',
        dialect: 'en-US',
        corrections: [{ segmentHint: 's1', original: 'foo', replacement: 'bar', category: 'spelling' }],
        cleanSegmentCount: 0,
      },
    ];
    const result = scoreQuality(gold, []);
    expect(result.truePositives).toBe(0);
    expect(result.falseNegatives).toBe(1);
    expect(result.falsePositives).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.precision).toBe(1);
  });

  it('returns precision 1 and recall 1 when there is nothing to find and nothing predicted', () => {
    const gold = [{ path: 'c.md', dialect: 'en-US', corrections: [], cleanSegmentCount: 2 }];
    const result = scoreQuality(gold, [{ path: 'c.md', proposals: [] }]);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.unexpectedChanges).toHaveLength(0);
  });

  it('counts proposals on a path absent from the gold set as false positives', () => {
    const gold = [{ path: 'a.md', dialect: 'en-US', corrections: [], cleanSegmentCount: 1 }];
    const predictions = [{ path: 'unlabeled.md', proposals: [{ original: 'x', replacement: 'y', category: 'other' }] }];
    const result = scoreQuality(gold, predictions);
    expect(result.falsePositives).toBe(1);
    expect(result.unexpectedChanges).toEqual([{ path: 'unlabeled.md', original: 'x', replacement: 'y' }]);
    expect(result.precision).toBe(0);
  });

  it('merges proposals from duplicate path entries instead of dropping the earlier one', () => {
    const gold = [
      {
        path: 'a.md',
        dialect: 'en-US',
        corrections: [{ segmentHint: 's1', original: 'teh', replacement: 'the', category: 'spelling' }],
        cleanSegmentCount: 0,
      },
    ];
    const predictions = [
      { path: 'a.md', proposals: [{ original: 'teh', replacement: 'the', category: 'spelling' }] },
      { path: 'a.md', proposals: [{ original: 'extra', replacement: 'wrong', category: 'other' }] },
    ];
    const result = scoreQuality(gold, predictions);
    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(1);
    expect(result.unexpectedChanges).toEqual([{ path: 'a.md', original: 'extra', replacement: 'wrong' }]);
  });
});
