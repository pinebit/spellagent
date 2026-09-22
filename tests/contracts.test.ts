import { expect, it } from 'vitest';
import { preferencesSchema, invocationPreferencesSchema, relativePathSchema, proposalSchema } from '../src/core/contracts.js';
import { parsePreferences } from '../src/discovery/config.js';
import { compileGlobs } from '../src/discovery/globs.js';

it('uses strict versioned host-independent preferences', () => {
  expect(preferencesSchema.parse({ schemaVersion: 2 })).toMatchObject({ dialect: 'en-US', includeHidden: false, glossary: [] });
  for (const key of ['provider', 'pricing', 'limits', 'storage', 'model', 'concurrency', 'apiKey', 'unknown']) {
    expect(preferencesSchema.safeParse({ schemaVersion: 2, [key]: 'removed' }).success, key).toBe(false);
    expect(invocationPreferencesSchema.safeParse({ [key]: 'removed' }).success, key).toBe(false);
  }
  expect(() => parsePreferences({ schemaVersion: 1 })).toThrow('preferences_migration_required');
  expect(() => parsePreferences({ provider: {} })).toThrow('preferences_migration_required');
  expect(() => parsePreferences({})).toThrow('invalid_preferences');
});

it('rejects root escapes and invalid globs', () => {
  for (const path of ['../a', '/a', 'a/../b', 'a//b', 'C:/a', 'a\\b', 'a\0b']) {
    expect(relativePathSchema.safeParse(path).success, path).toBe(false);
  }
  expect(relativePathSchema.parse('docs/é.md')).toBe('docs/é.md');
  for (const glob of ['../**', '/tmp/**', '!a', 'a\\b', '{a,{b,c}}', '{unclosed']) {
    expect(() => compileGlobs([glob]), glob).toThrow();
  }
});

it('rejects glossary terms and proposal replacements containing a lone UTF-16 surrogate', () => {
  const lone = '\uD800';
  expect(preferencesSchema.safeParse({ schemaVersion: 2, glossary: [lone] }).success).toBe(false);
  expect(invocationPreferencesSchema.safeParse({ glossary: [lone] }).success).toBe(false);
  expect(invocationPreferencesSchema.safeParse({ glossary: ['valid'] }).success).toBe(true);
  expect(proposalSchema.safeParse({ original: 'a', replacement: lone, category: 'spelling', reason: 'r' }).success).toBe(false);
  expect(proposalSchema.safeParse({ original: 'a', replacement: 'valid', category: 'spelling', reason: 'r' }).success).toBe(true);
});
