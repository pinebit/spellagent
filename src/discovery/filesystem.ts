import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { HelperError } from '../core/errors.js';
import { relativePathSchema } from '../core/contracts.js';

// Node has no portable openat traversal. Inspect every ancestor and recheck
// identity before returning data; this detects races without claiming isolation.
export async function inspectPath(absolute: string) {
  if (!path.isAbsolute(absolute) || path.normalize(absolute) !== absolute) throw new HelperError('invalid_root');
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  const chain: { path: string; dev: number; ino: number }[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new HelperError('symlink');
    if (index < parts.length - 1 && !info.isDirectory()) throw new HelperError('unsafe_path');
    chain.push({ path: current, dev: info.dev, ino: info.ino });
  }
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) throw new HelperError('symlink');
  return { info, chain };
}

export async function assertChain(chain: Awaited<ReturnType<typeof inspectPath>>['chain']) {
  for (const item of chain) {
    const info = await lstat(item.path);
    if (info.isSymbolicLink() || info.dev !== item.dev || info.ino !== item.ino) throw new HelperError('path_changed');
  }
}

export function targetPath(root: string, relative: string) {
  if (relative === '.') return root;
  if (!relativePathSchema.safeParse(relative).success) throw new HelperError('unsafe_path');
  return path.join(root, ...relative.split('/'));
}

export async function readLocalFile(absolute: string, limit: number): Promise<Buffer> {
  const before = await inspectPath(absolute);
  if (!before.info.isFile()) throw new HelperError('not_regular_file');
  if (before.info.nlink !== 1) throw new HelperError('hard_link');
  if (before.info.size > limit) throw new HelperError('too_large');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.nlink !== 1 || initial.dev !== before.info.dev || initial.ino !== before.info.ino) {
      throw new HelperError('path_changed');
    }
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new HelperError('too_large');
    const after = await handle.stat();
    await assertChain(before.chain);
    if (after.size !== size || initial.size !== after.size || initial.mtimeMs !== after.mtimeMs ||
        initial.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new HelperError('file_changed');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

export function strictUtf8(bytes: Buffer) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HelperError('invalid_utf8'); }
  // TextDecoder strips a BOM by default; preserve it in parser offsets/hashes.
  return bytes.toString('utf8');
}
