# AGENTS.md

Guidance for AI agents (and humans) working in this repo. For *what* the project
is, see [README.md](README.md); for architecture/rationale, see [docs/DESIGN.md](docs/DESIGN.md).

## Commands

```bash
npm run build      # tsc → dist/ (NOT a bundler — see gotchas)
npm run typecheck  # tsc --noEmit
npm test           # vitest, offline only
npm run dev -- <args>   # run the CLI via tsx, e.g. npm run dev -- analyze --help
```

CLI surface: `dyno init | analyze | compare | view` (built binary at `dist/cli/index.js`).

## Layout (`src/`)

- `cli/` — commander entry (`index.ts`) + one file per command; `options.ts` parses server specs.
- `engine/` — the `ModelDriver` interface (`driver.ts`) and impls: `api-loop-driver.ts`
  (Anthropic Messages API, exact tokens) and `claude-cli-driver.ts` (`claude -p`, $0).
  `claude-process.ts` spawns the CLI; `stream-json.ts` parses its events; `complete.ts`
  is one-shot completion shared by the judge + task generator.
- `mcp/connection.ts` — `McpConnection` over stdio / SSE / HTTP (`@modelcontextprotocol/sdk`).
- `workload/` — `load.ts` (BYO tasks) and `generate.ts` (auto-gen from the tool surface).
- `measure/` — `decompose.ts` (4-channel context-bloat) and `metrics.ts` (signals + percentiles).
- `score/` — `structural.ts` (objective, ground-truth-free) and `judge.ts` (LLM judge).
- `stats/paired.ts` — paired-difference test, MDE, required-n.
- `run/` — `runner.ts` (epochs × tasks), `aggregate.ts` (`ServerSummary`), `compare.ts`.
- `report/` — `terminal.ts`, `json.ts` (artifacts), `dashboard-html.ts` (the `dyno view` page).
- `config.ts` (defaults), `config-file.ts` (`dyno.config.json`), `pricing/prices.ts`, `types.ts`.

## Conventions

- **ESM + NodeNext.** Relative imports MUST use the `.js` extension (e.g. `from "./metrics.js"`),
  even though the source is `.ts`. `verbatimModuleSyntax` is on — use `import type` for types.
- `strict` + `noUncheckedIndexedAccess` are on; handle `possibly undefined` array access.
- Match the surrounding style; keep modules small and single-purpose.

## Gotchas (read before you build/edit)

- **Build with `tsc`, not tsup/esbuild bundling.** esbuild's native platform binary fails to
  install in some sandboxes ("Host version … does not match binary"). `tsc` is the supported build.
- **The dashboard client JS lives inside a TS template literal** in `report/dashboard-html.ts`
  and must contain **no backticks**. Build HTML with string concatenation; HTML-escape all dynamic
  content via the `esc()` helper. After editing, sanity-check with `node --check` on the extracted
  `<script>` (see `tests/live-dash-render.ts`).
- **`.dyno/` run artifacts contain real server response data and are git-ignored.** Never commit
  them. Same for `.env` and `tests/live-*.ts`.
- **Billable-token convention** (single source of truth, `config.billableTokens`):
  `input + cache_creation + output` — cache *reads* are excluded.
- **Decomposition is deliberately honest**: per-channel token estimates are NOT scaled to sum to
  billable; the unexplained remainder is surfaced as `floorTokens` (system-prompt floor). Don't
  "fix" this by normalizing.
- **`stats/paired.ts` is parity-tested** against the original Python implementation
  (`tests/stats.test.ts`). If you change it, keep the reference values matching.
- **Judge model ≠ driver model** (avoids self-enhancement bias). The judge/generator run on the
  same auth as the driver (CLI = $0 subscription, API = key).
- **Two fidelity levels**: API driver = exact tokens; CLI driver = decomposition is *estimated*
  (Claude Code's own system prompt inflates the floor). The dashboard labels this `*estimated`.

## Testing

- `npm test` runs the **offline** vitest suite (`tests/{measure,stats,judge,config}.test.ts`) — this
  is what CI runs. Keep it network-free.
- `tests/fixtures/mock-server.ts` is a tiny in-repo MCP server for deterministic integration checks.
- `tests/live-*.ts` are **local-only** (git-ignored): they spawn the real `claude` CLI and/or hit
  live servers, so they need a Claude CLI sign-in (or `ANTHROPIC_API_KEY`). Don't add them to CI.

## Auth / running

- `--auth api` needs `ANTHROPIC_API_KEY`. `--auth cli` uses an existing `claude` sign-in (no API spend).
- The CLI driver pre-allows **only** the server-under-test's tools; permission bypass
  (`--skip-permissions`) is explicit opt-in. Don't make it the default.

## Releasing

Bump `version` in `package.json`, commit, then `git tag vX.Y.Z && git push --tags`. The
`release` workflow runs the publish gate and `npm publish --provenance` (needs the
`NPM_TOKEN` repo secret). Don't `npm publish` locally — that ships without provenance.
