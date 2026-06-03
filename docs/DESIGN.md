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
  (labeled *indicative* when the criteria were auto-generated).
- **Reliability** — `pass^k` consistency, hallucinated-tool rate, schema-adherence,
  tool-error and recovery rates.

Most pillars are **ground-truth-free** — properties of the interaction itself — so
they work zero-config on any server. Only correctness needs a judge or expectations.

## Architecture

```
ModelDriver               how the LLM drives the server
  ApiLoopDriver           own agent loop over the Anthropic Messages API (exact tokens)
  ClaudeCliDriver         claude -p subscription path ($0 API; decomposition "estimated")
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

## Decoupled runs

A run is a self-contained artifact. Run one task set against several servers (or
the same server under different models) as independent `analyze` runs, then compare
any two of them in the dashboard — including same-MCP, different-model comparisons.

## Roadmap

- Richer dashboard (interactive charts).
- Additional model providers behind the `ModelDriver` interface.
- Deeper schema/description linting.
