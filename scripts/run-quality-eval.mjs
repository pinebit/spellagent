// Development quality harness only. Drives the real installed Claude Code
// plugin headlessly over a set of labeled fixture files and records the
// proposed corrections it reports, for later scoring against gold labels
// with scripts/score-quality.mjs. Never run against this repository's own
// tracked source files -- always point --source at a scratch copy.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function parseArgs(argv) {
  const args = { model: 'haiku' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--source') args.source = argv[++i];
    else if (key === '--output') args.output = argv[++i];
    else if (key === '--model') args.model = argv[++i];
    else if (key === '--limit') args.limit = Number(argv[++i]);
  }
  if (!args.source || !args.output) throw new Error('Usage: --source <dir> --output <file> [--model haiku] [--limit N]');
  return args;
}

async function listFiles(dir, base = dir) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

// Parses SpellAgent's correction-preview report shape (a Markdown table with
// an Original/Replacement/Category header row, per plugins/shared/workflow.md
// section 4) out of the headless result text. Only rows belonging to the
// specific table whose header names an "original" and a "replacement" column
// are captured, by tracked column index -- any other pipe-table in the
// response (per-file totals, coverage breakdowns) is ignored entirely.
function splitRow(line) {
  return line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
}

export function parseProposals(resultText) {
  const proposals = [];
  const lines = resultText.split('\n');
  let columns = null; // { original: idx, replacement: idx, category: idx } while inside the target table

  for (const line of lines) {
    if (!line.includes('|')) {
      columns = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length === 0) {
      columns = null;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // header separator row

    const originalIdx = cells.findIndex((c) => /^original$/i.test(c));
    const replacementIdx = cells.findIndex((c) => /^replacement$/i.test(c));
    if (originalIdx >= 0 && replacementIdx >= 0) {
      const categoryIdx = cells.findIndex((c) => /^category$/i.test(c));
      columns = { original: originalIdx, replacement: replacementIdx, category: categoryIdx };
      continue;
    }

    if (!columns) continue;
    const original = cells[columns.original];
    const replacement = cells[columns.replacement];
    const category = columns.category >= 0 ? cells[columns.category] : undefined;
    if (original && replacement) {
      proposals.push({ original, replacement, category: (category ?? 'other').toLowerCase() });
    }
  }
  return proposals;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'spellagent-quality-'));
  await cp(args.source, scratchRoot, { recursive: true });
  let files = await listFiles(scratchRoot);
  if (args.limit) files = files.slice(0, args.limit);

  const predictions = [];
  for (const relativePath of files) {
    const target = path.join(scratchRoot, relativePath);
    const prompt = `/spellagent:check preview corrections for ${target}`;
    let resultText = '';
    try {
      const { stdout } = await run('claude', [
        '-p', prompt,
        '--model', args.model,
        '--permission-mode', 'acceptEdits',
        '--output-format', 'json',
        '--add-dir', scratchRoot,
      ], { maxBuffer: 1024 * 1024 * 32, timeout: 120_000 });
      const parsed = JSON.parse(stdout);
      resultText = parsed.result ?? '';
    } catch (error) {
      console.error('FAILED', relativePath, error.message);
      continue;
    }
    const proposals = parseProposals(resultText);
    predictions.push({ path: relativePath, proposals });
    console.error('done', relativePath, proposals.length, 'proposals');
    // Write after every file so an interrupted run still leaves usable partial results.
    await mkdir(path.dirname(args.output), { recursive: true });
    await writeFile(args.output, JSON.stringify(predictions, null, 2) + '\n', 'utf8');
  }

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(predictions, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${predictions.length} file predictions to ${args.output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
