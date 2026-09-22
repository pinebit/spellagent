# SpellAgent

Safe, local proofreading for your documentation, source comments, and
docstrings — as a plugin for Claude Code and Codex. Your existing host
handles authentication and model access; SpellAgent finds prose safely and
applies only validated corrections, one file at a time.

## What it corrects

- Markdown and GFM
- JavaScript, TypeScript, JSX, TSX comments
- Go, Rust, Java comments and documentation comments
- Python comments and docstrings

English spelling, grammar, punctuation, capitalization, and usage only — no
translation, rewriting, identifier renaming, or factual correction. Code
examples, URLs, paths, placeholders, and identifiers are always protected.

## Install

The plugin isn't published to a public marketplace yet. Install it directly
from a local clone of this repository:

```sh
git clone https://github.com/pinebit/spellagent.git
cd spellagent
npm ci
npm run build:plugins
```

### Claude Code

```sh
claude plugin marketplace add /path/to/spellagent
claude plugin install spellagent@spellagent-marketplace
```

### Codex

```sh
codex plugin marketplace add /path/to/spellagent
codex plugin add spellagent@spellagent-codex-marketplace
```

Requires no separate API keys and no compiler — the plugin ships its own
runtime dependencies and grammar files; only the one-time `npm ci` and
`npm run build:plugins` above need npm.

## Use it

In Claude Code:

```
/spellagent:check check docs/
/spellagent:check preview the scope of docs/
/spellagent:check preview corrections for README.md without changing it
```

Preferences can be given in ordinary language: "use en-GB; treat SpellAgent as
a glossary term" for one term, or "treat SpellAgent, Tree-sitter, and Codex as
glossary terms" for several.

In Codex, ask the same requests in ordinary language — "Check `docs/`.",
"Preview the scope of `docs/`.", "Preview corrections for `README.md` without
changing it.", "Check `docs/` using en-GB; treat `SpellAgent` as a glossary
term." — and the installed skill responds the same way.

Three modes:

| Ask for | What happens |
| --- | --- |
| "Check ..." / "Correct ..." | Reviews eligible files and applies validated corrections automatically. |
| "Preview the scope of ..." | Offline inventory of what would be reviewed and why other content is skipped. No model call, no writes. |
| "Preview corrections for \<one file\>" | Reviews and shows proposed corrections for exactly one named file. No writes. |

## Preferences (optional)

Add an optional `.spellagentrc.json` at your project root:

```json
{
  "schemaVersion": 2,
  "dialect": "en-GB",
  "includeHidden": false,
  "glossary": ["SpellAgent", "Tree-sitter"]
}
```

Everything works with sensible defaults if you skip this file.

## Suppressing a specific line or region

```
<!-- spellagent-disable-next-line -->
This line is intentionally left as-is.
```

`spellagent-disable` / `spellagent-enable` mark a suppressed region; source
files use their own language's comment syntax with the same directive text.

## Privacy

Correction and correction-preview modes send extracted prose to your selected
host model; scope preview never does. Model retention follows your host or
organization's policy — SpellAgent doesn't control it. The local helper
itself makes no network calls, stores no prompts or source text, and never
stages, commits, or publishes changes; inspect what changed with your own
tools.

## Contributing

See [docs/development.md](docs/development.md) for build/test commands and
[docs/plan.md](docs/plan.md) for the maintained design and phase evidence.

## License

[MIT](LICENSE). Bundled grammars retain their upstream licenses in
`runtime/assets/licenses/`; runtime dependency packages retain their own
license files.
