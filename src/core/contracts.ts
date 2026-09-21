import { z } from 'zod';

export const SCHEMA_VERSION = 2 as const;
export const CONFIG_PATH = '.spellagentrc.json' as const;
export const MAX_FILE_BYTES = 1_048_576;
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const countSchema = z.number().int().nonnegative().safe();
const id = idSchema;
const hash = hashSchema;
const count = countSchema;
export const relativePathSchema = z.string().min(1).max(4096).refine(value =>
  !value.includes('\\') && !value.includes(':') && !/[\u0000-\u001f\u007f]/u.test(value) &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
'Expected a normalized root-relative path');
export const byteRangeSchema = z.strictObject({ startByte: count, endByte: count })
  .refine(range => range.endByte >= range.startByte, 'Reversed byte range');
export const formatSchema = z.enum(['markdown', 'javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust']);
const globs = z.array(z.string().min(1).max(1024)).max(128);
const glossary = z.array(z.string().min(1).max(256).refine(value =>
  !/[\u0000-\u001f\u007f]/u.test(value), 'Glossary terms must be single-line text')).max(256);
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
