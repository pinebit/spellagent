---
name: check
description: Correct local documentation, comments, and docstrings; also supports offline scope preview and single-file correction preview.
context: fork
agent: general-purpose
model: haiku
background: false
allowed-tools: Read, Bash
---

# SpellAgent for Claude Code

Examples: `/spellagent:check check docs/`, `/spellagent:check preview the scope of
docs/`, and `/spellagent:check preview corrections for README.md without changing
it`. Preferences may be ordinary language, such as “use en-GB; treat SpellAgent as
a glossary term” for one term, or “treat SpellAgent, Tree-sitter, and Codex as
glossary terms” for several.

For project work, read [workflow.md](workflow.md). For explicitly requested
bundled-fixture host/model evaluation, read [feasibility.md](feasibility.md). Resolve the helper relative to
this installed skill's directory at `../../runtime/dist/plugin/helper.js`.
Use Read for instructions; use Bash only for safe stdin transport to the installed
Node helper, subject to the host's permission controls.
Do not delegate again. The fork is the single worker and must return its summary
in the invoking turn. Foreground fork behavior requires Claude Code 2.1.218+.

This wrapper selects `haiku`; do not claim it is always the cheapest model.
If the host reports rejection or policy substitution, stop before inference and
name the requested model, the host-visible reason, and the configured default.
If the host exposes an available alternative, point to the host setting governing
the skill fork and give this copyable retry after it is changed:
`/spellagent:check evaluate the bundled fixtures using <available-model>`. If no
available list is exposed, point to that same setting without guessing a model
name. A requested
override must be configured through the host before invocation; prose arguments
cannot change an already-started fork's model. Do not alter installed files or
host settings to force an override. If effective model metadata is unavailable,
report selection as unverified, not passed.

This fork is the single worker and processes files sequentially. Scope preview
does not send extracted prose to a proofreading model, though the host session and
tool/conversation retention still apply. Correction and correction preview are
model-backed and must use the helper for all validation and writes.
