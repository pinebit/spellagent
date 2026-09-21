import { chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { handleRequest } from '../src/plugin/protocol.js';
import { atomicReplace, withProjectWriteLock } from '../src/editing/write.js';
import { sha256 } from '../src/discovery/discover.js';

const roots: string[] = [];
async function project() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'spellagent phase c ')));
  roots.push(root); return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function extraction(root: string, name: string, preferences = {}) {
  const extractPage = async (extra = {}) => {
    const response = await handleRequest({ protocolVersion: 2, operation: 'extract', root, path: name, preferences, ...extra });
    if (response.operation !== 'extract') throw new Error('Expected extraction');
    return response;
  };
  const first = await extractPage();
  const items = [...first.items];
  let page = first;
  while (page.nextCursor !== null) {
    page = await extractPage({ cursor: page.nextCursor, policyHash: first.policyHash, snapshotHash: first.snapshotHash });
    items.push(...page.items);
  }
  const segments = items.filter(item => item.kind === 'segment');
  return { first, segments };
}

function responses(segments: readonly { segmentId: string }[], segmentId?: string, proposals: unknown[] = []) {
  return segments.map(segment => ({ segmentId: segment.segmentId,
    proposals: segment.segmentId === segmentId ? proposals : [] }));
}

it('validates a complete correction preview without source or persistent writes', async () => {
  const root = await project();
  const source = '\uFEFF# Café heading\r\n\r\nA sentense without final newline';
  await writeFile(path.join(root, 'notes.md'), source);
  const { first, segments } = await extraction(root, 'notes.md');
  const target = segments.find(item => item.editable.includes('sentense'))!;
  const result = await handleRequest({ protocolVersion: 2, operation: 'validate-file', root, path: 'notes.md',
    policyHash: first.policyHash, snapshotHash: first.snapshotHash,
    responses: responses(segments, target.segmentId, [{ original: 'sentense', replacement: 'sentence',
      category: 'spelling', reason: 'Correct a misspelling.' }]) });
  expect(result).toMatchObject({ operation: 'validate-file', mode: 'correction-preview', sourceWrites: false,
    status: 'validated', acceptedCount: 1, filesChanged: 0,
    accepted: [{ segmentId: target.segmentId, original: 'sentense', replacement: 'sentence' }] });
  expect(await readFile(path.join(root, 'notes.md'), 'utf8')).toBe(source);
  expect(await readdir(root)).toEqual(['notes.md']);
});

it('atomically applies a validated correction while preserving mode and writing source-free logs', async () => {
  const root = await project();
  const file = path.join(root, 'notes.md');
  await writeFile(file, '\uFEFFA café 😀 sentense.\r\n'); await chmod(file, 0o640);
  const { first, segments } = await extraction(root, 'notes.md');
  const result = await handleRequest({ protocolVersion: 2, operation: 'apply-file', root, path: 'notes.md',
    policyHash: first.policyHash, snapshotHash: first.snapshotHash,
    responses: responses(segments, segments[0]!.segmentId, [{ original: 'sentense', replacement: 'sentence',
      category: 'spelling', reason: 'Correct a misspelling.' }]) });
  expect(result).toMatchObject({ operation: 'apply-file', status: 'changed', sourceWrites: true,
    acceptedCount: 1, filesChanged: 1, categories: { spelling: 1 } });
  expect(await readFile(file, 'utf8')).toBe('\uFEFFA café 😀 sentence.\r\n');
  expect((await stat(file)).mode & 0o777).toBe(0o640);
  const logNames = await readdir(path.join(root, '.spellagent/logs'));
  expect(logNames).toHaveLength(1);
  const log = await readFile(path.join(root, '.spellagent/logs', logNames[0]!), 'utf8');
  expect(log).toContain('write_intent'); expect(log).toContain('write_complete');
  expect(log).not.toContain('sentense'); expect(log).not.toContain('sentence');
  expect(await readdir(path.join(root, '.spellagent'))).toEqual(['logs']);
});

it('requires exactly one response for every eligible segment and rejects invalid proposals without changing source', async () => {
  const root = await project();
  const file = path.join(root, 'notes.md');
  const source = '# First heading\n\nA sentense and another sentense.\n';
  await writeFile(file, source);
  const { first, segments } = await extraction(root, 'notes.md');
  const base = { protocolVersion: 2, operation: 'validate-file', root, path: 'notes.md',
    policyHash: first.policyHash, snapshotHash: first.snapshotHash } as const;
  await expect(handleRequest({ ...base, responses: [] })).rejects.toThrow('incomplete_segment_responses');
  await expect(handleRequest({ ...base, responses: [...responses(segments), responses(segments)[0]!] }))
    .rejects.toThrow('duplicate_segment_response');
  await expect(handleRequest({ ...base, responses: [{ segmentId: 'unknown', proposals: [] }, ...responses(segments)] }))
    .rejects.toThrow('unknown_segment_response');
  const repeated = segments.find(item => item.editable.includes('sentense'))!;
  await expect(handleRequest({ ...base, responses: responses(segments, repeated.segmentId, [{ original: 'sentense',
    replacement: 'sentence', category: 'spelling', reason: 'Correct it.' }]) })).rejects.toThrow('ambiguous_original');
  const heading = segments.find(item => item.editable.includes('heading'))!;
  await expect(handleRequest({ ...base, responses: responses(segments, heading.segmentId, [{ original: 'heading',
    replacement: '# heading', category: 'other', reason: 'Unsafe structure.' }]) })).rejects.toThrow('unsafe_delimiter_change');
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('rejects protected, overlapping, stale, excluded, locked, and cancelled applications', async () => {
  const root = await project();
  const file = path.join(root, 'notes.md');
  const source = 'SpellAgent has a sentense.\n';
  await writeFile(file, source);
  const preferences = { glossary: ['SpellAgent'] };
  let extracted = await extraction(root, 'notes.md', preferences);
  const segment = extracted.segments[0]!;
  const base = { protocolVersion: 2, operation: 'apply-file', root, path: 'notes.md', preferences,
    policyHash: extracted.first.policyHash, snapshotHash: extracted.first.snapshotHash } as const;
  await expect(handleRequest({ ...base, responses: responses(extracted.segments, segment.segmentId, [{ original: 'SpellAgent',
    replacement: 'Spell Agent', category: 'usage', reason: 'Change a protected term.' }]) })).rejects.toThrow('protected_range');
  await expect(handleRequest({ ...base, responses: responses(extracted.segments, segment.segmentId, [
    { original: 'a sentense', replacement: 'a sentence', category: 'spelling', reason: 'Correct it.' },
    { original: 'sentense', replacement: 'sentence', category: 'spelling', reason: 'Correct it twice.' },
  ]) })).rejects.toThrow('overlapping_proposals');
  await writeFile(file, 'Changed by an editor.\n');
  await expect(handleRequest({ ...base, responses: responses(extracted.segments) })).rejects.toThrow('snapshot_mismatch');

  await writeFile(file, source);
  extracted = await extraction(root, 'notes.md', preferences);
  await writeFile(path.join(root, '.spellagentrc.json'), JSON.stringify({ schemaVersion: 2, exclude: ['notes.md'] }));
  await expect(handleRequest({ ...base, policyHash: extracted.first.policyHash, snapshotHash: extracted.first.snapshotHash,
    responses: responses(extracted.segments) })).rejects.toThrow('policy_mismatch');
  await rm(path.join(root, '.spellagentrc.json'));

  extracted = await extraction(root, 'notes.md', preferences);
  await mkdir(path.join(root, '.spellagent'), { recursive: true });
  const lock = await open(path.join(root, '.spellagent/write.lock'), 'wx'); await lock.close();
  await expect(handleRequest({ ...base, policyHash: extracted.first.policyHash, snapshotHash: extracted.first.snapshotHash,
    responses: responses(extracted.segments) })).rejects.toThrow('write_lock_contended');
  await rm(path.join(root, '.spellagent/write.lock'));
  const cancellation = new AbortController(); cancellation.abort();
  await expect(handleRequest({ ...base, policyHash: extracted.first.policyHash, snapshotHash: extracted.first.snapshotHash,
    responses: responses(extracted.segments) }, cancellation.signal)).rejects.toThrow('cancelled');
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('cancels after write intent without replacing source and records a source-free abort', async () => {
  const root = await project();
  const absolute = path.join(root, 'notes.md');
  const source = Buffer.from('A sentense.\n');
  const candidate = Buffer.from('A sentence.\n');
  await writeFile(absolute, source);
  const cancellation = new AbortController();
  await expect(withProjectWriteLock(root, cancellation.signal, logDirectory => atomicReplace({
    absolute, relative: 'notes.md', expectedHash: sha256(source), candidate,
    candidateHash: sha256(candidate), proposalCount: 1, logDirectory, signal: cancellation.signal,
    beforeReplace: async () => cancellation.abort(),
  }))).rejects.toThrow('cancelled');
  expect(await readFile(absolute)).toEqual(source);
  expect((await readdir(root)).filter(name => name.includes('.spellagent-'))).toEqual([]);
  const logNames = await readdir(path.join(root, '.spellagent/logs'));
  const log = await readFile(path.join(root, '.spellagent/logs', logNames[0]!), 'utf8');
  expect(log).toContain('write_intent'); expect(log).toContain('write_aborted');
  expect(log).not.toContain('sentense'); expect(log).not.toContain('sentence');
});
