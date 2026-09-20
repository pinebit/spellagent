#!/usr/bin/env node
import { Command, CommanderError } from 'commander';

const program = new Command()
  .name('spellagent')
  .description('Local prose correction tool — Phase 0 feasibility build; scanning is not implemented.')
  .version('0.0.0')
  .exitOverride();
program.command('probe').description('Run offline bundled-parser feasibility checks')
  .action(async () => {
    const { probeParsers } = await import('../probes/parsers.js');
    console.log(JSON.stringify({ schemaVersion: 1, platform: process.platform,
      arch: process.arch, node: process.version, parsers: await probeParsers() }, null, 2));
  });
try {
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : 2;
  else { console.error('SpellAgent probe failed. Run the development tests for diagnostics.'); process.exitCode = 2; }
}
