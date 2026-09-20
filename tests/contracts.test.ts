import { expect, it } from 'vitest';
import { configSchema, relativePathSchema, batchRequestSchema, runLogSchema } from '../src/core/contracts.js';
import { FakeProvider } from '../src/llm/provider.js';

it('requires explicit models and dated pricing for a dollar budget, rejecting secrets/unknown keys', () => {
  const base = { provider: { name: 'openai', model: 'test-model' } };
  expect(configSchema.parse(base).limits.maxAgents).toBe(32);
  expect(configSchema.safeParse({ ...base, apiKey: 'secret' }).success).toBe(false);
  expect(configSchema.safeParse({ provider: { ...base.provider, apiKey: 'secret' } }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, limits: { maxEstimatedUsd: 1 } }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, limits: { maxEstimatedUsd: 1 }, pricing: {
    inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, asOf: '2026-09-20',
  } }).success).toBe(true);
  expect(configSchema.safeParse({ ...base, limits: { maxRetries: 3 } }).success).toBe(false);
});
it('rejects artifact path traversal and unsupported log versions', () => {
  for (const path of ['../a', '/a', 'a/../b', 'a//b', 'C:/a', 'a\\b', 'a\0b']) {
    expect(relativePathSchema.safeParse(path).success, path).toBe(false);
  }
  expect(relativePathSchema.parse('docs/é.md')).toBe('docs/é.md');
  expect(runLogSchema.safeParse({ schemaVersion: 2, id: 'r1', files: [] }).success).toBe(false);
});
it('keeps fake requests independent and honors cancellation without consuming a response', async () => {
  const request = { batchId: 'b1', segments: [{ segmentId: 's1', editable: 'Hello', context: [] }] };
  expect(batchRequestSchema.safeParse({ ...request, segments: [...request.segments, ...request.segments] }).success).toBe(false);
  const fake = new FakeProvider([{ text: '{"results":[]}', inputTokens: undefined, outputTokens: undefined, schemaValid: true }]);
  await expect(fake.propose(request, AbortSignal.abort())).rejects.toThrow();
  expect(fake.requests).toHaveLength(0);
  await fake.propose(request);
  request.segments[0]!.editable = 'changed';
  expect(fake.requests[0]!.segments[0]!.editable).toBe('Hello');
});
it('distinguishes gateway namespaced models and required upstream routes from direct providers', () => {
  expect(configSchema.safeParse({ provider: { name: 'gateway', model: 'openai/test', only: ['openai'] } }).success).toBe(true);
  expect(configSchema.safeParse({ provider: { name: 'gateway', model: 'test', only: ['openai'] } }).success).toBe(false);
  expect(configSchema.safeParse({ provider: { name: 'gateway', model: 'openai/test' } }).success).toBe(false);
  expect(configSchema.safeParse({ provider: { name: 'openai', model: 'test', only: ['openai'] } }).success).toBe(false);
});

it('uses hidden-path and agent defaults and rejects removed configuration knobs', () => {
  const base = { provider: { name: 'openai', model: 'test' } };
  expect(configSchema.parse(base).includeHidden).toBe(false);
  for (const maxAgents of [1, 16, 32, 64]) {
    expect(configSchema.parse({ ...base, includeHidden: true, limits: { maxAgents } }))
      .toMatchObject({ includeHidden: true, limits: { maxAgents } });
  }
  for (const maxAgents of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(configSchema.safeParse({ ...base, limits: { maxAgents } }).success).toBe(false);
  }
  for (const key of ['maxRequests', 'maxInputTokensPerRequest', 'maxOutputTokensPerRequest', 'concurrency']) {
    expect(configSchema.safeParse({ ...base, limits: { [key]: 2 } }).success, key).toBe(false);
  }
  expect(configSchema.safeParse({ ...base, storage: { retentionDays: 7 } }).success).toBe(false);
});
it('keeps audit summaries separate from source-bearing run state', () => {
  const log = { schemaVersion: 1, id: 'r1', provider: { name: 'openai', model: 'test' },
    startedAt: '2026-09-20T00:00:00Z', finishedAt: '2026-09-20T00:01:00Z', status: 'completed',
    usage: { requests: 1, knownInputTokens: 10, knownOutputTokens: 5,
      estimatedInputTokens: 0, estimatedOutputTokens: 0, knownUsd: null, estimatedUsd: null },
    counts: { files: 1, reviewedSegments: 1, unresolvedSegments: 0, findings: 1, applied: 1 },
    files: [{ path: 'README.md', beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64), state: 'replaced' }],
  };
  expect(runLogSchema.safeParse(log).success).toBe(true);
  for (const key of ['findings', 'snapshots', 'selections', 'config', 'apiKey']) {
    expect(runLogSchema.safeParse({ ...log, [key]: [] }).success, key).toBe(false);
  }
  expect(runLogSchema.safeParse({ ...log, files: [{ ...log.files[0], replacement: 'source text' }] }).success).toBe(false);
});
