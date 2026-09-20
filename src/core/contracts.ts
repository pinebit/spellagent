import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
const positive = z.number().int().positive().safe();
const usd = z.number().finite().nonnegative();
export const relativePathSchema = z.string().min(1).refine(value =>
  !value.includes('\\') && !value.includes(':') && !/[\u0000-\u001f\u007f]/u.test(value) &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
'Expected a normalized root-relative path');
export const byteRangeSchema = z.strictObject({ startByte: count, endByte: count })
  .refine(range => range.endByte >= range.startByte, 'Reversed byte range');
export const formatSchema = z.enum(['markdown', 'javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust']);
const modelId = z.string().trim().min(1).refine(model => !model.includes('YOUR_MODEL_ID'), 'Choose an explicit model');
export const providerConfigSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('openai'), model: modelId }),
  z.strictObject({ name: z.literal('anthropic'), model: modelId }),
  z.strictObject({ name: z.literal('gateway'), model: modelId.refine(model => /^[a-z0-9-]+\/[^\s/]+$/.test(model), 'Expected vendor/model'),
    only: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1) }),
]);
export const configSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  language: z.literal('en').default('en'),
  dialect: z.enum(['en-US', 'en-GB']).default('en-US'),
  include: z.array(z.string().min(1)).default(['**/*.md', '**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,pyi,java,go,rs}']),
  exclude: z.array(z.string().min(1)).default([]),
  glossary: z.array(z.string().min(1)).default([]),
  provider: providerConfigSchema,
  limits: z.strictObject({
    maxFileBytes: positive.default(1048576), maxRequests: positive.default(100),
    maxInputTokensPerRequest: positive.default(6000), maxOutputTokensPerRequest: positive.default(2000),
    concurrency: positive.default(2), timeoutMs: positive.default(60000),
    maxRetries: count.max(2).default(2), maxEstimatedUsd: usd.nullable().default(null),
  }).prefault({}),
  pricing: z.strictObject({ inputUsdPerMillionTokens: usd, outputUsdPerMillionTokens: usd,
    asOf: z.iso.date() }).nullable().default(null),
  storage: z.strictObject({ retentionDays: positive.default(7) }).prefault({}),
}).refine(config => config.limits.maxEstimatedUsd === null || config.pricing !== null,
  { path: ['pricing'], message: 'A dollar budget requires explicit dated pricing' });
export type Config = z.infer<typeof configSchema>;

export const fileSnapshotSchema = z.strictObject({
  id, path: relativePathSchema, sha256: hash, format: formatSchema,
  byteLength: count, encoding: z.literal('utf8'), bom: z.boolean(),
  eol: z.enum(['lf', 'crlf', 'cr', 'mixed', 'none']),
});
export type FileSnapshot = z.infer<typeof fileSnapshotSchema>;
export const segmentSchema = z.strictObject({
  id, snapshotId: id, editableText: z.string().min(1),
  sourceMap: z.array(z.strictObject({
    editableStartUtf16: count, editableEndUtf16: count, source: byteRangeSchema,
  }).refine(span => span.editableEndUtf16 > span.editableStartUtf16)).min(1),
  protectedRanges: z.array(byteRangeSchema),
  context: z.array(z.string()),
});
export type Segment = z.infer<typeof segmentSchema>;

export const proposalSchema = z.strictObject({
  original: z.string().min(1).max(8192), replacement: z.string().min(1).max(8192),
  category: z.enum(['spelling', 'grammar']), reason: z.string().min(1).max(1000),
});
// This strict schema is sent to providers; item-level acceptance is a separate step.
export const batchResponseSchema = z.strictObject({ results: z.array(z.strictObject({
  segmentId: id, proposals: z.array(proposalSchema).max(100),
})).max(100) });
export type Proposal = z.infer<typeof proposalSchema>;
export const batchRequestSchema = z.strictObject({
  batchId: id, segments: z.array(z.strictObject({
    segmentId: id, editable: z.string().min(1), context: z.array(z.string()),
  })).min(1).max(100),
}).refine(batch => new Set(batch.segments.map(segment => segment.segmentId)).size === batch.segments.length,
  'Duplicate requested segment IDs');
export type BatchRequest = z.infer<typeof batchRequestSchema>;

export const findingSchema = z.strictObject({
  id, segmentId: id, snapshotId: id, range: byteRangeSchema,
  ...proposalSchema.shape, validationVersion: z.string().min(1), selected: z.boolean(),
  disposition: z.enum(['available', 'dismissed', 'applied']), notices: z.array(z.string()),
});
export type Finding = z.infer<typeof findingSchema>;
export const coverageSchema = z.strictObject({
  segmentId: id, state: z.enum(['reviewed', 'unreviewed', 'unresolved']),
  reasons: z.array(z.string()),
});
export type SegmentCoverage = z.infer<typeof coverageSchema>;
export const usageSchema = z.strictObject({
  requests: count, knownInputTokens: count, knownOutputTokens: count,
  estimatedInputTokens: count, estimatedOutputTokens: count,
  knownUsd: usd.nullable(), estimatedUsd: usd.nullable(),
});
export const runSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), id,
  projectRoot: z.string().min(1), toolVersion: z.string().min(1),
  extractorVersion: z.string().min(1), promptVersion: z.string().min(1),
  generatedDetectionVersion: z.string().min(1), config: configSchema,
  scope: z.array(relativePathSchema), snapshots: z.array(fileSnapshotSchema),
  findings: z.array(findingSchema), coverage: z.array(coverageSchema), usage: usageSchema,
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  status: z.enum(['completed', 'incomplete', 'cancelled', 'failed']),
}).refine(run => run.status !== 'completed' || run.coverage.every(entry => entry.state === 'reviewed'),
  'Completed runs cannot contain unresolved coverage');
export type Run = z.infer<typeof runSchema>;
export const applyJournalSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION), runId: id, selectedFindingIds: z.array(id),
  files: z.array(z.strictObject({ path: relativePathSchema, beforeSha256: hash,
    afterSha256: hash, backupPath: relativePathSchema,
    state: z.enum(['prepared', 'replaced', 'restored']),
  })),
});
export type ApplyJournal = z.infer<typeof applyJournalSchema>;
export type CoreEvent =
  | { type: 'fileSkipped'; path: string; reason: string }
  | { type: 'batchCompleted'; batchId: string; coverage: SegmentCoverage[] }
  | { type: 'findingValidated'; finding: Finding }
  | { type: 'runFinished'; runId: string; status: Run['status'] };
export const EXIT_CODES = { success: 0, findings: 1, incomplete: 2, cancelled: 130 } as const;
