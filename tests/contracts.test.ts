import { expect, it } from 'vitest';
import { configSchema, relativePathSchema, batchRequestSchema, applyJournalSchema } from '../src/core/contracts.js';
import { FakeProvider } from '../src/llm/provider.js';

it('requires explicit models and dated pricing for a dollar budget, rejecting secrets/unknown keys', () => {
  const base = { provider: { name: 'openai', model: 'test-model' } };
  expect(configSchema.parse(base).limits.maxRequests).toBe(100);
  expect(configSchema.safeParse({ ...base, apiKey: 'secret' }).success).toBe(false);
  expect(configSchema.safeParse({ provider: { ...base.provider, apiKey: 'secret' } }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, limits: { maxEstimatedUsd: 1 } }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, limits: { maxEstimatedUsd: 1 }, pricing: {
    inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, asOf: '2026-09-20',
  } }).success).toBe(true);
  expect(configSchema.safeParse({ ...base, limits: { maxRetries: 3 } }).success).toBe(false);
});
it('rejects artifact path traversal and unsupported journal versions', () => {
  for (const path of ['../a', '/a', 'a/../b', 'a//b', 'C:/a', 'a\\b', 'a\0b']) {
    expect(relativePathSchema.safeParse(path).success, path).toBe(false);
  }
  expect(relativePathSchema.parse('docs/é.md')).toBe('docs/é.md');
  expect(applyJournalSchema.safeParse({ schemaVersion: 2, runId: 'r1', selectedFindingIds: [], files: [] }).success).toBe(false);
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
