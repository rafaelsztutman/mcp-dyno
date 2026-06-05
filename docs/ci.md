# mcp-dyno in CI

Turn mcp-dyno into a PR gate. Two complementary checks, both designed to **fail only on
real signal** — a paired-statistics regression that's resolvable at your sample size, or an
absolute budget you set — so noisy LLM runs don't flake your build.

## Budget gate — `dyno assert`

Set thresholds once (in `dyno.config.json` or a JSON file) and fail the build if a run breaches them:

```jsonc
// dyno.config.json
{
  "server": { "target": "node ./build/index.js" },
  "budgets": {
    "minPassRate": 0.8,          // needs --judge
    "maxTokensMedian": 20000,
    "maxCostPerTask": 0.05,
    "maxHallucinationRate": 0,
    "maxToolErrorRate": 0.1,
    "minFirstCallSuccess": 0.7,  // Server-ergonomics gate
    "maxHeavyPayloadTools": 0
  }
}
```

```bash
dyno analyze --config dyno.config.json --judge --out .dyno
dyno assert  --config dyno.config.json --out .dyno   # exit 1 if any budget is breached
```

`dyno assert` with no `--run` checks the most recent run in `--out`.

## Regression gate — `dyno compare --fail-on-regression`

Compare the PR branch against the base and fail only on a **resolvable** regression:

```bash
dyno compare --base "node ./main/build/index.js" \
             --head "node ./pr/build/index.js"   \
             --tasks ./dyno-tasks.yaml --epochs 5 \
             --fail-on-regression
```

A delta fails the build only when it moves the wrong way **and** the paired test marks it
resolvable at the current n (p < 0.05). Improvements and noise never fail.

## GitHub Actions

```yaml
# .github/workflows/dyno.yml
name: mcp-dyno
on: pull_request
jobs:
  dyno:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build        # build your MCP server
      - name: Analyze
        env:
          # one of these, matching your --model:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: npx mcp-dyno analyze --config dyno.config.json --judge --out .dyno
      - name: Assert budgets
        run: npx mcp-dyno assert --config dyno.config.json --out .dyno --summary-md "$GITHUB_STEP_SUMMARY"
```

`--summary-md "$GITHUB_STEP_SUMMARY"` renders the pass/fail table (and, for `compare`, the
metric diff) directly in the PR's checks summary. Both commands exit non-zero on failure, so
the job fails the check.

> Cost note: each run drives a real model. Keep CI cheap with a small task suite, low
> `--epochs`, and an inexpensive model (e.g. `--model openai/gpt-4o-mini` or
> `claude-haiku-4-5-20251001`); reserve larger runs for release branches.
