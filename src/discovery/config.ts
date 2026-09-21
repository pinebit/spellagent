import path from 'node:path';
import { CONFIG_PATH, preferencesSchema, invocationPreferencesSchema,
  type InvocationPreferences, type Preferences } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { compileGlobs } from './globs.js';
import { inspectPath, readLocalFile, strictUtf8 } from './filesystem.js';

export async function resolveProjectRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root) || /[\u0000-\u001f\u007f]/u.test(root)) throw new HelperError('invalid_root');
  const result = await inspectPath(root);
  if (!result.info.isDirectory()) throw new HelperError('invalid_root');
  return root;
}

const legacyKeys = ['provider', 'pricing', 'limits', 'language', 'storage', 'concurrency', 'model',
  'maxAgents', 'maxRequests', 'maxInputTokensPerRequest', 'maxOutputTokensPerRequest',
  'maxFileBytes', 'timeoutMs', 'maxRetries', 'maxEstimatedUsd', 'scheduler', 'retentionDays'];
export const MIGRATION_GUIDANCE = 'Replace the legacy configuration with schemaVersion: 2 and only dialect, include, exclude, includeHidden, and glossary. Model selection belongs to the host. The existing file was not changed.';

export function parsePreferences(input: unknown): Preferences {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const object = input as Record<string, unknown>;
    if (object.schemaVersion === 1 || legacyKeys.some(key => key in object)) throw new HelperError('preferences_migration_required');
  }
  const result = preferencesSchema.safeParse(input);
  if (!result.success) throw new HelperError('invalid_preferences');
  return result.data;
}

export async function loadPreferences(root: string, overrides: InvocationPreferences = {}): Promise<Preferences> {
  let project = preferencesSchema.parse({ schemaVersion: 2 });
  let bytes: Buffer | undefined;
  try { bytes = await readLocalFile(path.join(root, CONFIG_PATH), 64 * 1024); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new HelperError('preferences_read_failed');
  }
  if (bytes !== undefined) {
    let value: unknown;
    try { value = JSON.parse(strictUtf8(bytes).replace(/^\uFEFF/u, '')); }
    catch { throw new HelperError('invalid_preferences_json'); }
    project = parsePreferences(value);
  }
  const invocation = invocationPreferencesSchema.safeParse(overrides);
  if (!invocation.success) throw new HelperError('invalid_preferences');
  const effective: Preferences = {
    schemaVersion: 2,
    dialect: invocation.data.dialect ?? project.dialect,
    include: invocation.data.include ?? project.include,
    includeHidden: invocation.data.includeHidden ?? project.includeHidden,
    exclude: [...new Set([...project.exclude, ...(invocation.data.exclude ?? [])])],
    glossary: [...new Set([...project.glossary, ...(invocation.data.glossary ?? [])])],
  };
  try { compileGlobs(effective.include); compileGlobs(effective.exclude); }
  catch { throw new HelperError('invalid_glob'); }
  return effective;
}
