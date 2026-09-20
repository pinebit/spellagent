import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_PATH, configSchema, type Config } from '../core/contracts.js';

export class UserError extends Error {}

export async function resolveProjectRoot(rootOption: string | undefined, cwd = process.cwd()): Promise<string> {
  const candidate = path.resolve(cwd, rootOption ?? '.');
  let root: string;
  try { root = await realpath(candidate); }
  catch { throw new UserError(`Project root does not exist: ${candidate}`); }
  if (!(await stat(root)).isDirectory()) throw new UserError(`Project root is not a directory: ${candidate}`);
  return root;
}

export async function loadConfig(root: string): Promise<Config> {
  const configPath = path.join(root, CONFIG_PATH);
  let raw: string;
  try {
    const info = await lstat(configPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new UserError(`${CONFIG_PATH} must be a regular file, not a symlink.`);
    raw = await readFile(configPath, 'utf8');
  }
  catch (error) {
    if (error instanceof UserError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UserError(`No ${CONFIG_PATH} exists in ${root}. Run "spellagent init${root === process.cwd() ? '' : ` --root ${JSON.stringify(root)}`}" first.`);
    }
    throw new UserError(`Cannot read ${CONFIG_PATH}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new UserError(`${CONFIG_PATH} is not valid JSON.`); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new UserError(`${CONFIG_PATH} is invalid: ${result.error.issues[0]?.message ?? 'schema mismatch'}`);
  return result.data;
}

export function resolveRequestedPath(input: string, cwd: string, root: string): string {
  const absolute = path.resolve(cwd, input);
  const relative = path.relative(root, absolute);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return absolute;
  throw new UserError(`Requested path is outside the project root: ${input}`);
}
