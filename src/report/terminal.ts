import pc from "picocolors";
import type { ServerSummary } from "../run/aggregate.js";
import type { PairedResult } from "../stats/paired.js";

function n(v: number, digits = 0): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function usd(v: number | null): string {
  return v === null ? "n/a" : `$${v.toFixed(4)}`;
}

export function printServerSummary(s: ServerSummary): void {
  const star = s.estimated ? pc.yellow(" *estimated") : "";
  console.log(pc.bold(`\n── ${s.label} ──`) + pc.dim(`  (${s.taskCount} tasks × ${s.epochs} epochs, ${s.attempts} attempts, ${s.failures} failed)`));

  console.log(pc.cyan("Efficiency"));
  console.log(`  tokens/task     ${n(s.efficiency.tokensMedian)} ${pc.dim(`median · p90 ${n(s.efficiency.tokensP90)} · IQR ${n(s.efficiency.tokensIqr)}`)}`);
  console.log(`  tool calls      ${n(s.efficiency.toolCallsMedian, 1)} ${pc.dim("median")}`);
  console.log(`  discovery       ${n(s.efficiency.discoveryMean, 1)} ${pc.dim("round-trips/task")}`);
  console.log(`  refetch         ${n(s.efficiency.refetchMean, 1)} ${pc.dim("round-trips/task")}`);
  console.log(`  latency         ${n(s.efficiency.latencyP50)}ms ${pc.dim(`p50 · p95 ${n(s.efficiency.latencyP95)}ms`)}`);

  console.log(pc.cyan("Cost"));
  console.log(`  $/task          ${usd(s.cost.perTaskMean)} ${pc.dim(`(${s.cost.source})`)}`);

  console.log(pc.cyan("Context-bloat") + star);
  console.log(`  tool-defs       ${pct(s.bloat.shares.toolDef)} ${pc.dim(`· args ${pct(s.bloat.shares.toolArg)} · results ${pct(s.bloat.shares.toolResult)} · reasoning ${pct(s.bloat.shares.reasoning)} of MCP bytes`)}`);
  console.log(`  attributable    ${pct(s.bloat.attributableShareMean)} ${pc.dim(`of billable · floor ${n(s.bloat.floorTokensMean)} tok`)}`);

  console.log(pc.cyan("Reliability"));
  console.log(`  hallucinated    ${n(s.reliability.hallucinatedRate, 2)} ${pc.dim("calls/task")}`);
  console.log(`  schema viol.    ${n(s.reliability.schemaViolationRate, 2)} ${pc.dim("calls/task")}`);
  console.log(`  tool errors     ${n(s.reliability.toolErrorRate, 2)} ${pc.dim(`calls/task · recovery ${pct(s.reliability.recoveryRate)}`)}`);

  console.log(pc.cyan("Correctness"));
  if (s.correctness.judged) console.log(`  pass-rate       ${pct(s.correctness.scoreMean ?? 0)}`);
  else console.log(pc.dim("  (judge disabled — correctness not scored)"));

  const e = s.ergonomics;
  if (e.perTool.length) {
    console.log(pc.cyan("Server ergonomics") + pc.dim("  (server design, not the model)"));
    const fcs = e.firstCallSuccessRate;
    console.log(`  first-call ok   ${fcs === null ? "n/a" : pct(fcs)} ${pc.dim("of attempts started with a valid tool call")}`);
    if (e.heavyPayloadTools.length) {
      console.log(`  heavy payloads  ${pc.yellow(e.heavyPayloadTools.join(", "))} ${pc.dim(`(≥${n(e.payloadThresholdTokens)} tok/call — paginate?)`)}`);
    }
    if (e.unclearTools.length) {
      console.log(`  unclear tools   ${pc.yellow(e.unclearTools.join(", "))} ${pc.dim("(often mis-called on first reach — clarify desc/schema)")}`);
    }
    if (!e.heavyPayloadTools.length && !e.unclearTools.length) {
      console.log(pc.dim("  no design flags — payloads lean, tools called correctly on first reach"));
    }
  }
}

export interface CompareRow {
  metric: string;
  base: number;
  head: number;
  lowerIsBetter: boolean;
  result: PairedResult;
}

function cell(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w - 1) + " " : s + " ".repeat(w - s.length);
}

export function printCompare(baseLabel: string, headLabel: string, rows: CompareRow[]): void {
  console.log(pc.bold(`\n── compare: ${baseLabel} → ${headLabel} ──`));
  const W = [16, 12, 12, 12, 7, 9, 7, 6, 9, 6];
  const head = ["metric", "base", "head", "Δ(head-base)", "%chg", "±SE", "p", "sig?", "MDE", "reqN"];
  console.log(pc.dim(head.map((h, i) => cell(h, W[i]!)).join("")));
  for (const r of rows) {
    const d = r.result.meanDiff;
    const pctChg = r.base !== 0 ? (d / r.base) * 100 : 0;
    const good = d !== 0 && (r.lowerIsBetter ? d < 0 : d > 0);
    const mark = d === 0 ? "·" : good ? "▼" : "▲";
    const line = [
      cell(r.metric, W[0]!),
      cell(n(r.base, 1), W[1]!),
      cell(n(r.head, 1), W[2]!),
      cell(`${mark}${d >= 0 ? "+" : ""}${n(d, 1)}`, W[3]!),
      cell(`${pctChg >= 0 ? "+" : ""}${pctChg.toFixed(0)}%`, W[4]!),
      cell(n(r.result.pairedSe, 1), W[5]!),
      cell(r.result.p.toFixed(3), W[6]!),
      cell(r.result.resolvable ? "yes" : "no", W[7]!),
      cell(n(r.result.mde, 1), W[8]!),
      cell(String(r.result.requiredN), W[9]!),
    ].join("");
    console.log(good ? pc.green(line) : d === 0 ? line : pc.red(line));
  }
  console.log(pc.dim(`\n  paired over n=${rows[0]?.result.n ?? 0} tasks. sig? = delta resolvable at current n (p<0.05).`));
  console.log(pc.dim(`  ▼ head better · ▲ head worse · reqN = tasks needed to resolve the observed delta at 80% power.`));
}
