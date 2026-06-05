import type { CompareRow } from "../report/terminal.js";
import type { ServerSummary } from "./aggregate.js";

/**
 * CI gates. Two pure, testable checks:
 *  - detectRegressions: flags a metric ONLY when it moved the wrong way AND the
 *    paired test says the delta is resolvable at the current n. Noise never fails CI.
 *  - evaluateBudgets: checks a summary against absolute thresholds.
 */

export interface Regression {
  metric: string;
  delta: number;
  pctChange: number;
  p: number;
}

/** Resolvable, wrong-direction deltas only. lowerIsBetter metrics regress when Δ>0; pass-rate when Δ<0. */
export function detectRegressions(rows: CompareRow[]): Regression[] {
  const out: Regression[] = [];
  for (const r of rows) {
    if (!r.result.resolvable) continue;
    const d = r.result.meanDiff;
    const worse = r.lowerIsBetter ? d > 0 : d < 0;
    if (worse) out.push({ metric: r.metric, delta: d, pctChange: r.base ? (d / r.base) * 100 : 0, p: r.result.p });
  }
  return out;
}

/** Absolute thresholds for `dyno assert`. All optional; only set ones are checked. */
export interface Budgets {
  /** correctness pillar (needs --judge); fails if below. */
  minPassRate?: number;
  maxTokensMedian?: number;
  maxCostPerTask?: number;
  maxHallucinationRate?: number;
  maxToolErrorRate?: number;
  maxSchemaViolationRate?: number;
  /** Server-ergonomics gates. */
  minFirstCallSuccess?: number;
  maxHeavyPayloadTools?: number;
}

export interface BudgetCheck {
  name: string;
  comparator: "<=" | ">=";
  limit: number;
  /** null = the run didn't measure this (e.g. pass-rate with the judge off) → treated as a failure. */
  actual: number | null;
  pass: boolean;
}

export function evaluateBudgets(s: ServerSummary, b: Budgets): BudgetCheck[] {
  const checks: BudgetCheck[] = [];
  const le = (name: string, limit: number | undefined, actual: number | null): void => {
    if (limit == null) return;
    checks.push({ name, comparator: "<=", limit, actual, pass: actual != null && actual <= limit });
  };
  const ge = (name: string, limit: number | undefined, actual: number | null): void => {
    if (limit == null) return;
    checks.push({ name, comparator: ">=", limit, actual, pass: actual != null && actual >= limit });
  };

  ge("pass-rate", b.minPassRate, s.correctness.scoreMean);
  le("tokens/task (median)", b.maxTokensMedian, s.efficiency.tokensMedian);
  le("$/task", b.maxCostPerTask, s.cost.perTaskMean);
  le("hallucinated/task", b.maxHallucinationRate, s.reliability.hallucinatedRate);
  le("tool errors/task", b.maxToolErrorRate, s.reliability.toolErrorRate);
  le("schema viol./task", b.maxSchemaViolationRate, s.reliability.schemaViolationRate);
  ge("first-call success", b.minFirstCallSuccess, s.ergonomics.firstCallSuccessRate);
  le("heavy-payload tools", b.maxHeavyPayloadTools, s.ergonomics.heavyPayloadTools.length);
  return checks;
}
