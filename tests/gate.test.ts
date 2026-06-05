import { describe, it, expect } from "vitest";
import { detectRegressions, evaluateBudgets, type Budgets } from "../src/run/gate.js";
import type { CompareRow } from "../src/report/terminal.js";
import type { ServerSummary } from "../src/run/aggregate.js";

function row(metric: string, base: number, head: number, lowerIsBetter: boolean, resolvable: boolean): CompareRow {
  return {
    metric,
    base,
    head,
    lowerIsBetter,
    result: { meanDiff: head - base, resolvable } as CompareRow["result"],
  };
}

describe("detectRegressions — resolvable, wrong-direction only", () => {
  it("flags a resolvable increase on a lower-is-better metric", () => {
    const regs = detectRegressions([row("tokens/task", 100, 130, true, true)]);
    expect(regs.map((r) => r.metric)).toEqual(["tokens/task"]);
  });

  it("does NOT flag a resolvable improvement", () => {
    expect(detectRegressions([row("tokens/task", 130, 100, true, true)])).toEqual([]);
  });

  it("ignores a wrong-direction delta that is NOT resolvable (noise)", () => {
    expect(detectRegressions([row("tokens/task", 100, 130, true, false)])).toEqual([]);
  });

  it("flags a resolvable pass-rate DROP (higher-is-better)", () => {
    const regs = detectRegressions([row("pass-rate", 0.9, 0.7, false, true)]);
    expect(regs.map((r) => r.metric)).toEqual(["pass-rate"]);
  });

  it("does not flag a pass-rate improvement", () => {
    expect(detectRegressions([row("pass-rate", 0.7, 0.9, false, true)])).toEqual([]);
  });
});

function summary(over: Partial<ServerSummary>): ServerSummary {
  const base: ServerSummary = {
    label: "s",
    epochs: 1,
    taskCount: 1,
    attempts: 1,
    failures: 0,
    estimated: false,
    efficiency: { tokensMedian: 1000, tokensP90: 1, tokensIqr: 1, toolCallsMedian: 1, discoveryMean: 0, refetchMean: 0, latencyP50: 0, latencyP95: 0 },
    cost: { perTaskMean: 0.01, source: "priced" },
    bloat: { shares: { toolDef: 0, toolArg: 0, toolResult: 0, reasoning: 0 }, toolDefTokensMean: 0, attributableShareMean: 0.5, floorTokensMean: 0 },
    reliability: { hallucinatedRate: 0, schemaViolationRate: 0, toolErrorRate: 0, recoveryRate: 1 },
    correctness: { scoreMean: 0.8, judged: true },
    ergonomics: { perTool: [], firstCallSuccessRate: 0.75, heavyPayloadTools: ["big"], unclearTools: [], payloadThresholdTokens: 1500 },
    perTask: [],
  };
  return { ...base, ...over };
}

describe("evaluateBudgets", () => {
  it("passes when all thresholds are met", () => {
    const b: Budgets = { minPassRate: 0.7, maxTokensMedian: 2000, maxHallucinationRate: 0 };
    const checks = evaluateBudgets(summary({}), b);
    expect(checks.length).toBe(3);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("fails the breached budgets", () => {
    const b: Budgets = { minPassRate: 0.95, maxTokensMedian: 500 };
    const checks = evaluateBudgets(summary({}), b);
    expect(checks.find((c) => c.name === "pass-rate")!.pass).toBe(false);
    expect(checks.find((c) => c.name === "tokens/task (median)")!.pass).toBe(false);
  });

  it("treats an unmeasured metric (null) as a failure", () => {
    const b: Budgets = { minPassRate: 0.5 };
    const checks = evaluateBudgets(summary({ correctness: { scoreMean: null, judged: false } }), b);
    expect(checks[0]!.pass).toBe(false);
    expect(checks[0]!.actual).toBeNull();
  });

  it("checks ergonomics budgets", () => {
    const checks = evaluateBudgets(summary({}), { minFirstCallSuccess: 0.8, maxHeavyPayloadTools: 0 });
    expect(checks.find((c) => c.name === "first-call success")!.pass).toBe(false); // 0.75 < 0.8
    expect(checks.find((c) => c.name === "heavy-payload tools")!.pass).toBe(false); // 1 > 0
  });

  it("only checks budgets that are set", () => {
    expect(evaluateBudgets(summary({}), {})).toEqual([]);
  });
});
