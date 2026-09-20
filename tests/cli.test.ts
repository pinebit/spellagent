import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
it('shows help without arguments, exposes only init/run, and rejects removed commands', () => {
  const help = execFileSync(process.execPath, [cli], { encoding: 'utf8' });
  expect(help).toContain('init');
  expect(help).toContain('run');
  for (const command of ['scan', 'review', 'apply', 'runs', 'recover', 'probe']) {
    const invalid = spawnSync(process.execPath, [cli, command], { encoding: 'utf8' });
    expect(invalid.status, command).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain('error:');
    expect(invalid.stderr).toContain(command);
  }
});
it('requires config before dry-run discovery and labels non-dry execution unavailable', () => {
  const missing = spawnSync(process.execPath, [cli, 'run', '--dry-run'], { encoding: 'utf8' });
  expect(missing.status).toBe(2);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toContain('spellagent init');
});
it('initializes through the same prompts with scripted stdin and aborts cleanly on EOF', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spellagent-init-'));
  const answers = '\n\n\n\n\n\n\n\nY\n';
  const initialized = spawnSync(process.execPath, [cli, 'init', '--root', root], { input: answers, encoding: 'utf8' });
  expect(initialized.status).toBe(0);
  const config = JSON.parse(readFileSync(path.join(root, '.spellagentrc.json'), 'utf8')) as { provider: { name: string }; limits: { maxAgents: number } };
  expect(config).toMatchObject({ provider: { name: 'openai' }, limits: { maxAgents: 32 } });

  const cancelledRoot = mkdtempSync(path.join(os.tmpdir(), 'spellagent-init-eof-'));
  const cancelled = spawnSync(process.execPath, [cli, 'init', '--root', cancelledRoot], { input: '', encoding: 'utf8' });
  expect(cancelled.status).toBe(130);
  expect(cancelled.stderr).toContain('cancelled');
});
it('prints one offline JSON dry-run report without requiring credentials', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spellagent-dry-run-'));
  writeFileSync(path.join(root, '.spellagentrc.json'), JSON.stringify({ provider: { name: 'openai', model: 'offline-test' } }));
  writeFileSync(path.join(root, 'README.md'), '# Heading\n\nEligible prose.\n');
  const result = spawnSync(process.execPath, [cli, 'run', '--root', root, '--dry-run', '--format', 'json'], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'dry-run', status: 'complete', counts: { eligibleFiles: 1 } });
});
it('requires explicit paid opt-in before the live smoke can access credentials', () => {
  const live = fileURLToPath(new URL('../dist/probes/live.js', import.meta.url));
  const result = spawnSync(process.execPath, [live, 'gateway', 'openai/test'], { encoding: 'utf8' });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('--allow-paid');
  expect(result.stdout).toBe('');
});
