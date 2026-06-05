import type { ServerSummary } from "../run/aggregate.js";
import type { BudgetCheck, Regression } from "../run/gate.js";
import type { CompareRow } from "./terminal.js";

/** GitHub-flavored markdown summaries for CI ($GITHUB_STEP_SUMMARY). */

function num(v: number | null, d = 0): string {
  return v == null ? "n/a" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}

export function budgetMarkdown(label: string, checks: BudgetCheck[]): string {
  const failed = checks.filter((c) => !c.pass).length;
  const head = failed === 0 ? `✅ **dyno assert** — all ${checks.length} budgets met` : `❌ **dyno assert** — ${failed}/${checks.length} budget(s) breached`;
  const lines = [
    `## ${head}`,
    ``,
    `Run: \`${label}\``,
    ``,
    `| metric | limit | actual | result |`,
    `| --- | ---: | ---: | :---: |`,
    ...checks.map((c) => `| ${c.name} | ${c.comparator} ${num(c.limit, 3)} | ${num(c.actual, 3)} | ${c.pass ? "✅" : "❌"} |`),
  ];
  return lines.join("\n") + "\n";
}

export function regressionMarkdown(
  baseLabel: string,
  headLabel: string,
  rows: CompareRow[],
  regressions: Regression[],
): string {
  const regressed = new Set(regressions.map((r) => r.metric));
  const head =
    regressions.length === 0
      ? `✅ **dyno compare** — no resolvable regressions (${baseLabel} → ${headLabel})`
      : `❌ **dyno compare** — ${regressions.length} resolvable regression(s) (${baseLabel} → ${headLabel})`;
  const lines = [
    `## ${head}`,
    ``,
    `| metric | base | head | Δ | %chg | p | resolvable | |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | :---: | :---: |`,
    ...rows.map((r) => {
      const d = r.result.meanDiff;
      const pct = r.base ? (d / r.base) * 100 : 0;
      const isReg = regressed.has(r.metric);
      const flag = isReg ? "🔴" : r.result.resolvable ? (r.lowerIsBetter ? (d < 0 ? "🟢" : "") : d > 0 ? "🟢" : "") : "";
      return `| ${r.metric} | ${num(r.base, 1)} | ${num(r.head, 1)} | ${d >= 0 ? "+" : ""}${num(d, 1)} | ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% | ${r.result.p.toFixed(3)} | ${r.result.resolvable ? "yes" : "no"} | ${flag} |`;
    }),
    ``,
    `_Only resolvable, wrong-direction deltas (🔴) fail the build — noise is ignored._`,
  ];
  return lines.join("\n") + "\n";
}

/** Compact one-block summary of a single analyze run (used by assert output). */
export function summaryMarkdown(s: ServerSummary): string {
  return [
    `### ${s.label} — ${s.taskCount} tasks × ${s.epochs} epochs`,
    ``,
    `| pillar | value |`,
    `| --- | ---: |`,
    `| tokens/task (median) | ${num(s.efficiency.tokensMedian)} |`,
    `| $/task | ${s.cost.perTaskMean == null ? "n/a" : "$" + s.cost.perTaskMean.toFixed(4)} |`,
    `| pass-rate | ${s.correctness.scoreMean == null ? "n/a" : (s.correctness.scoreMean * 100).toFixed(0) + "%"} |`,
    `| attributable | ${(s.bloat.attributableShareMean * 100).toFixed(0)}% |`,
    `| first-call success | ${s.ergonomics.firstCallSuccessRate == null ? "n/a" : (s.ergonomics.firstCallSuccessRate * 100).toFixed(0) + "%"} |`,
    `| heavy-payload tools | ${s.ergonomics.heavyPayloadTools.join(", ") || "none"} |`,
  ].join("\n") + "\n";
}
