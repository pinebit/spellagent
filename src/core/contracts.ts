import { z } from 'zod';

export const SCHEMA_VERSION = 2 as const;
export const CONFIG_PATH = '.spellagentrc.json' as const;
export const MAX_FILE_BYTES = 1_048_576;
// An edit request must submit one response per eligible segment in a single
// request, so a file whose eligible-segment count exceeds this can never be
// completed; extraction rejects such files up front (see discover.ts).
export const MAX_RESPONSE_SEGMENTS = 10_000;
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const countSchema = z.number().int().nonnegative().safe();
const id = idSchema;
const hash = hashSchema;
const count = countSchema;
// A lone (unpaired) UTF-16 surrogate has no valid UTF-8 encoding. Left
// unchecked, it can make offset conversion throw when it matches inside a
// legitimate surrogate pair elsewhere in the source (glossary terms), or
// get silently mangled to U+FFFD when written to disk, so the file no
// longer matches the accepted proposal (replacement text).
function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export const relativePathSchema = z.string().min(1).max(4096).refine(value =>
  !value.includes('\\') && !value.includes(':') && !/[\u0000-\u001f\u007f]/u.test(value) &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
'Expected a normalized root-relative path');
export const byteRangeSchema = z.strictObject({ startByte: count, endByte: count })
  .refine(range => range.endByte >= range.startByte, 'Reversed byte range');
export const formatSchema = z.enum(['markdown', 'javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust']);
const globs = z.array(z.string().min(1).max(1024)).max(128);
const glossary = z.array(z.string().min(1).max(256).refine(value =>
  !/[\u0000-\u001f\u007f]/u.test(value) && isWellFormedUtf16(value),
  'Glossary terms must be single-line, well-formed text')).max(256);
export const preferencesSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  dialect: z.enum(['en-US', 'en-GB']).default('en-US'),
  include: globs.default(['**/*.md', '**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,pyi,java,go,rs}']),
  exclude: globs.default([]),
  includeHidden: z.boolean().default(false),
  glossary: glossary.default([]),
});
export const invocationPreferencesSchema = z.strictObject({
  dialect: z.enum(['en-US', 'en-GB']).optional(),
  include: globs.optional(), exclude: globs.optional(),
  includeHidden: z.boolean().optional(), glossary: glossary.optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export type InvocationPreferences = z.infer<typeof invocationPreferencesSchema>;

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

export const proposalCategorySchema = z.enum([
  'spelling', 'grammar', 'punctuation', 'capitalization', 'usage', 'other',
]);
export const proposalSchema = z.strictObject({
  original: z.string().min(1).max(512),
  replacement: z.string().max(1024).refine(isWellFormedUtf16, 'Replacement must be well-formed UTF-16 text'),
  category: proposalCategorySchema,
  reason: z.string().min(1).max(500).refine(value =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'Invalid reason text'),
});
export const segmentResponseSchema = z.strictObject({
  segmentId: idSchema,
  proposals: z.array(proposalSchema).max(128),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;
