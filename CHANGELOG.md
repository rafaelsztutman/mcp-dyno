# Changelog

## 0.2.1

Maintenance + security.

### Fixed
- **Dependencies:** patched transitive advisories flagged by Snyk/`npm audit` — `form-data`
  (CRLF injection, via the Anthropic SDK) and `hono` (path traversal / CORS, via the MCP SDK)
  bumped to fixed versions; `npm audit` now reports **0 vulnerabilities**. Bumped the dev
  toolchain (`vitest` 2 → 4) to clear the dev-only `esbuild`/`vite` advisories.
- **Gemini model id:** docs and the price table referenced the now-retired `gemini-2.0-flash`;
  switched to `gemini-2.5-flash` (added `gemini-2.5-flash`/`gemini-2.5-pro` pricing) after live
  testing surfaced a 404.

## 0.2.0

Multi-model, a sixth pillar, CI gates, a shared corpus, and trustworthy-correctness depth.

### Added
- **Multi-model drivers** — drive any MCP server with OpenAI, Google/Gemini, OpenRouter,
  Groq, Together, or any OpenAI-compatible endpoint, not just Claude. Select with
  `--model "<provider>/<id>"` (a bare id stays Claude). Cross-family judging is supported
  (`--judge-model openai/gpt-4o`), and `dyno view` gains an N-run **model matrix**.
- **Server Ergonomics pillar** — grades the *server's design*, not the model: per-tool
  result-payload weight and first-call affordance, surfaced as a per-tool design worklist
  (in the terminal report and dashboard).
- **`dyno judge`** — re-score a saved run's transcripts with a different judge or a judge
  **ensemble** (with agreement reporting), without re-driving.
- **CI gates** — `dyno assert` (budget thresholds) and `dyno compare --fail-on-regression`
  (fails only on a *statistically resolvable* regression — noise never breaks a build), with
  `--summary-md` for `$GITHUB_STEP_SUMMARY` and a ready-to-copy GitHub Action (`docs/ci.md`).
- **Shared corpus + scorecard** — versioned, human-written task suites (`--corpus filesystem@1`)
  so runs are comparable across servers, and `dyno scorecard` for per-pillar letter grades +
  a committable shields.io badge.
- **Trustworthy correctness** — ground-truth `expect` task checks (deterministic, no judge),
  and distribution-free statistics (paired sign-flip permutation p-value + bootstrap CI)
  alongside the existing paired t-test.
- **`--label`** to name a server/run in the dashboard and matrix.

### Changed
- The Claude CLI driver now disallows Claude Code's "bypass" built-ins (Bash/Read/…) so the
  model is measured through the server under test, and filters Claude Code's own tools out of
  the metrics. (ToolSearch is left enabled — MCP tools surface through it.)
- Docs (README, DESIGN, AGENTS) updated for all of the above; the public demo is refreshed
  to a six-pillar, multi-model run.

### Notes
- Zero new runtime dependencies — the OpenAI-compatible client is `fetch`-based.
