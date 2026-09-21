# Phase C implementation handoff

Status: safe automatic editing passed offline checks on macOS and isolated Linux
arm64. Installed-host and live-model behavior remain unqualified. Claude qualification
remains deferred by user instruction; this does not remove its package from scope.

## Protocol additions

Protocol 2 retains `discover` and `extract` and adds `validate-file` and `apply-file`.
Both edit operations require the exact `policyHash` and `snapshotHash` returned by
extraction plus one response for every emitted eligible segment. Requests are bounded
to 2 MiB so a complete file response can travel in memory without proposal files.
Each response has a `segmentId` and zero or more proposals containing `original`,
`replacement`, `category`, and `reason`. The model never supplies byte offsets.

`validate-file` reconstructs the current file and preferences, rejects stale hashes,
validates the whole response, reparses the combined candidate, and returns accepted
original/replacement pairs for correction-preview reporting. It creates no project
state or logs and never authorizes later reuse.

`apply-file` performs the same validation under a project write lock. A successful
change returns the after-hash, correction count/categories, and one changed file. A
complete response with no proposals returns unchanged. Any malformed, missing,
duplicate, unknown, ambiguous, protected, overlapping, unmappable, unsafe, stale, or
structurally invalid proposal leaves that file unchanged and unresolved.

## Validation and writes

Proposal phrases must resolve uniquely inside their own segment and map through one
verified source span. Protected ranges and neighboring context are never targets.
Leading/trailing whitespace and line-break structure must remain exact. Format-sensitive
delimiters, control characters, oversized replacements, and candidates over 1 MiB are
rejected. Accepted edits may not overlap. The helper assembles UTF-8 byte slices,
verifies BOM/final-newline state, reparses the complete candidate, and requires stable
extraction diagnostics, notices, suppression count, and segment count.

Application uses `.spellagent/write.lock`, a random exclusive temporary file beside
the target, file and directory identity checks, a synced write, preserved permission
mode, source-free write-intent logging, repeated source/policy validation, and atomic
rename. Completion or pre-rename abort is logged under `.spellagent/logs/YYYY-MM-DD.jsonl`.
Logs contain timestamps, paths, hashes, counts, diagnostic codes, and outcomes—not
source, context, prompts, proposals, replacements, snapshots, or backups.

Normal cancellation is checked before lock acquisition and at multiple points before
rename, with owned lock/temp cleanup. A hard crash can leave the explicit lock or temp
file; there is no automated recovery command. Completion-log failure after rename is
reported as `write_completion_log_failed` with uncertain logging state, never as an
unchanged file. Final freshness checks reduce but cannot eliminate the race in which
an uncooperative editor writes immediately before replacement.

## Workflow behavior

Plain preview remains offline discovery. Correction preview must name one file and is
model-backed but write-free. Normal correction processes deterministic discovery order,
completing one file before the next. File-specific invalid output does not trigger a
repair request and does not block independent files. Cancellation, host/model failure,
or systemic storage/logging failure stops further writes. Previously completed files
remain changed; no repository-wide transaction, rollback, replay, or resume is claimed.

The Codex wrapper selects one `gpt-5.6-luna` low-reasoning worker by default. The Claude
wrapper remains a foreground `haiku` fork and does not delegate again. User overrides
and unavailable-model stop behavior remain host-controlled. Model quality and effective
selection are not qualified until measured in Phase D.

## Verification evidence

On 2026-09-21, after explicit user authorization, `npm run check` and
`npm run test:pack` passed on macOS Darwin arm64 with Node v24.14.1/npm 11.12.1.
The check ran 32 tests across seven files and all eight parser probes; the isolated
Codex package check exercised correction preview, application, and source-free logs.

`npm run test:linux` passed in Docker on Linux aarch64/arm64 with Node v24.14.1/npm
11.11.0, running the same 32 tests, probes, and Codex package check. Generated Codex
skill and plugin validators also passed. The tests cover preview non-writing,
successful atomic application, modes and logs, completeness, malformed/duplicate/
unknown records, ambiguous/protected/overlapping/unsafe proposals, stale source/policy,
lock contention, and cancellation.

These are offline helper and package results, not installed-host or live-model
qualification. Claude tests remain deferred, and no x64 or Windows pass is inferred.
