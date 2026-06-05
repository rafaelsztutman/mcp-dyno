# mcp-dyno task corpus

Versioned, **human-written** task suites grouped by server *archetype*. Because the
prompts and pass/fail criteria are fixed (not auto-generated per run), results against a
corpus are **comparable across servers and over time** — and correctness graded against
hand-written criteria is sharper than the *indicative* score you get from auto-generated
ones.

## Use

```bash
dyno analyze --server "node ./build/index.js" --corpus filesystem@1 --judge
dyno analyze --server "uvx mcp-server-fetch"    --corpus fetch          # latest version
```

`--corpus <archetype>` selects the latest version; `--corpus <archetype>@<n>` pins one.
`--tasks` (your own file) takes precedence over `--corpus`, which takes precedence over
auto-generation.

## Layout & conventions

```
corpus/<archetype>/v<version>.yaml
```

- **Tool-name-agnostic prompts.** Phrase tasks the way a *user* would ("read the README"),
  never "call `read_file`" — so the same suite works on any server of that archetype.
- **Behavioral criteria.** Each criterion is something a judge can check from the transcript
  (used a tool vs. guessed; answer grounded in real results; failed safely on missing input).
- **Bump the version, don't edit in place.** Once `v1` is published, changes go in `v2` so
  old scores stay meaningful.

## Available archetypes

- `filesystem` — read / write / list / search files.
- `fetch` — retrieve and reason over web content.

This is a starter set. Contributions of new archetypes (database, search, git, …) and new
versions are welcome — keep prompts portable and criteria checkable.
