import type { Config } from '../core/contracts.js';
import type { DiscoveryResult, SkippedPath } from '../discovery/discover.js';
import { EXTRACTOR_VERSION, GENERATED_DETECTION_VERSION } from '../discovery/policy.js';

function safe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, character => character === '\n' || character === '\r' || character === '\t' ? ' ' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function skipJson(entry: SkippedPath): SkippedPath {
  return entry.detail === undefined ? { path: entry.path, reason: entry.reason } : { path: entry.path, reason: entry.reason, detail: entry.detail };
}

function reasons(entries: readonly SkippedPath[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

export function dryRunReport(root: string, config: Config, result: DiscoveryResult) {
  const files = result.files.map(file => ({ path: file.snapshot.path, format: file.snapshot.format,
    bytes: file.snapshot.byteLength, segments: file.segments.length,
    editableBytes: file.segments.reduce((total, segment) => total + segment.sourceMap.reduce((sum, map) => sum + map.source.endByte - map.source.startByte, 0), 0),
    notices: file.notices, diagnostics: file.diagnostics }));
  const segments = files.reduce((total, file) => total + file.segments, 0);
  return {
    schemaVersion: 1 as const, mode: 'dry-run' as const, extractorVersion: EXTRACTOR_VERSION,
    generatedDetectionVersion: GENERATED_DETECTION_VERSION,
    status: result.failed.length ? 'incomplete' as const : segments ? 'complete' as const : 'no_eligible_text' as const,
    root, provider: config.provider, dialect: config.dialect,
    counts: { eligibleFiles: files.length, eligibleSegments: segments, estimatedRequests: segments ? Math.ceil(segments / 50) : 0,
      skippedPaths: result.skipped.length, failedFiles: result.failed.length },
    skipReasons: reasons(result.skipped), failureReasons: reasons(result.failed),
    files, skipped: result.skipped.map(skipJson), failed: result.failed.map(skipJson),
  };
}

export function renderHumanDryRun(report: ReturnType<typeof dryRunReport>): string {
  const lines = [
    'SpellAgent offline dry run',
    `Root: ${safe(report.root)}`,
    `Connection: ${report.provider.name} / ${safe(report.provider.model)}`,
    `Eligible: ${report.counts.eligibleFiles} files, ${report.counts.eligibleSegments} prose segments`,
    `Estimated inference requests: ${report.counts.estimatedRequests} (no requests were sent)`,
  ];
  for (const file of report.files) {
    lines.push(`  include ${safe(file.path)} — ${file.segments} segments, ${file.editableBytes} editable bytes`);
    for (const notice of file.notices) lines.push(`    notice ${safe(notice)}`);
    for (const diagnostic of file.diagnostics) lines.push(`    warning ${safe(diagnostic.code)}${diagnostic.line ? ` at line ${diagnostic.line}` : ''}`);
  }
  for (const item of report.skipped) lines.push(`  skip ${safe(item.path)} — ${item.reason}${item.detail ? ` (${safe(item.detail)})` : ''}`);
  for (const item of report.failed) lines.push(`  fail ${safe(item.path)} — ${item.reason}${item.detail ? ` (${safe(item.detail)})` : ''}`);
  if (report.status === 'no_eligible_text') lines.push('No eligible text was found.');
  else if (report.status === 'incomplete') lines.push('Dry run is incomplete because selected supported files could not be classified or parsed.');
  return `${lines.join('\n')}\n`;
}
