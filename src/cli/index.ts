#!/usr/bin/env node
import { Command, CommanderError } from 'commander';

const program = new Command()
  .name('spellagent')
  .description('Local prose correction tool — Phase 0 feasibility build; init and run are planned, not implemented.')
  .version('0.0.0')
  .exitOverride();
try {
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : 2;
  else { console.error('SpellAgent failed. Run the development tests for diagnostics.'); process.exitCode = 2; }
}
