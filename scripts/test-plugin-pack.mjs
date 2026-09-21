// Offline development check; does not install plugins into either host.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const env = { PATH: process.env.PATH, NO_COLOR: '1', npm_config_update_notifier: 'false' };
const build = spawnSync('npm', ['run', 'build:plugins'], { cwd: root, env, stdio: 'inherit' });
assert.equal(build.status, 0, 'Plugin build failed');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'spellagent plugin checks '));
try {
  const cwd = path.join(temporary, 'unrelated working directory');
  await mkdir(cwd);
  for (const host of ['codex', 'claude']) {
    const plugin = path.join(temporary, host, 'spellagent');
    await cp(path.join(root, 'build/plugins', host, 'spellagent'), plugin, { recursive: true });
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
    const failure = spawnSync(process.execPath, [helper], { cwd, env,
      input: '{"source":"private sentinel"}', encoding: 'utf8', timeout: 30_000 });
    assert.equal(failure.status, 2);
    assert.equal(JSON.parse(failure.stdout).code, 'invalid_request');
    assert.ok(!failure.stdout.includes('private sentinel'));
    for (const [input, code] of [
      ['not JSON', 'invalid_json'],
      [Buffer.from([0xff]), 'invalid_json'],
      ['x'.repeat(4097), 'request_too_large'],
    ]) {
      const invalid = spawnSync(process.execPath, [helper], { cwd, env, input,
        encoding: 'utf8', timeout: 30_000 });
      assert.equal(invalid.status, 2);
      assert.equal(JSON.parse(invalid.stdout).code, code);
    }
    assert.deepEqual((await readdir(path.join(runtime, 'dist'))).sort(), ['extractors', 'plugin']);
    const dependencies = JSON.parse(await readFile(path.join(runtime, 'dependencies.json'), 'utf8'));
    assert.ok(dependencies.some(entry => entry.name === 'web-tree-sitter'));
    assert.ok(!dependencies.some(entry => /ai-sdk|^ai$|commander/.test(entry.name)));
    const grammarInventory = JSON.parse(await readFile(path.join(runtime, 'assets/inventory.json'), 'utf8'));
    assert.equal(grammarInventory.length, 7);
    const skill = await readFile(path.join(plugin, 'skills/check/SKILL.md'), 'utf8');
    assert.ok(skill.startsWith('---\n'));
    assert.ok((await readFile(path.join(plugin, 'skills/check/workflow.md'), 'utf8')).length > 0);
    assert.deepEqual(await readdir(cwd), [], 'Helper wrote into working directory');
    console.log(`${host}: isolated packaged synthetic extraction passed (not a host integration pass).`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
