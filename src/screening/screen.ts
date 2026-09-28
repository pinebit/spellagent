import type { Preferences } from '../core/contracts.js';
import { HelperError } from '../core/errors.js';
import { extractLocalFile, type DiscoveryEntry } from '../discovery/discover.js';
import { askNoul, type NoulQuestion } from './typesafe.js';

export const SCREEN_PAGE_FILES = 16;
// Roughly 20k tokens, leaving room under Jev's 32k-token state limit for the
// question. Prepared segments are at most 10,000 characters, so every chunk
// holds at least one whole segment.
export const SCREEN_CHUNK_CHARACTERS = 60_000;
// Deliberately low: a false "clean" silently loses corrections, while a false
// "flagged" only costs one detailed review. Provisional until measured.
export const SCREEN_THRESHOLD = 0.2;
const CONCURRENT_REQUESTS = 4;

const question: NoulQuestion = {
  instructions: 'Does any passage in `prose` contain an English spelling, grammar, punctuation, capitalization, '
    + 'or word-usage error under the `dialect` conventions?',
  criteria: {
    true: 'At least one passage has a clear error that a careful copy editor would fix.',
    false: 'No passage has such an error. Terms listed in `glossary`, code identifiers, file paths, URLs, '
      + 'technical jargon, and stylistic preferences are not errors.',
  },
};

export type ScreenedFile = {
  path: string; snapshotHash: string; verdict: 'flagged' | 'clean' | 'no_segments';
  errorProbability: number | null; code?: string;
};

function chunkProse(prose: readonly string[]) {
  const chunks: string[][] = [];
  let size = 0;
  for (const text of prose) {
    const last = chunks.at(-1);
    if (last && size + text.length <= SCREEN_CHUNK_CHARACTERS) { last.push(text); size += text.length; }
    else { chunks.push([text]); size = text.length; }
  }
  return chunks;
}

async function mapConcurrently<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]!);
    }
  }));
  return results;
}

// Screens a page of eligible discovery entries. A file whose extraction fails
// or changed since discovery is reported as flagged so the detailed review
// re-extracts it and reports the real outcome; it is never counted as clean.
export async function screenFiles(options: { root: string; preferences: Preferences; entries: readonly DiscoveryEntry[];
  key: string; signal?: AbortSignal }) {
  const files: { entry: DiscoveryEntry; prose: string[]; code?: string }[] = [];
  for (const entry of options.entries) {
    const expected = entry.snapshot?.sha256 ?? '';
    try {
      const file = await extractLocalFile(options.root, entry.path, options.preferences);
      if (file.snapshot.sha256 !== expected) {
        files.push({ entry, prose: [], code: 'snapshot_mismatch' });
        continue;
      }
      files.push({ entry, prose: file.prepared.flatMap(item => item.kind === 'segment' ? [item.segment.editableText] : []) });
    } catch (error) {
      files.push({ entry, prose: [], code: error instanceof HelperError ? error.code : 'extraction_failed' });
    }
  }
  const requests = files.flatMap((file, fileIndex) => file.code ? [] : chunkProse(file.prose).map(prose => ({ fileIndex, prose })));
  // Abort the remaining requests as soon as one fails; the page fails as a whole.
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, local.signal]) : local.signal;
  let answers: Awaited<ReturnType<typeof askNoul>>[];
  try {
    answers = await mapConcurrently(requests, CONCURRENT_REQUESTS, request => askNoul({ key: options.key, signal, question,
      state: { dialect: options.preferences.dialect, glossary: options.preferences.glossary, prose: request.prose } }));
  } catch (error) {
    local.abort();
    throw error;
  }
  const highest = new Map<number, number>();
  requests.forEach((request, index) => {
    highest.set(request.fileIndex, Math.max(highest.get(request.fileIndex) ?? 0, answers[index]!.probability));
  });
  const items = files.map((file, index): ScreenedFile => {
    const base = { path: file.entry.path, snapshotHash: file.entry.snapshot?.sha256 ?? '' };
    if (file.code) return { ...base, verdict: 'flagged', errorProbability: null, code: file.code };
    if (file.prose.length === 0) return { ...base, verdict: 'no_segments', errorProbability: null };
    const probability = highest.get(index) ?? 0;
    return { ...base, verdict: probability >= SCREEN_THRESHOLD ? 'flagged' : 'clean', errorProbability: probability };
  });
  return { items, model: answers.at(0)?.model ?? null,
    inputTokens: answers.reduce((sum, answer) => sum + answer.inputTokens, 0) };
}
