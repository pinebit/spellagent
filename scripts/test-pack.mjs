// Historical CLI packaging probe, retained until Phase B. Not npm run test:pack.
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--prepare-cache')) throw new Error('Unknown packaging option');
const prepareCache = args[0] === '--prepare-cache';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Legacy probe requires npm execution (prepare:pack-cache)');
const temporary = await mkdtemp(path.join(tmpdir(), 'spellagent-pack-'));
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  npm(['run', 'build'], root);
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root))[0];
  const files = packed.files.map(file => file.path);
  for (const required of ['LICENSE', 'docs/new-plan.md', 'assets/inventory.json', 'dist/cli/index.js']) {
    assert.ok(files.includes(required), `Missing ${required}`);
  }
  assert.equal(files.filter(file => file.endsWith('.wasm')).length, 7);
  assert.ok(!files.some(file => file.startsWith('src/') || file.startsWith('tests/') || file.endsWith('.node') || file.includes('.env')));
  const install = path.join(temporary, 'isolated project with spaces');
  await mkdir(install);
  await writeFile(path.join(install, 'package.json'), '{"name":"pack-probe","version":"1.0.0","private":true}');
  npm(['install', ...(prepareCache ? [] : ['--offline']), '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev',
    path.join(temporary, packed.filename)], install);
  const packageRoot = path.join(install, 'node_modules', 'spellagent');
  const cli = path.join(packageRoot, 'dist', 'cli', 'index.js');
  // Execute from an unrelated directory to catch working-directory-dependent assets.
  const run = args => execFileSync(process.execPath, [cli, ...args], { cwd: temporary, encoding: 'utf8' });
  const help = run(['--help']);
  assert.match(help, /init \[options\]/);
  assert.match(help, /run \[options\] \[paths\.\.\.\]/);
  assert.equal(run(['--version']).trim(), '0.0.0');
  const report = JSON.parse(execFileSync(process.execPath, [path.join(packageRoot, 'dist/probes/offline.js')],
    { cwd: temporary, encoding: 'utf8' }));
  assert.equal(report.parsers.length, 8);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.bin.spellagent, 'dist/cli/index.js');
  assert.ok((await readFile(cli, 'utf8')).startsWith('#!/usr/bin/env node'));
  if (process.platform !== 'win32') {
    const shim = path.join(install, 'node_modules', '.bin', 'spellagent');
    assert.equal(execFileSync(shim, ['--version'], { cwd: temporary, encoding: 'utf8' }).trim(), '0.0.0');
  } else {
    assert.match(await readFile(path.join(install, 'node_modules', '.bin', 'spellagent.cmd'), 'utf8'), /cli[\\/]index\.js/);
  }
  const globalPrefix = path.join(temporary, 'global prefix');
  npm(['install', '--global', '--prefix', globalPrefix, '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', path.join(temporary, packed.filename)], temporary);
  const globalPackage = path.join(globalPrefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'spellagent');
  assert.equal(JSON.parse(execFileSync(process.execPath, [path.join(globalPackage, 'dist/probes/offline.js')], { cwd: temporary, encoding: 'utf8' })).parsers.length, 8);
  if (process.platform !== 'win32') {
    assert.equal(execFileSync(path.join(globalPrefix, 'bin', 'spellagent'), ['--version'], { cwd: temporary, encoding: 'utf8' }).trim(), '0.0.0');
  } else {
    assert.match(await readFile(path.join(globalPrefix, 'spellagent.cmd'), 'utf8'), /cli[\\/]index\.js/);
  }
  const inventory = JSON.parse(await readFile(path.join(packageRoot, 'assets/inventory.json'), 'utf8'));
  for (const entry of inventory) {
    assert.equal(entry.license, 'MIT');
    assert.ok((await readFile(path.join(packageRoot, 'assets/licenses', `${entry.package}.txt`), 'utf8')).includes('Permission'));
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version,
    packedBytes: packed.size, unpackedBytes: packed.unpackedSize, parsers: report.parsers.length,
    offlineInstall: !prepareCache, localAndGlobalInstall: true, devDependenciesRequired: false }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
