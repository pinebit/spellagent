import { constants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { CONFIG_PATH, configSchema, type Config } from '../core/contracts.js';
import { defaultConfig } from '../discovery/policy.js';
import { UserError } from '../discovery/config.js';
import { compileGlobs } from '../discovery/globs.js';
import { MODEL_SUGGESTIONS } from '../llm/model-suggestions.js';

export class UserCancelled extends Error {}

function list(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export async function initialize(root: string, streams: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
  input: process.stdin, output: process.stdout,
}): Promise<Config> {
  const configPath = path.join(root, CONFIG_PATH);
  try { await access(configPath, constants.F_OK); throw new UserError(`${CONFIG_PATH} already exists; refusing to overwrite it.`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const rl = createInterface({ input: streams.input, output: streams.output, terminal: Boolean((streams.input as NodeJS.ReadStream).isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  rl.once('SIGINT', () => rl.close());
  const ask = async (prompt: string) => {
    streams.output.write(prompt);
    try {
      const answer = await lines.next();
      if (answer.done) throw new UserCancelled('Initialization cancelled before configuration was written.');
      return answer.value.trim();
    }
    catch { throw new UserCancelled('Initialization cancelled before configuration was written.'); }
  };
  try {
    streams.output.write('SpellAgent setup is offline. During a later run, eligible prose and bounded context go only to your selected connection.\n');
    streams.output.write('Runs modify local files after validation; source-free logs contain paths, counts, usage, and diagnostics. There is no telemetry.\n\n');
    const connection = (await ask('Connection [openai/anthropic/gateway] (openai): ') || 'openai');
    if (!['openai', 'anthropic', 'gateway'].includes(connection)) throw new UserError('Connection must be openai, anthropic, or gateway.');
    const suggested = MODEL_SUGGESTIONS[connection as keyof typeof MODEL_SUGGESTIONS].model;
    const model = await ask(`Model (${suggested}): `) || suggested;
    let provider: Config['provider'];
    if (connection === 'gateway') {
      const only = list(await ask('Allowed Gateway upstreams, comma-separated (openai): ') || 'openai');
      provider = { name: 'gateway', model, only };
    } else if (connection === 'openai') provider = { name: 'openai', model };
    else provider = { name: 'anthropic', model };
    const credentialName = provider.name === 'openai' ? 'OPENAI_API_KEY' : provider.name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'AI_GATEWAY_API_KEY';
    streams.output.write(`Inference will require ${credentialName}; setup does not read it.\n`);
    const config = defaultConfig(provider);
    const maxAgentsText = await ask('Maximum simultaneous model calls (32): ');
    if (maxAgentsText) config.limits.maxAgents = Number(maxAgentsText);
    const dialect = await ask('English dialect [en-US/en-GB] (en-US): ');
    if (dialect) config.dialect = dialect as Config['dialect'];
    const include = await ask(`Include globs, comma-separated (${config.include.join(',')}): `);
    if (include) config.include = list(include);
    const exclude = await ask('Custom exclusions, comma-separated (none): ');
    if (exclude) config.exclude = list(exclude);
    const includeHidden = (await ask('Include eligible hidden paths? [y/N]: ')).toLowerCase();
    config.includeHidden = includeHidden === 'y' || includeHidden === 'yes';
    const glossary = await ask('Case-sensitive glossary terms, comma-separated (none): ');
    if (glossary) config.glossary = list(glossary);
    const validated = configSchema.safeParse(config);
    if (!validated.success) throw new UserError(`Configuration is invalid: ${validated.error.issues[0]?.message ?? 'schema mismatch'}`);
    try { compileGlobs(validated.data.include); compileGlobs(validated.data.exclude); }
    catch (error) { throw new UserError(`Configuration contains an invalid scope glob: ${(error as Error).message}`); }
    streams.output.write(`\nConfiguration preview:\n${JSON.stringify(validated.data, null, 2)}\n`);
    streams.output.write('Add custom generator output paths to exclude; bundled generated-file rules cannot identify every generator.\n');
    const confirm = (await ask(`Write ${CONFIG_PATH}? [y/N]: `)).toLowerCase();
    if (confirm !== 'y' && confirm !== 'yes') throw new UserCancelled('Initialization cancelled; no configuration was written.');
    try { await writeFile(configPath, `${JSON.stringify(validated.data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new UserError(`${CONFIG_PATH} appeared during setup; refusing to overwrite it.`);
      throw error;
    }
    streams.output.write(`Wrote ${configPath}. Set ${credentialName} only when you run inference.\n`);
    return validated.data;
  } finally { rl.close(); }
}
