import { describe, expect, it } from 'vitest';
import { handleRequest, isEditOperation, PAGE_CHARACTERS, PAGE_SEGMENTS } from '../src/plugin/protocol.js';

async function extract(fixture: string, cursor = 0, snapshotHash?: string) {
  const response = await handleRequest({ protocolVersion: 1, operation: 'extract-fixture',
    fixture, cursor, ...(snapshotHash === undefined ? {} : { snapshotHash }) });
  if (response.operation !== 'extract-fixture') throw new Error('Expected extraction');
  return response;
}

describe('synthetic plugin protocol', () => {
  it('lists fixtures without accepting arbitrary sources, paths, or writes', async () => {
    const list = await handleRequest({ protocolVersion: 1, operation: 'list-fixtures' });
    expect(list.sourceWrites).toBe(false);
    for (const request of [
      { protocolVersion: 2, operation: 'list-fixtures' },
      { protocolVersion: 1, operation: 'apply-file' },
      { protocolVersion: 1, operation: 'extract-fixture', fixture: '../secret' },
      { protocolVersion: 1, operation: 'extract-fixture', fixture: 'markdown', source: 'untrusted' },
      { protocolVersion: 1, operation: 'extract-fixture', fixture: 'markdown', root: '/tmp' },
    ]) await expect(handleRequest(request)).rejects.toThrow('invalid_request');
  });

  it('extracts every parser format deterministically', async () => {
    for (const fixture of ['markdown', 'javascript', 'typescript', 'tsx', 'python', 'java', 'go', 'rust']) {
      const first = await extract(fixture);
      expect(first.segments.length).toBeGreaterThan(0);
      expect(first).toEqual(await extract(fixture));
      expect(first.segments.some(segment => segment.editable.includes('sentense'))).toBe(true);
      expect(first.sourceWrites).toBe(false);
    }
  });

  it('accounts for all pages without duplicates or truncation', async () => {
    let page = await extract('pages');
    const ids = new Set<string>();
    let pages = 0;
    for (;;) {
      expect(page.characters).toBeLessThanOrEqual(PAGE_CHARACTERS);
      expect(page.segments.length + page.skipped.length).toBeLessThanOrEqual(PAGE_SEGMENTS);
      for (const segment of [...page.segments, ...page.skipped]) {
        expect(ids.has(segment.segmentId)).toBe(false);
        ids.add(segment.segmentId);
      }
      pages += 1;
      expect(pages).toBeLessThan(100);
      if (page.nextCursor === null) break;
      expect(page.nextCursor).toBeGreaterThan(page.cursor);
      page = await extract('pages', page.nextCursor, page.snapshotHash);
    }
    expect(pages).toBeGreaterThan(1);
    expect(ids.size).toBe(page.totalSegments);
    expect(ids.size).toBe(80);
  });

  it('discloses oversized prose without returning a truncated segment', async () => {
    const page = await extract('oversized');
    expect(page.segments).toEqual([]);
    expect(page.skipped).toEqual([{ segmentId: expect.any(String), code: 'oversized_segment' }]);
    expect(page.totalSegments).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects invalid continuation cursors and snapshot mismatches', async () => {
    const first = await extract('pages');
    await expect(extract('pages', 1)).rejects.toThrow('snapshot_mismatch');
    await expect(extract('pages', 1, '0'.repeat(64))).rejects.toThrow('snapshot_mismatch');
    await expect(extract('pages', 1000, first.snapshotHash)).rejects.toThrow('invalid_cursor');
    await expect(extract('pages', -1)).rejects.toThrow('invalid_request');
  });

  it('classifies only validate-file/apply-file as edit operations for request-size enforcement', () => {
    expect(isEditOperation('validate-file')).toBe(true);
    expect(isEditOperation('apply-file')).toBe(true);
    expect(isEditOperation('discover')).toBe(false);
    expect(isEditOperation('extract')).toBe(false);
    expect(isEditOperation(undefined)).toBe(false);
    expect(isEditOperation(42)).toBe(false);
  });
});
