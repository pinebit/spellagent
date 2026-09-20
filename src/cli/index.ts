#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { CONFIG_PATH, EXIT_CODES } from '../core/contracts.js';
import { loadConfig, resolveProjectRoot, UserError } from '../discovery/config.js';
import { discover } from '../discovery/discover.js';
import { initialize, UserCancelled } from '../ui/init.js';
import { dryRunReport, renderHumanDryRun } from '../ui/dry-run.js';

const diagnostic = (message: string) => message.replace(/[\u0000-\u001f\u007f]/gu, character =>
  character === '\n' || character === '\r' || character === '\t' ? ' ' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

const program = new Command()
  .name('spellagent')
  .description('Correct spelling and grammar in local documentation and source comments.')
  .version('0.0.0')
  .showSuggestionAfterError()
  .exitOverride();

program.command('init')
  .description(`Interactively create ${CONFIG_PATH} in the project root`)
  .option('--root <directory>', 'project root (defaults to cwd)')
  .action(async options => {
    const root = await resolveProjectRoot(options.root as string | undefined);
    await initialize(root);
  });

program.command('run')
  .description('Inspect or correct eligible local prose')
  .argument('[paths...]', 'cwd-relative files or directories inside the project root')
  .option('--root <directory>', 'project root (defaults to cwd)')
  .option('--dry-run', 'offline scope and extraction preview')
  .option('--format <format>', 'report format: text or json', 'text')
  .action(async (paths: string[], options: { root?: string; dryRun?: boolean; format: string }) => {
    const root = await resolveProjectRoot(options.root);
    const config = await loadConfig(root);
    if (!options.dryRun) throw new UserError('Inference and source editing arrive in Phases 2–3. Use "spellagent run --dry-run" for the Phase 1 offline preview.');
    if (options.format !== 'text' && options.format !== 'json') throw new UserError('--format must be text or json.');
    const result = await discover({ root, cwd: process.cwd(), paths, config });
    const report = dryRunReport(root, config, result);
    if (options.format === 'json') process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stdout.write(renderHumanDryRun(report));
    if (report.status !== 'complete') process.exitCode = EXIT_CODES.incomplete;
  });

try {
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync();
} catch (error) {
  if (error instanceof UserCancelled) { console.error(diagnostic(error.message)); process.exitCode = EXIT_CODES.cancelled; }
  else if (error instanceof UserError) { console.error(`spellagent: ${diagnostic(error.message)}`); process.exitCode = EXIT_CODES.incomplete; }
  else if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : EXIT_CODES.incomplete;
  else { console.error(`spellagent: ${diagnostic(error instanceof Error ? error.message : 'unexpected failure')}`); process.exitCode = EXIT_CODES.incomplete; }
}
