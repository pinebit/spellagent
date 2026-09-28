import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/plugin/protocol.js';
import { SCREEN_PAGE_FILES, SCREEN_THRESHOLD } from '../src/screening/screen.js';
import { TYPESAFE_ENDPOINT } from '../src/screening/typesafe.js';

const KEY = 'ts-test-key-sentinel';
const roots: string[] = [];
async function project(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'spellagent screen ')));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  return root;
}
beforeEach(() => { vi.stubEnv('TYPESAFE_API_KEY', KEY); });
afterEach(async () => {
  vi.unstubAllEnvs();
  // Restore the offline guard from tests/setup.ts.
  vi.stubGlobal('fetch', () => { throw new Error('Network access is forbidden in default tests'); });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Call = { url: string; init: RequestInit; body: { model: string; state: { dialect: string; glossary: string[]; prose: string[] };
  questions: Record<string, { type: string }> } };
function mockFetch(respond: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return respond(call, calls.length - 1);
  }));
  return calls;
}
const noul = (value: number) => new Response(JSON.stringify({ model: 'jev-1.13.0',
  answers: { answer: { type: 'noul', noul: value } }, usage: { input_tokens: 100, output_tokens: 1 } }), { status: 200 });
const prose = (call: Call) => call.body.state.prose.join('\n');

async function discover(root: string, extra = {}) {
  const response = await handleRequest({ protocolVersion: 2, operation: 'discover', root, ...extra });
  if (response.operation !== 'discover') throw new Error('Expected discovery');
  return response;
}
async function screen(root: string, extra: Record<string, unknown> = {}, signal?: AbortSignal) {
  const scope = await discover(root, 'preferences' in extra ? { preferences: extra.preferences } : {});
  const response = await handleRequest({ protocolVersion: 2, operation: 'screen', root,
    policyHash: scope.policyHash, scopeHash: scope.scopeHash, ...extra }, signal);
  if (response.operation !== 'screen') throw new Error('Expected screening');
  return response;
}

it('refuses without a key before extraction or any network call', async () => {
  const root = await project({ 'notes.md': 'A sentense.' });
  const scope = await discover(root);
  const calls = mockFetch(() => noul(0.9));
  for (const value of ['', '   ']) {
    vi.stubEnv('TYPESAFE_API_KEY', value);
    await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root,
      policyHash: scope.policyHash, scopeHash: scope.scopeHash })).rejects.toMatchObject({ code: 'typesafe_api_key_missing' });
  }
  // The key check precedes root resolution, so even an invalid root reports the missing key.
  await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root: '/nonexistent/root',
    policyHash: scope.policyHash, scopeHash: scope.scopeHash })).rejects.toMatchObject({ code: 'typesafe_api_key_missing' });
  expect(calls).toHaveLength(0);
});

it('flags files with likely errors, passes clean files, and sends only editable prose with preferences', async () => {
  const root = await project({ 'clean.md': 'A correct sentence.', 'typo.md': 'A sentense with an error.' });
  const calls = mockFetch(call => noul(prose(call).includes('sentense') ? 0.93 : 0.04));
  const result = await screen(root, { preferences: { dialect: 'en-GB', glossary: ['SpellAgent'] } });
  expect(result.items).toEqual([
    { path: 'clean.md', snapshotHash: expect.any(String), verdict: 'clean', errorProbability: 0.04 },
    { path: 'typo.md', snapshotHash: expect.any(String), verdict: 'flagged', errorProbability: 0.93 },
  ]);
  expect(result).toMatchObject({ mode: 'screen', sourceWrites: false, totalFiles: 2, nextCursor: null,
    threshold: SCREEN_THRESHOLD, screeningModel: 'jev-1.13.0', usage: { inputTokens: 200 } });
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.url).toBe(TYPESAFE_ENDPOINT);
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(call.body.model).toBe('jev-latest');
    expect(call.body.state).toMatchObject({ dialect: 'en-GB', glossary: ['SpellAgent'] });
    expect(Object.values(call.body.questions).map(question => question.type)).toEqual(['noul']);
  }
  expect(JSON.stringify(result)).not.toContain(KEY);
  expect(await readdir(root)).toEqual(['clean.md', 'typo.md']);
});

it('treats the threshold as inclusive', async () => {
  const root = await project({ 'a.md': 'First file.', 'b.md': 'Second file.' });
  mockFetch(call => noul(prose(call).includes('First') ? SCREEN_THRESHOLD : SCREEN_THRESHOLD - 0.01));
  const result = await screen(root);
  expect(result.items.map(item => item.verdict)).toEqual(['flagged', 'clean']);
});

it('splits large files into chunks and flags the file when any chunk is flagged', async () => {
  const paragraph = (index: number) => `Paragraph ${index} ${'reads well and stays correct '.repeat(35)}`.trim();
  const paragraphs = Array.from({ length: 70 }, (_, index) => paragraph(index));
  paragraphs[65] += ' A sentense.';
  const root = await project({ 'large.md': paragraphs.join('\n\n') });
  const calls = mockFetch(call => noul(prose(call).includes('sentense') ? 0.9 : 0.01));
  const result = await screen(root);
  expect(calls.length).toBeGreaterThan(1);
  for (const call of calls) expect(prose(call).length).toBeLessThanOrEqual(60_000 + call.body.state.prose.length);
  expect(calls.flatMap(call => call.body.state.prose)).toEqual(paragraphs);
  expect(result.items).toEqual([expect.objectContaining({ path: 'large.md', verdict: 'flagged', errorProbability: 0.9 })]);
});

it('reports files without prose segments without calling the service', async () => {
  const root = await project({ 'code.ts': 'export const answer = 42;\n' });
  const calls = mockFetch(() => noul(0.9));
  const result = await screen(root);
  expect(result.items).toEqual([{ path: 'code.ts', snapshotHash: expect.any(String), verdict: 'no_segments', errorProbability: null }]);
  expect(calls).toHaveLength(0);
});

it('pages through eligible files so each is screened exactly once', async () => {
  const files = Object.fromEntries(Array.from({ length: SCREEN_PAGE_FILES + 3 }, (_, index) =>
    [`file-${String(index).padStart(2, '0')}.md`, `Prose number ${index}.`]));
  const root = await project(files);
  mockFetch(() => noul(0.01));
  const scope = await discover(root);
  const seen: string[] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page = await handleRequest({ protocolVersion: 2, operation: 'screen', root,
      policyHash: scope.policyHash, scopeHash: scope.scopeHash, cursor });
    if (page.operation !== 'screen') throw new Error('Expected screening');
    expect(page.totalFiles).toBe(SCREEN_PAGE_FILES + 3);
    seen.push(...page.items.map(item => item.path));
    cursor = page.nextCursor;
  }
  expect(seen).toEqual(Object.keys(files).sort());
  await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root, policyHash: scope.policyHash,
    scopeHash: scope.scopeHash, cursor: SCREEN_PAGE_FILES + 4 })).rejects.toMatchObject({ code: 'invalid_cursor' });
});

it('requires matching policy and scope hashes', async () => {
  const root = await project({ 'notes.md': 'Some prose.' });
  mockFetch(() => noul(0.01));
  const scope = await discover(root);
  await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root })).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root, policyHash: scope.policyHash,
    scopeHash: scope.scopeHash, preferences: { dialect: 'en-GB' } })).rejects.toMatchObject({ code: 'policy_mismatch' });
  await writeFile(path.join(root, 'notes.md'), 'Changed prose.');
  await expect(handleRequest({ protocolVersion: 2, operation: 'screen', root, policyHash: scope.policyHash,
    scopeHash: scope.scopeHash })).rejects.toMatchObject({ code: 'scope_mismatch' });
});

it('retries rate limiting and overload, then succeeds', async () => {
  const root = await project({ 'notes.md': 'Some prose.' });
  const calls = mockFetch((_, index) => index === 0 ? new Response('', { status: 429 }) : noul(0.5));
  const result = await screen(root);
  expect(calls).toHaveLength(2);
  expect(result.items[0]).toMatchObject({ verdict: 'flagged', errorProbability: 0.5 });
});

it('stops after bounded retries when the service stays unavailable', async () => {
  const root = await project({ 'notes.md': 'Some prose.' });
  const calls = mockFetch(() => new Response('', { status: 529 }));
  await expect(screen(root)).rejects.toMatchObject({ code: 'typesafe_unavailable', details: { status: 529 } });
  expect(calls).toHaveLength(3);
});

it('maps service failures to source-free errors that never include the key or prose', async () => {
  const root = await project({ 'notes.md': 'Private sentinel prose.' });
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => new Response('bad key', { status: 401 }), 'typesafe_auth_failed'],
    [() => new Response('forbidden', { status: 403 }), 'typesafe_auth_failed'],
    [() => new Response(JSON.stringify({ detail: 'Private sentinel prose.' }), { status: 422 }), 'typesafe_invalid_response'],
    [() => new Response('not json', { status: 200 }), 'typesafe_invalid_response'],
    [() => new Response(JSON.stringify({ model: 'jev', answers: { answer: { type: 'noul', noul: 2 } } }), { status: 200 }),
      'typesafe_invalid_response'],
    [() => { throw new TypeError('fetch failed'); }, 'typesafe_unreachable'],
  ];
  for (const [respond, code] of cases) {
    mockFetch(respond);
    const error = await screen(root).then(() => undefined, (failure: unknown) => failure);
    expect(error).toMatchObject({ code });
    const serialized = JSON.stringify({ message: (error as Error).message, details: (error as { details: unknown }).details });
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('Private sentinel');
  }
});

it('reports cancellation instead of a network failure', async () => {
  const root = await project({ 'notes.md': 'Some prose.' });
  const controller = new AbortController();
  mockFetch(call => {
    controller.abort();
    const signal = call.init.signal!;
    return new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); });
  });
  await expect(screen(root, {}, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
});
