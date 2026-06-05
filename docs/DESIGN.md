# mcp-dyno — design

## Goal

Give MCP authors one command that measures how good their server is **when an LLM
actually drives it**, across five perspectives, with honest error bars — and lets
them prove an optimization worked.

## The five pillars

- **Efficiency** — tokens/task, tool-call & round-trip counts (discovery, refetch), latency.
- **Cost** — $/task at real model prices (or CLI-reported cost).
- **Context-bloat** — a 4-channel decomposition of where the bytes go (tool
  definitions / tool arguments / tool results / model reasoning), plus how much of
  the billable total is *attributable* to the MCP vs an irreducible system-prompt floor.
- **Correctness** — task success, graded by an LLM judge against per-task criteria
  (labeled *indicative* when the criteria were auto-generated), or — when a task declares
  deterministic `expect` checks (tools called / answer contains / regex) — scored from those
  directly, with no judge and no self-judging loop.
- **Reliability** — `pass^k` consistency, hallucinated-tool rate, schema-adherence,
  tool-error and recovery rates.
- **Server ergonomics** — design-quality signals attributed to the *server*, not the
  model: per-tool **result-payload efficiency** (tokens returned per call; heavy payloads
  are a pagination/field-selection candidate) and **affordance clarity** (first-call
  success — does the model pick a real tool and fill its args correctly from the
  description/schema alone?). Surfaces a per-tool "design worklist".

Most pillars are **ground-truth-free** — properties of the interaction itself — so
they work zero-config on any server. Only correctness needs a judge or expectations.

## Architecture

```
ModelDriver               how the LLM drives the server
  ApiLoopDriver           own agent loop over the Anthropic Messages API (exact tokens)
  OpenAiLoopDriver        own agent loop over any OpenAI-compatible API (OpenAI / Gemini / OpenRouter / …)
  ClaudeCliDriver         claude -p subscription path ($0 API; decomposition "estimated")
providers                 "<provider>/<id>" → driver + base URL + key env + byte→token tariff
McpConnection             stdio / SSE / HTTP via @modelcontextprotocol/sdk
workload                  auto-generate tasks from the tool surface, or bring your own
measure                   4-channel decomposition + efficiency signals
score                     structural checks + LLM judge
stats                     paired-difference test with MDE / required-n
run                       epochs × tasks runner → per-attempt results → aggregate
report                    terminal + results.json + the `dyno view` dashboard
```

### Why two drivers

The API-loop driver builds the tool list itself and sees exact token usage, so
tool-definition cost and the attributable-vs-floor split are measured precisely.
The CLI driver runs on a Claude subscription (no API spend) but Claude Code's own
system prompt inflates the billable floor, so context-bloat is reported as
*estimated* there.

### Statistics

Comparisons use a paired-difference test (per-task epoch means), reporting the
delta, paired standard error, p-value, a minimum-detectable-effect, and the
sample size required to resolve the observed delta at 80% power. The tool refuses
to call a noisy delta significant — small-n results are shown as *not resolvable*.

## Trustworthy correctness

Three layers reduce reliance on a single self-judge:
- **Ground-truth expectations** — a task's `expect: { toolsCalled, answerContains, answerMatches }`
  is checked deterministically from the transcript; when present it scores correctness directly.
- **Cross-family / ensemble judging** — `dyno judge --judge-models a,b,c` re-grades stored
  transcripts with several judges (ideally different families) and reports an **agreement** metric,
  flagging low-agreement attempts for inspection.
- **Distribution-free statistics** — alongside the paired t-test, `compare` reports a paired
  **sign-flip permutation** p-value (exact for n ≤ 20), and a seeded percentile **bootstrap CI** is
  available — neither assumes the per-task differences are normal (the weak spot at small n / binary
  pass-fail).

## Decoupled runs

A run is a self-contained artifact. Run one task set against several servers (or
the same server under different models) as independent `analyze` runs, then compare
any two of them in the dashboard — including same-MCP, different-model comparisons.

## Corpus & scorecard

Built-in, versioned task suites (`corpus/<archetype>/v<n>.yaml`, selected with
`--corpus filesystem@1`) make runs comparable across servers, with human-written criteria
(so correctness is not merely *indicative*). `dyno scorecard` grades the pillars with
absolute "good/bad" semantics (correctness, reliability, ergonomics) into letter grades +
an optional composite, and emits a shields.io badge; efficiency/cost are reported, not
graded, because they're workload-dependent.

## CI gates

`dyno assert` checks a run against absolute budgets; `dyno compare --fail-on-regression`
fails only on a *resolvable* regression (noise never fails a build). Both can write a
markdown summary for `$GITHUB_STEP_SUMMARY` (see `docs/ci.md`).

## Roadmap

- Richer dashboard (interactive charts; surface judge-agreement and permutation p).
- More corpus archetypes (database, search, git).
- Deeper schema/description linting; ensemble judging in the analyze path (not just re-score).
