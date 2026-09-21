---
name: check
description: Preview SpellAgent proofreading scope and prose coverage for local project files, or evaluate bundled synthetic fixtures. Automatic correction is not available yet.
context: fork
agent: general-purpose
model: haiku
background: false
allowed-tools: Read
---

# SpellAgent for Claude Code — Read-only preview

For project previews, read [workflow.md](workflow.md). For explicitly requested
bundled-fixture host/model evaluation, read [feasibility.md](feasibility.md). Resolve the helper relative to
this installed skill's directory at `../../runtime/dist/plugin/helper.js`.
Use Read for instructions; use the host's permission-controlled execution tool
only for the Node helper. Shell execution is not pre-approved by this skill.
Do not delegate again. The fork is the single worker and must return its summary
in the invoking turn. Foreground fork behavior requires Claude Code 2.1.218+.

This wrapper selects `haiku`; do not claim it is always the cheapest model.
If the host reports rejection or policy substitution, stop, disclose it, and
ask the user to select an allowed model through host configuration. A requested
override must be configured through the host before invocation; prose arguments
cannot change an already-started fork's model. Do not alter installed files or
host settings to force an override. If effective model metadata is unavailable,
report selection as unverified, not passed.

This fork consumes host usage even for extraction. For a strictly offline
preview, use the helper directly without a host/model evaluation.
