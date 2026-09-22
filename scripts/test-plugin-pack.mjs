// Offline development check; does not install plugins into either host.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, mkdir, realpath, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const env = { PATH: process.env.PATH, NO_COLOR: '1', npm_config_update_notifier: 'false' };
const build = spawnSync('npm', ['run', 'build:plugins'], { cwd: root, env, stdio: 'inherit' });
assert.equal(build.status, 0, 'Plugin build failed');
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'spellagent plugin checks ')));
// Claude qualification/tests are explicitly deferred by the project owner.
const hosts = (process.env.SPELLAGENT_TEST_HOSTS ?? 'codex,claude').split(',');
assert.ok(hosts.length > 0 && hosts.every(host => ['codex', 'claude'].includes(host)), 'Invalid test hosts');
async function permissions(directory, readonly) {
  await chmod(directory, readonly ? 0o555 : 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await permissions(file, readonly);
    else await chmod(file, readonly ? 0o444 : 0o644);
  }
}
try {
  const cwd = path.join(temporary, 'unrelated working directory');
  await mkdir(cwd);
  for (const host of hosts) {
    const plugin = path.join(temporary, host, 'spellagent');
    await cp(path.join(root, 'build/plugins', host, 'spellagent'), plugin, { recursive: true });
    await permissions(plugin, true);
    const runtime = path.join(plugin, 'runtime');
    const helper = path.join(runtime, 'dist/plugin/helper.js');
    const manifests = host === 'codex'
      ? ['plugin.json', '.codex-plugin/plugin.json'] : ['.claude-plugin/plugin.json'];
    for (const relative of manifests) {
      const manifest = JSON.parse(await readFile(path.join(plugin, relative), 'utf8'));
      assert.equal(manifest.name, 'spellagent');
      assert.equal(manifest.version, version);
    }
    const run = input => {
      const result = spawnSync(process.execPath, [helper], { cwd, env,
        input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 30_000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stderr, '');
      const response = JSON.parse(result.stdout);
      assert.equal(response.ok, true);
      return response;
    };
    const list = run({ protocolVersion: 1, operation: 'list-fixtures' });
    assert.equal(list.sourceWrites, false);
    assert.equal(list.fixtures.length, 10);
    for (const fixture of list.fixtures) {
      let cursor = 0;
      let snapshotHash;
      const ids = new Set();
      let pages = 0;
      let skipped = 0;
      do {
        const response = run({ protocolVersion: 1, operation: 'extract-fixture', fixture, cursor, snapshotHash });
        if (snapshotHash) assert.equal(response.snapshotHash, snapshotHash);
        snapshotHash = response.snapshotHash;
        assert.ok(response.characters <= 12_000);
        assert.ok(response.segments.length + response.skipped.length <= 32);
        for (const record of [...response.segments, ...response.skipped]) {
          assert.ok(!ids.has(record.segmentId));
          ids.add(record.segmentId);
        }
        skipped += response.skipped.length;
        cursor = response.nextCursor;
        pages += 1;
        assert.ok(pages <= 100, 'Pagination did not terminate');
        if (cursor === null) assert.equal(ids.size, response.totalSegments);
      } while (cursor !== null);
      assert.ok(ids.size > 0, `No segments: ${fixture}`);
      if (fixture === 'pages') assert.ok(pages > 1);
      if (fixture === 'oversized') assert.ok(skipped > 0);
    }
    const project = path.join(temporary, `${host} synthetic project`);
    await mkdir(project);
    const source = '\uFEFF# Heading\r\n\r\nA sentense.';
    await writeFile(path.join(project, 'notes.md'), source);
    const discovery = run({ protocolVersion: 2, operation: 'discover', root: project });
    assert.equal(discovery.summary.filesEligible, 1);
    assert.equal(discovery.summary.filesConsidered, 1);
    assert.equal(discovery.summary.byFormat.markdown.files, 1);
    assert.equal(discovery.summary.narrowCoverage, false);
    assert.equal(discovery.summary.reviewedSegments, 0);
    assert.deepEqual(discovery.effectiveScope, { root: project, targets: ['.'], dialect: 'en-US', includeHidden: false, glossary: [] });
    const invalidGlossary = spawnSync(process.execPath, [helper], { cwd, env,
      input: JSON.stringify({ protocolVersion: 2, operation: 'discover', root: project,
        preferences: { glossary: ['valid', ''] } }), encoding: 'utf8' });
    assert.equal(invalidGlossary.status, 2);
    assert.deepEqual(JSON.parse(invalidGlossary.stdout), { ok: false, protocolVersion: 2,
      code: 'invalid_glossary', invalidGlossaryIndexes: [1] });
    const extraction = run({ protocolVersion: 2, operation: 'extract', root: project, path: 'notes.md',
      policyHash: discovery.policyHash, snapshotHash: discovery.items[0].snapshot.sha256 });
    assert.equal(extraction.snapshot.bom, true);
    assert.ok(extraction.items.some(item => item.kind === 'segment' && item.editable.includes('sentense')));
    const segmentItems = extraction.items.filter(item => item.kind === 'segment');
    const correctionTarget = segmentItems.find(item => item.editable.includes('sentense'));
    const responses = segmentItems.map(item => ({ segmentId: item.segmentId, proposals: item === correctionTarget ? [{
      original: 'sentense', replacement: 'sentence', category: 'spelling', reason: 'Correct a misspelling.',
    }] : [] }));
    const preview = run({ protocolVersion: 2, operation: 'validate-file', root: project, path: 'notes.md',
      policyHash: extraction.policyHash, snapshotHash: extraction.snapshotHash, responses });
    assert.equal(preview.acceptedCount, 1); assert.equal(preview.filesChanged, 0);
    assert.equal(await readFile(path.join(project, 'notes.md'), 'utf8'), source);
    assert.deepEqual(await readdir(project), ['notes.md']);
    const applied = run({ protocolVersion: 2, operation: 'apply-file', root: project, path: 'notes.md',
      policyHash: extraction.policyHash, snapshotHash: extraction.snapshotHash, responses });
    assert.equal(applied.acceptedCount, 1); assert.equal(applied.filesChanged, 1);
    assert.equal(await readFile(path.join(project, 'notes.md'), 'utf8'), source.replace('sentense', 'sentence'));
    const logFiles = await readdir(path.join(project, '.spellagent/logs'));
    assert.equal(logFiles.length, 1);
    const applicationLog = await readFile(path.join(project, '.spellagent/logs', logFiles[0]), 'utf8');
    assert.ok(applicationLog.includes('write_complete'));
    assert.ok(!applicationLog.includes('sentense') && !applicationLog.includes('sentence'));
    await writeFile(path.join(project, '.spellagentrc.json'), '{"schemaVersion":1,"provider":{}}');
    const migration = spawnSync(process.execPath, [helper], { cwd, env,
      input: JSON.stringify({ protocolVersion: 2, operation: 'discover', root: project }), encoding: 'utf8' });
    assert.equal(migration.status, 2);
    const migrationResponse = JSON.parse(migration.stdout);
    assert.equal(migrationResponse.code, 'preferences_migration_required');
    assert.ok(migrationResponse.guidance.includes('schemaVersion: 2'));
    const failure = spawnSync(process.execPath, [helper], { cwd, env,
      input: '{"source":"private sentinel"}', encoding: 'utf8', timeout: 30_000 });
    assert.equal(failure.status, 2);
    assert.equal(JSON.parse(failure.stdout).code, 'invalid_request');
    assert.ok(!failure.stdout.includes('private sentinel'));
    for (const [input, code] of [
      ['not JSON', 'invalid_json'],
      [Buffer.from([0xff]), 'invalid_json'],
      ['x'.repeat(2 * 1024 * 1024 + 1), 'request_too_large'],
    ]) {
      const invalid = spawnSync(process.execPath, [helper], { cwd, env, input,
        encoding: 'utf8', timeout: 30_000 });
      assert.equal(invalid.status, 2);
      assert.equal(JSON.parse(invalid.stdout).code, code);
    }
    assert.deepEqual((await readdir(path.join(runtime, 'dist'))).sort(), ['core', 'discovery', 'editing', 'extractors', 'plugin']);
    const dependencies = JSON.parse(await readFile(path.join(runtime, 'dependencies.json'), 'utf8'));
    assert.ok(dependencies.some(entry => entry.name === 'web-tree-sitter'));
    assert.ok(!dependencies.some(entry => /ai-sdk|^ai$|commander/.test(entry.name)));
    const grammarInventory = JSON.parse(await readFile(path.join(runtime, 'assets/inventory.json'), 'utf8'));
    assert.equal(grammarInventory.length, 7);
    const skill = await readFile(path.join(plugin, 'skills/check/SKILL.md'), 'utf8');
    assert.ok(skill.startsWith('---\n'));
    assert.ok((await readFile(path.join(plugin, 'skills/check/workflow.md'), 'utf8')).length > 0);
    assert.deepEqual(await readdir(cwd), [], 'Helper wrote into working directory');
    console.log(`${host}: isolated packaged fixture/project protocol passed (not a host integration pass).`);
  }
} finally {
  await permissions(temporary, false);
  await rm(temporary, { recursive: true, force: true });
}
