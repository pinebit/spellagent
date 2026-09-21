import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HelperError } from '../core/errors.js';
import { assertChain, inspectPath, readLocalFile } from '../discovery/filesystem.js';
import { sha256 } from '../discovery/discover.js';

const STATE_DIRECTORY = '.spellagent';
const LOG_DIRECTORY = 'logs';
const LOCK_FILE = 'write.lock';

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new HelperError('cancelled');
}

async function ensureDirectory(absolute: string, mode: number) {
  try { await mkdir(absolute, { mode }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const inspected = await inspectPath(absolute);
  if (!inspected.info.isDirectory()) throw new HelperError('unsafe_state_directory');
  return inspected;
}

async function appendLog(logDirectory: string, event: Record<string, unknown>) {
  const name = `${new Date().toISOString().slice(0, 10)}.jsonl`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const directory = await inspectPath(logDirectory);
    if (!directory.info.isDirectory()) throw new HelperError('logging_failed');
    await assertChain(directory.chain);
    handle = await open(path.join(logDirectory, name), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new HelperError('logging_failed');
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n', 'utf8');
    await handle.sync();
  } catch { throw new HelperError('logging_failed'); }
  finally { await handle?.close().catch(() => undefined); }
}

export async function withProjectWriteLock<T>(root: string, signal: AbortSignal | undefined,
  action: (logDirectory: string) => Promise<T>): Promise<T> {
  cancelled(signal);
  let state: Awaited<ReturnType<typeof ensureDirectory>>;
  let logs: Awaited<ReturnType<typeof ensureDirectory>>;
  try {
    state = await ensureDirectory(path.join(root, STATE_DIRECTORY), 0o700);
    logs = await ensureDirectory(path.join(root, STATE_DIRECTORY, LOG_DIRECTORY), 0o700);
  } catch (error) {
    if (error instanceof HelperError) throw error;
    throw new HelperError('logging_failed');
  }
  await assertChain(state.chain); await assertChain(logs.chain);
  const lockPath = path.join(root, STATE_DIRECTORY, LOCK_FILE);
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new HelperError('write_lock_contended');
    throw new HelperError('write_lock_failed');
  }
  try {
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
      await lock.sync();
    } catch { throw new HelperError('write_lock_failed'); }
    cancelled(signal);
    return await action(path.join(root, STATE_DIRECTORY, LOG_DIRECTORY));
  } finally {
    await lock.close().catch(() => undefined);
    try { await unlink(lockPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new HelperError('lock_cleanup_failed', { possibleLeftover: true });
      }
    }
  }
}

export async function atomicReplace(options: {
  absolute: string; relative: string; expectedHash: string;
  candidate: Buffer; candidateHash: string; proposalCount: number;
  logDirectory: string; signal?: AbortSignal; beforeReplace?: () => Promise<void>;
}) {
  cancelled(options.signal);
  const before = await inspectPath(options.absolute);
  if (!before.info.isFile() || before.info.nlink !== 1) throw new HelperError('unsafe_write_target');
  const current = await readLocalFile(options.absolute, 1_048_576);
  if (sha256(current) !== options.expectedHash) throw new HelperError('file_changed');
  const temporary = path.join(path.dirname(options.absolute),
    `.${path.basename(options.absolute)}.spellagent-${randomBytes(12).toString('hex')}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  let intentLogged = false;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(options.candidate);
    await handle.sync();
    await handle.chmod(before.info.mode & 0o777);
    cancelled(options.signal);
    await appendLog(options.logDirectory, { event: 'write_intent', path: options.relative,
      beforeHash: options.expectedHash, candidateHash: options.candidateHash, proposalCount: options.proposalCount });
    intentLogged = true;
    const final = await inspectPath(options.absolute);
    const finalBytes = await readLocalFile(options.absolute, 1_048_576);
    if (final.info.dev !== before.info.dev || final.info.ino !== before.info.ino || final.info.nlink !== 1 ||
        sha256(finalBytes) !== options.expectedHash) throw new HelperError('file_changed');
    await assertChain(before.chain);
    await options.beforeReplace?.();
    cancelled(options.signal);
    await rename(temporary, options.absolute);
    renamed = true;
    await appendLog(options.logDirectory, { event: 'write_complete', path: options.relative,
      beforeHash: options.expectedHash, afterHash: options.candidateHash, proposalCount: options.proposalCount });
    return { afterHash: options.candidateHash };
  } catch (error) {
    if (renamed) throw new HelperError('write_completion_log_failed', { fileState: 'changed_log_incomplete' });
    const failure = error instanceof HelperError ? error : new HelperError('replacement_failed');
    if (intentLogged) {
      await appendLog(options.logDirectory, { event: 'write_aborted', path: options.relative,
        beforeHash: options.expectedHash, candidateHash: options.candidateHash,
        proposalCount: options.proposalCount,
        code: failure.code });
    }
    throw failure;
  } finally {
    await handle?.close().catch(() => undefined);
    if (!renamed) {
      try { await unlink(temporary); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new HelperError('temporary_cleanup_failed', { possibleLeftover: true });
        }
      }
    }
  }
}
