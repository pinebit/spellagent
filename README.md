# SpellAgent

A local CLI for reviewing spelling and grammar corrections in documentation and
source comments. **Phase 0 feasibility build:** parser probes and contracts exist;
`init`, scanning, review, and application are planned in [the implementation plan](docs/plan.md).

## Development

Requires Node.js 24 or newer and npm. Install pinned dependencies, then verify:

```sh
npm ci
npm run prepare:pack-cache
npm run check
npm run test:pack
```

The repository's `.npmrc` disables dependency lifecycle scripts. Official grammar
packages include WASM assets; no compiler or grammar generation is needed.
The build copies those assets and their licenses. Default tests and parser probes
make no network calls and require no API keys. The packed-install check uses npm's
local cache; `npm run prepare:pack-cache` populates the metadata and archives
needed for fresh packed installs. That explicit preparation command accesses npm;
a missing cache entry in `test:pack` fails rather than fetching.
Initial dependency installation requires access to npm. Run `npm run build` before
running `npm test` alone so the parser assets exist. Use `npm run pack:local` to
build and pack explicitly, since lifecycle scripts are disabled.

```sh
node dist/cli/index.js --help
node dist/cli/index.js probe
```

`probe` parses fixed synthetic fixtures for JavaScript, TypeScript, TSX, Python,
Java, Go, Rust, and Markdown. It does not scan the current directory or modify source.
With Docker running, verify Linux in isolated containers:

```sh
npm run test:linux
```

This downloads a pinned official Node image if needed, installs Linux dependencies
in a temporary volume, then runs checks and local/global packed installations with
networking disabled. The volume and containers are removed afterward; the image
stays cached. No host dependencies or API credentials are forwarded.

See [Phase 0 verification evidence](docs/plan.md#11-phase-0-implementation-evidence).

## Providers and credentials

SpellAgent uses **Vercel AI SDK** for three explicitly selected connections:

| Connection | Model ID | Required environment variable |
| --- | --- | --- |
| Direct OpenAI (`openai`) | Native OpenAI model ID | `OPENAI_API_KEY` |
| Direct Anthropic (`anthropic`) | Native Anthropic model ID | `ANTHROPIC_API_KEY` |
| Vercel AI Gateway (`gateway`) | `vendor/model` | `AI_GATEWAY_API_KEY` |

Gateway sends prose through Vercel to the configured upstream allowlist. It needs
only the Gateway key; direct-provider keys are not forwarded. Gateway requires
explicit upstream routes (`only` in config); no implicit model or connection fallback.
See the [AI SDK Gateway documentation](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway).

Use only the key for your selected connection. `.env.example` lists the names;
`.env` is ignored and is not automatically loaded. Future `--env-file` support
belongs to Phase 1. Initialization and dry-run will stay offline for every connection,
including Gateway. Pricing remains explicitly supplied by the user.

An optional smoke test sends only a fixed synthetic sentence. It performs one
request, disables SDK retries, sets a 512-token output limit and a 30-second timeout,
and prints schema validity and usage without source text or credentials.
It is not a qualified production adapter or a guarantee of a billing cap.
To run it, set the provider key in your existing process environment and choose
an explicit model that supports structured output:

```sh
npm run build
npm run smoke:live -- openai YOUR_MODEL_ID --allow-paid
# Or:
npm run smoke:live -- anthropic YOUR_MODEL_ID --allow-paid
# Or use Gateway with an explicit upstream:
npm run smoke:live -- gateway openai/YOUR_MODEL_ID --allow-paid --only openai
```

This is opt-in and can incur provider charges. Default checks never run it.

## Distribution

The qualified platform targets are macOS and Linux. Windows is intentionally
untested and is not a release gate.

The intended distribution is an npm package with a `spellagent` executable,
installed globally or invoked with `npx`. The repository currently uses version
`0.0.0` and `private: true` to prevent accidental publication. Nothing is published.
The npm archive includes compiled JavaScript, bundled grammars, and license notices;
users will not need development dependencies or a native compiler.

The product operates on local files and has no Git/GitHub integration. Development
packaging scripts invoke npm; those scripts are not part of product command execution.

## License

[MIT](LICENSE), copyright 2026 SpellAgent contributors. Bundled parsers retain
separate upstream MIT notices, copied verbatim into `assets/licenses/` during build
and included in the npm archive. `assets/inventory.json` records each grammar's
source package, version, size, and SHA-256. The web-tree-sitter runtime and other
npm dependencies retain their own licenses. See the dated inventory in
[the plan](docs/plan.md#11-phase-0-implementation-evidence).
