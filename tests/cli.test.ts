import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
it('shows help without arguments and reports unknown commands with exit 2', () => {
  expect(execFileSync(process.execPath, [cli], { encoding: 'utf8' })).toContain('Phase 0');
  for (const command of ['init', 'run', 'scan', 'review', 'apply', 'runs', 'recover', 'probe']) {
    const invalid = spawnSync(process.execPath, [cli, command], { encoding: 'utf8' });
    expect(invalid.status, command).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain('error:');
    expect(invalid.stderr).toContain(command);
  }
});
it('requires explicit paid opt-in before the live smoke can access credentials', () => {
  const live = fileURLToPath(new URL('../dist/probes/live.js', import.meta.url));
  const result = spawnSync(process.execPath, [live, 'gateway', 'openai/test'], { encoding: 'utf8' });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('--allow-paid');
  expect(result.stdout).toBe('');
});
