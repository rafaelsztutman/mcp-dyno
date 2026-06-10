# mcp-dyno demo

A real `mcp-dyno` run you can explore without setting up anything.

> **Note:** the **metrics and analysis below are from a real run**, but all names are
> **fictitious** — two servers (`sandbox-mcp`, a code-execution MCP, and `toolkit-mcp`,
> a broad REST/tool-list MCP) over a made-up marketing platform ("Marketwave"). Campaign
> names, segments, transcript contents, and tool names are synthetic.

## What was run

The same 2-task workload was run against **two MCP servers** — `sandbox-mcp` (one
code-execution tool) and `toolkit-mcp` (a 28-tool REST surface) — each under **two driver
models** (Claude Haiku and Sonnet): 4 independent `analyze` runs, 2 epochs each, judged for
correctness across all six pillars (efficiency, cost, context-bloat, correctness, reliability,
and **server ergonomics**).

| server @ model | tokens/task | $/task | tool calls | first-call ok | correctness |
|---|--:|--:|--:|--:|--:|
| `sandbox-mcp` @ haiku  | **11,790** | **$0.025** | 1.5 | 75%  | 100% |
| `toolkit-mcp` @ haiku  | 23,290 | $0.067 | 3.5 | **100%** | 100% |
| `sandbox-mcp` @ sonnet | 14,949 | $0.099 | 2.5 | 50%  | 100% |
| `toolkit-mcp` @ sonnet | 21,012 | $0.157 | 2.5 | **100%** | 100% |

## The finding

**Everything is 100% correct — so "which server is better?" is only answerable across the
*other* pillars, and it's a genuine trade-off, not a winner.**

- **`sandbox-mcp` (code-execution, 1 tool) is the lean one** — roughly **half the tokens and
  ~2.6× cheaper** than `toolkit-mcp` at the same model. Those 28 REST tool definitions are a
  context tax `toolkit-mcp` pays on *every* call.
- **`toolkit-mcp` (28 REST tools) is the ergonomic one** — `first-call ok 100%`, **zero tool
  errors**: each tool is individually obvious, so the model picks the right one and fills its
  arguments correctly on the first try. `sandbox-mcp`'s single `execute_code` tool gets flagged
  **"unclear"** — the model's *first* code attempt often errors, then it retries and recovers
  (correct in the end, but via wasted round-trips).
- **Model interaction:** Sonnet costs ~4× Haiku per task — and on `sandbox-mcp` it's actually
  *worse* on first-call ergonomics (50% vs 75%), because it writes more elaborate code that
  fails first-try more often. On `toolkit-mcp`, both models are clean.

This is exactly the multi-perspective picture a single "tokens/task" number hides — and the
new **Server Ergonomics** pillar is what surfaces *which tool design* is causing the friction,
as a per-tool fix-list. `mcp-dyno` is also honest about noise: with a small task set, it marks
which deltas are actually statistically resolvable.

## Explore it yourself

From a clone of this repo:

```bash
npm install && npm run build
node dist/cli/index.js view --out demo/results
# → http://localhost:4000
```

Click any run for its six-pillar report (including the per-tool ergonomics worklist) and
per-task transcripts. Then try **"Model matrix (pick 2+)"** — select all four runs for the
side-by-side with best-in-row highlighting — or **"Compare any two runs"** for the paired
statistics (e.g. `sandbox-mcp @sonnet` vs `toolkit-mcp @sonnet`).
