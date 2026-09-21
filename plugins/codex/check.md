---
name: check
description: Correct local documentation, comments, and docstrings with one proofreading worker; also supports offline scope preview and single-file correction preview.
---

# SpellAgent for Codex

Examples: “Check `docs/`.” “Preview the scope of `docs/`.” “Preview corrections
for `README.md` without changing it.” “Check `docs/` using en-GB; treat
`SpellAgent` and `Tree-sitter` as glossary terms.”

For project work, read [workflow.md](workflow.md). For explicitly requested
bundled-fixture host/model evaluation, read [feasibility.md](feasibility.md). This installed skill's directory
is the base directory; resolve the helper at `../../runtime/dist/plugin/helper.js`.

For offline scope preview, run the helper yourself without delegation or
proofreading. For correction, correction preview, or an explicitly requested
host/model feasibility evaluation, delegate to exactly one fresh worker with
`gpt-5.6-luna` and low reasoning effort unless the user explicitly selects another
available model. For project correction, first use offline discovery to establish
and present the effective scope/settings and privacy notice. Give the worker the
complete workflow, absolute helper path, discovery result, and requested preferences.
Wait for it in the foreground and relay its
outcome and incomplete gates. No nested delegation or parallel file workers.

Request model selection through the host's supported spawn interface; never
silently inherit the parent model. If selection is unavailable, rejected, or
known to be overridden, stop before inference. Name the requested model, the
host-visible reason, and the configured default. If the host exposes an available
alternative, give a copyable retry preserving the original scope and preferences
while explicitly naming `<available-model>`. Otherwise point to Codex's
`agents.default_subagent_model` setting in `config.toml` and tell the user to name
the allowed model in the retry; do not guess a model name. If effective model metadata
is unavailable, report it as unverified, not as a successful model-selection gate.
Do not use other tools to edit source or bypass the selected workflow scope. A helper invocation is the only authorized
product operation; do not search unrelated directories to locate an installed
plugin. If this skill has no installed base directory, report discovery unavailable.
