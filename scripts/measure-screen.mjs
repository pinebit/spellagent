// Live, opt-in measurement of the TypeSafe pre-screen gate. Requires
// TYPESAFE_API_KEY and network access, and makes real (inexpensive) Jev calls;
// never part of the default offline checks. Run `npm run build` first.
//
// Every gold file contains labeled errors, so each should be flagged (file-level
// gate recall). Every file under tests/fixtures/quality/clean/ is error-free, so
// each should pass (skip rate). The per-threshold table helps tune
// SCREEN_THRESHOLD in src/screening/screen.ts.
import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const quality = path.join(repository, 'tests/fixtures/quality');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('TYPESAFE_API_KEY is not set; this live measurement needs it.');
  process.exit(1);
}
const { handleRequest } = await import(pathToFileURL(path.join(repository, 'dist/plugin/protocol.js')).href);
const { SCREEN_THRESHOLD } = await import(pathToFileURL(path.join(repository, 'dist/screening/screen.js')).href);

async function listFiles(directory, base) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const expectations = [];
for (const gold of ['gold.json', 'gold-held-out.json']) {
  for (const file of JSON.parse(await readFile(path.join(quality, gold), 'utf8'))) {
    expectations.push({ path: file.path, dialect: file.dialect, expected: 'flagged' });
  }
}
for (const file of await listFiles(path.join(quality, 'clean'), quality)) {
  expectations.push({ path: file, dialect: /-en-gb\./u.test(file) ? 'en-GB' : 'en-US', expected: 'clean' });
}

// Screen a scratch copy so discovery never runs against tracked repository files.
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'spellagent screen measure ')));
const results = [];
let inputTokens = 0;
let screeningModel = null;
try {
  for (const directory of ['corpus', 'held-out', 'clean']) {
    await cp(path.join(quality, directory), path.join(scratch, directory), { recursive: true });
  }
  for (const dialect of ['en-US', 'en-GB']) {
    const group = expectations.filter(item => item.dialect === dialect);
    if (group.length === 0) continue;
    const request = { protocolVersion: 2, root: scratch, targets: group.map(item => item.path), preferences: { dialect } };
    const scope = await handleRequest({ ...request, operation: 'discover' });
    if (scope.nextCursor !== null) throw new Error('Measurement scope exceeds one discovery page');
    const eligible = new Set(scope.items.filter(item => item.state === 'eligible').map(item => item.path));
    for (const item of group) if (!eligible.has(item.path)) results.push({ ...item, verdict: 'not_eligible', errorProbability: null });
    let cursor = 0;
    while (cursor !== null) {
      const page = await handleRequest({ ...request, operation: 'screen',
        policyHash: scope.policyHash, scopeHash: scope.scopeHash, cursor });
      inputTokens += page.usage.inputTokens;
      screeningModel ??= page.screeningModel;
      for (const item of page.items) {
        const expectation = group.find(entry => entry.path === item.path);
        results.push({ ...expectation, verdict: item.verdict, errorProbability: item.errorProbability, code: item.code });
      }
      cursor = page.nextCursor;
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

results.sort((left, right) => left.path.localeCompare(right.path));
for (const item of results) {
  const probability = item.errorProbability === null ? '   -  ' : item.errorProbability.toFixed(3);
  const mark = item.verdict === item.expected ? ' ' : '✗';
  console.log(`${mark} ${probability}  ${item.verdict.padEnd(12)} expected ${item.expected.padEnd(8)} ${item.path}`);
}
const flaggedExpected = results.filter(item => item.expected === 'flagged');
const cleanExpected = results.filter(item => item.expected === 'clean');
const rate = (items, predicate) => items.length ? `${items.filter(predicate).length}/${items.length}` : '0/0';
console.log(`\nModel: ${screeningModel ?? 'unknown'}; input tokens: ${inputTokens}; current threshold: ${SCREEN_THRESHOLD}`);
console.log('threshold  gate recall (gold flagged)  skip rate (clean passed)');
for (const threshold of [0.05, 0.1, 0.2, 0.3, 0.5, 0.7]) {
  const flagged = item => item.errorProbability !== null && item.errorProbability >= threshold;
  const recall = rate(flaggedExpected, item => item.code !== undefined || flagged(item));
  const skip = rate(cleanExpected, item => item.verdict === 'no_segments' || (item.errorProbability !== null && !flagged(item)));
  console.log(`${String(threshold).padEnd(10)} ${recall.padEnd(26)} ${skip}`);
}
if (output) {
  await writeFile(output, JSON.stringify({ screeningModel, inputTokens, threshold: SCREEN_THRESHOLD, results }, null, 2) + '\n');
}
