import { link, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { handleRequest } from '../src/plugin/protocol.js';
import { loadPreferences } from '../src/discovery/config.js';
import { extractLocalFile } from '../src/discovery/discover.js';
import { fixtures } from '../src/plugin/fixtures.js';

const roots: string[] = [];
async function project() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'spellagent project ')));
  roots.push(root); return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function discover(root: string, extra = {}) {
  const response = await handleRequest({ protocolVersion: 2, operation: 'discover', root, ...extra });
  if (response.operation !== 'discover') throw new Error('Expected discovery');
  return response;
}
async function extract(root: string, name: string, extra = {}) {
  const response = await handleRequest({ protocolVersion: 2, operation: 'extract', root, path: name, ...extra });
  if (response.operation !== 'extract') throw new Error('Expected extraction');
  return response;
}

it('works without configuration, never claims reviewed coverage, and creates no state', async () => {
  const root = await project();
  expect((await discover(root)).status).toBe('no_eligible_text');
  const source = '\uFEFF# Existing local prose\r\n\r\nA sentense without final newline';
  await writeFile(path.join(root, 'notes.md'), source);
  const result = await discover(root);
  expect(result.summary).toMatchObject({ filesEligible: 1, filesConsidered: 1, eligibleSegments: 2,
    suppressedSegments: 0, narrowCoverage: false, reviewedSegments: 0, filesChanged: 0 });
  expect(result.summary.byFormat).toMatchObject({ markdown: { files: 1, eligibleSegments: 2 } });
  expect(result.effectiveScope).toEqual({ root, targets: ['.'], dialect: 'en-US', includeHidden: false, glossary: [] });
  const page = await extract(root, 'notes.md');
  expect(page.snapshot).toMatchObject({ bom: true, eol: 'crlf' });
  expect(page.items.some(item => item.kind === 'notice' && item.code === 'anchor_may_change')).toBe(true);
  expect(await readFile(path.join(root, 'notes.md'), 'utf8')).toBe(source);
  expect(await readdir(root)).toEqual(['notes.md']);
});

it('merges scope overrides while retaining project exclusions and case-sensitive glossary', async () => {
  const root = await project();
  await writeFile(path.join(root, '.spellagentrc.json'), JSON.stringify({ schemaVersion: 2, dialect: 'en-US',
    include: ['**/*.md'], exclude: ['private/**'], glossary: ['SpellAgent'] }));
  const result = await loadPreferences(root, { dialect: 'en-GB', include: ['**/*.ts'], exclude: ['extra/**'], glossary: ['spellagent'] });
  expect(result).toMatchObject({ dialect: 'en-GB', include: ['**/*.ts'], exclude: ['private/**', 'extra/**'], glossary: ['SpellAgent', 'spellagent'] });
  await mkdir(path.join(root, 'private'));
  await writeFile(path.join(root, 'private/note.md'), 'Secret prose.');
  await expect(extract(root, 'private/note.md', { preferences: { exclude: [] } })).rejects.toThrow('config_exclude');
  await expect(discover(root, { preferences: { glossary: ['valid', ''] } })).rejects.toMatchObject({
    code: 'invalid_glossary', details: { invalidGlossaryIndexes: [1] },
  });
});

it('fails legacy and unknown preferences before enumerating or changing files', async () => {
  const root = await project();
  const config = JSON.stringify({ provider: { name: 'old' }, schemaVersion: 1 });
  await writeFile(path.join(root, '.spellagentrc.json'), config);
  await expect(discover(root)).rejects.toThrow('preferences_migration_required');
  expect(await readFile(path.join(root, '.spellagentrc.json'), 'utf8')).toBe(config);
  await writeFile(path.join(root, '.spellagentrc.json'), '{"schemaVersion":2,"typo":true}');
  await expect(discover(root)).rejects.toThrow('invalid_preferences');
});

it('enforces directory-only exclusions for both traversal and explicit descendant targets', async () => {
  const root = await project();
  await mkdir(path.join(root, 'private'));
  await writeFile(path.join(root, 'private/note.md'), 'Excluded prose.');
  const preferences = { exclude: ['private/'] };
  const walked = await discover(root, { preferences });
  expect(walked.items).toEqual([{ path: 'private', pathType: 'directory', state: 'skipped', code: 'config_exclude' }]);
  const explicit = await discover(root, { targets: ['private/note.md'], preferences });
  expect(explicit.items).toEqual([{ path: 'private/note.md', pathType: 'unknown', state: 'skipped', code: 'config_exclude' }]);
  await expect(extract(root, 'private/note.md', { preferences })).rejects.toThrow('config_exclude');
});

it('rejects malformed, unsafe expanded, and excessive brace globs before discovery', async () => {
  const root = await project();
  for (const pattern of ['docs/}', 'docs/{a,{b,c}}', '{..,docs}/**', '{/outside,docs}/**',
    '{!private,docs}/**', 'C:/docs/**', 'docs/\n*', '{a,b,c,d,e}{a,b,c,d,e}{a,b,c,d,e}{a,b,c,d,e}']) {
    await expect(discover(root, { preferences: { include: [pattern] } })).rejects.toThrow('invalid_glob');
  }
  await writeFile(path.join(root, 'note.md'), 'Eligible prose.');
  expect((await discover(root, { preferences: { include: ['**/*.{md,ts}'] } })).summary.filesEligible).toBe(1);
});

it('applies hidden and mandatory exclusions even to explicit targets', async () => {
  const root = await project();
  for (const folder of ['.hidden', '.git', '.spellagent', 'node_modules']) {
    await mkdir(path.join(root, folder)); await writeFile(path.join(root, folder, 'note.md'), 'A sentense.');
  }
  await expect(extract(root, '.hidden/note.md')).rejects.toThrow('hidden_path');
  expect((await extract(root, '.hidden/note.md', { preferences: { includeHidden: true } })).totalSegments).toBe(1);
  for (const folder of ['.git', '.spellagent', 'node_modules']) {
    await expect(extract(root, `${folder}/note.md`, { preferences: { includeHidden: true } })).rejects.toThrow('mandatory_directory');
  }
  await writeFile(path.join(root, '.env.md'), 'Credentials.');
  await expect(extract(root, '.env.md', { preferences: { includeHidden: true } })).rejects.toThrow('credential_file');
});

it('rejects explicit symlink ancestors, linked preferences, hard links, and root escapes', async () => {
  const root = await project(); const outside = await project();
  await writeFile(path.join(outside, 'note.md'), 'Outside prose.');
  await symlink(outside, path.join(root, 'linked'));
  await expect(extract(root, 'linked/note.md')).rejects.toThrow('symlink');
  await expect(discover(path.join(root, 'linked'))).rejects.toThrow('symlink');
  await expect(extract(root, '../note.md')).rejects.toThrow('invalid_request');
  await link(path.join(outside, 'note.md'), path.join(root, 'hard.md'));
  await expect(extract(root, 'hard.md')).rejects.toThrow('hard_link');
  await symlink(path.join(outside, 'note.md'), path.join(root, '.spellagentrc.json'));
  await expect(discover(root)).rejects.toThrow('preferences_read_failed');
});

it('accounts for every discovery page and detects changed scope', async () => {
  const root = await project();
  for (let index = 0; index < 40; index += 1) await writeFile(path.join(root, `file-${index}.md`), 'A sentense.');
  const first = await discover(root);
  expect(first.items).toHaveLength(32);
  const second = await discover(root, { cursor: first.nextCursor, scopeHash: first.scopeHash, policyHash: first.policyHash });
  expect(second.items).toHaveLength(8); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(item => item.path)).size).toBe(first.totalRecords);
  await writeFile(path.join(root, 'added.md'), 'Another sentence.');
  await expect(discover(root, { cursor: first.nextCursor, scopeHash: first.scopeHash, policyHash: first.policyHash })).rejects.toThrow('scope_mismatch');
});

it('accounts for all extracted records and rejects stale source, policy, and missing continuation tokens', async () => {
  const root = await project();
  await writeFile(path.join(root, 'pages.md'), fixtures.pages.source);
  const first = await extract(root, 'pages.md');
  let page = first;
  const ids = new Set<string>();
  let records = 0;
  for (;;) {
    expect(page.items.length).toBeLessThanOrEqual(32); expect(page.characters).toBeLessThanOrEqual(12_000);
    records += page.items.length;
    for (const item of page.items) if (item.kind === 'segment' || item.kind === 'skipped') {
      expect(ids.has(item.segmentId)).toBe(false); ids.add(item.segmentId);
    }
    if (page.nextCursor === null) break;
    page = await extract(root, 'pages.md', { cursor: page.nextCursor, snapshotHash: first.snapshotHash, policyHash: first.policyHash });
  }
  expect(ids.size).toBe(first.totalSegments); expect(records).toBe(first.totalRecords);
  await expect(extract(root, 'pages.md', { cursor: 1 })).rejects.toThrow('policy_mismatch');
  await expect(extract(root, 'pages.md', { cursor: 1, policyHash: first.policyHash })).rejects.toThrow('snapshot_mismatch');
  await expect(extract(root, 'pages.md', { cursor: 1, snapshotHash: first.snapshotHash, policyHash: first.policyHash,
    preferences: { glossary: ['sentense'] } })).rejects.toThrow('policy_mismatch');
  await writeFile(path.join(root, 'pages.md'), 'Changed local prose.');
  await expect(extract(root, 'pages.md', { snapshotHash: first.snapshotHash })).rejects.toThrow('snapshot_mismatch');
});

it('preserves Unicode byte mappings when safely splitting large prose and discloses unsplittable segments', async () => {
  const root = await project();
  const source = '\uFEFF' + 'A café 😀 sentense. '.repeat(1600);
  await writeFile(path.join(root, 'long.md'), source);
  const result = await extractLocalFile(root, 'long.md', await loadPreferences(root));
  expect(result.prepared.length).toBeGreaterThan(1);
  const text: string[] = [];
  for (const record of result.prepared) {
    expect(record.kind).toBe('segment'); if (record.kind !== 'segment') continue;
    text.push(record.segment.editableText);
    for (const span of record.segment.sourceMap) {
      expect(Buffer.from(source).subarray(span.source.startByte, span.source.endByte).toString('utf8'))
        .toBe(record.segment.editableText.slice(span.editableStartUtf16, span.editableEndUtf16));
    }
  }
  expect(text.join('')).toBe(result.segments.map(segment => segment.editableText).join(''));
  await writeFile(path.join(root, 'unsplit.md'), 'a'.repeat(13_000));
  const unsplit = await extract(root, 'unsplit.md');
  expect(unsplit.items).toContainEqual({ kind: 'skipped', segmentId: expect.any(String), code: 'oversized_segment' });
});

it('keeps generated detection syntax-aware and records invalid encodings and parse failures', async () => {
  const root = await project();
  await writeFile(path.join(root, 'generated.go'), '// Code generated by tool DO NOT EDIT.\npackage fixture\n');
  await writeFile(path.join(root, 'ordinary.ts'), 'const text = "@generated";\n// A sentense.\n');
  await writeFile(path.join(root, 'invalid.md'), Buffer.from([0xff]));
  await writeFile(path.join(root, 'binary.md'), Buffer.from([65, 0, 66]));
  await writeFile(path.join(root, 'large.md'), 'a'.repeat(1_048_577));
  await writeFile(path.join(root, 'broken.ts'), 'function {');
  const result = await discover(root);
  expect(result.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'generated.go', code: 'generated_marker' }),
    expect.objectContaining({ path: 'ordinary.ts', state: 'eligible' }),
    expect.objectContaining({ path: 'invalid.md', code: 'invalid_utf8' }),
    expect.objectContaining({ path: 'binary.md', code: 'binary' }),
    expect.objectContaining({ path: 'large.md', code: 'too_large' }),
    expect.objectContaining({ path: 'broken.ts', state: 'failed', code: 'parse_failed' }),
  ]));
  expect(result.status).toBe('incomplete');
  expect(result.summary.skippedByReason).toMatchObject({ generated_marker: 1, invalid_utf8: 1, binary: 1, too_large: 1 });
  expect(result.summary.failedByReason).toEqual({ parse_failed: 1 });
});

it('explains empty and narrow scope, including unsupported text files', async () => {
  const root = await project();
  await writeFile(path.join(root, 'notes.txt'), 'Plain prose is intentionally unsupported.');
  const empty = await discover(root);
  expect(empty).toMatchObject({ status: 'no_eligible_text', noEligibleTextReason: 'no_supported_file_types' });
  expect(empty.summary).toMatchObject({ filesEligible: 0, filesConsidered: 1, narrowCoverage: true,
    skippedByReason: { plain_text_unsupported: 1 } });
  expect(empty.items).toContainEqual(expect.objectContaining({ path: 'notes.txt', pathType: 'file',
    state: 'skipped', code: 'plain_text_unsupported' }));

  for (let index = 0; index < 3; index += 1) await writeFile(path.join(root, `eligible-${index}.md`), 'Eligible prose.');
  for (let index = 0; index < 7; index += 1) await writeFile(path.join(root, `unsupported-${index}.txt`), 'Unsupported prose.');
  expect((await discover(root)).summary).toMatchObject({ filesEligible: 3, filesConsidered: 11, narrowCoverage: true });
});

it('pages diagnostics as well as prose and rejects source-bearing or malformed edit requests', async () => {
  const root = await project();
  await writeFile(path.join(root, 'protected.md'), Array.from({ length: 50 }, () => '```ts\nconst x = 1;\n```\n').join('\n'));
  const first = await extract(root, 'protected.md');
  expect(first.totalSegments).toBe(0); expect(first.totalRecords).toBe(50); expect(first.items).toHaveLength(32);
  for (const request of [
    { operation: 'apply-file' }, { operation: 'extract', path: 'protected.md', source: 'injected' },
    { operation: 'discover', preferences: { model: 'disallowed' } },
  ]) await expect(handleRequest({ protocolVersion: 2, root, ...request })).rejects.toThrow('invalid_request');
});

it('retains each supported language in project extraction and its existing protection policy', async () => {
  const root = await project();
  const extensions = { markdown: 'md', javascript: 'jsx', typescript: 'ts', tsx: 'tsx', python: 'py', java: 'java', go: 'go', rust: 'rs' } as const;
  for (const [name, extension] of Object.entries(extensions)) {
    const fixture = fixtures[name as keyof typeof extensions];
    await writeFile(path.join(root, `fixture.${extension}`), fixture.source);
    const result = await extract(root, `fixture.${extension}`);
    expect(result.snapshot.format).toBe(fixture.format);
    expect(result.items.some(item => item.kind === 'segment' && item.editable.includes('sentense'))).toBe(true);
  }
});

it('excludes a file whose eligible-segment count exceeds the edit-response budget', async () => {
  const root = await project();
  const source = Array.from({ length: 10_001 }, (_, index) => `Paragraph ${index + 1} has a sentense.`).join('\n\n') + '\n';
  await writeFile(path.join(root, 'huge.md'), source);
  const preferences = await loadPreferences(root);
  await expect(extractLocalFile(root, 'huge.md', preferences)).rejects.toThrow('too_many_segments');
  const result = await discover(root);
  expect(result.items).toContainEqual(expect.objectContaining({ path: 'huge.md', state: 'skipped', code: 'too_many_segments' }));
}, 30_000);

it('preserves glossary byte ranges and syntax-aware suppression through discovery', async () => {
  const root = await project();
  await writeFile(path.join(root, 'note.ts'), '// spellagent-disable-next-line\n// Suppressed sentense.\n// SpellAgent and spellagent have a sentense.\n');
  const preferences = await loadPreferences(root, { glossary: ['SpellAgent'] });
  const result = await extractLocalFile(root, 'note.ts', preferences);
  expect(result.segments).toHaveLength(1);
  expect(result.coverage.suppressedSegments).toBe(1);
  const segment = result.segments[0]!;
  expect(segment.editableText).not.toContain('Suppressed');
  const protectedText = segment.protectedRanges.map(range => Buffer.from(result.source).subarray(range.startByte, range.endByte).toString('utf8'));
  expect(protectedText).toContain('SpellAgent');
  expect(protectedText).not.toContain('spellagent');
  const preview = await discover(root, { preferences: { glossary: ['SpellAgent'] } });
  expect(preview.summary.suppressedSegments).toBe(1);
  expect(preview.effectiveScope.glossary).toEqual(['SpellAgent']);
});
