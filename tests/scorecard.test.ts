import { describe, it, expect } from "vitest";
import { computeScorecard, gradeOf, reliabilityScore, ergonomicsScore, badgeEndpoint } from "../src/run/scorecard.js";
import type { ServerSummary } from "../src/run/aggregate.js";

function summary(over: Partial<ServerSummary> = {}): ServerSummary {
  const base: ServerSummary = {
    label: "s",
    epochs: 3,
    taskCount: 4,
    attempts: 12,
    failures: 0,
    estimated: false,
    efficiency: { tokensMedian: 12000, tokensP90: 1, tokensIqr: 1, toolCallsMedian: 3, discoveryMean: 1, refetchMean: 0, latencyP50: 0, latencyP95: 0 },
    cost: { perTaskMean: 0.05, source: "priced" },
    bloat: { shares: { toolDef: 0.3, toolArg: 0.1, toolResult: 0.4, reasoning: 0.2 }, toolDefTokensMean: 900, attributableShareMean: 0.6, floorTokensMean: 1800 },
    reliability: { hallucinatedRate: 0, schemaViolationRate: 0, toolErrorRate: 0, recoveryRate: 1 },
    correctness: { scoreMean: 0.92, judged: true },
    ergonomics: { perTool: [{ name: "t", calls: 4, resultTokensMean: 100, resultTokensMax: 200, resultTokenShare: 1, heavyPayload: false, firstCalls: 4, firstCallSchemaErrorRate: 0, firstCallErrorRate: 0 }], firstCallSuccessRate: 1, heavyPayloadTools: [], unclearTools: [], payloadThresholdTokens: 1500 },
    perTask: [],
  };
  return { ...base, ...over };
}

describe("gradeOf", () => {
  it("maps scores to bands", () => {
    expect(gradeOf(95)).toBe("A");
    expect(gradeOf(85)).toBe("B");
    expect(gradeOf(72)).toBe("C");
    expect(gradeOf(61)).toBe("D");
    expect(gradeOf(40)).toBe("F");
  });
});

describe("reliabilityScore", () => {
  it("is 100 for a clean run", () => {
    expect(reliabilityScore(summary())).toBe(100);
  });
  it("penalizes hallucinations heavily", () => {
    const s = summary({ reliability: { hallucinatedRate: 0.1, schemaViolationRate: 0, toolErrorRate: 0, recoveryRate: 1 } });
    expect(reliabilityScore(s)).toBe(70); // -30 for full hallucination penalty
  });
});

describe("ergonomicsScore", () => {
  it("is null when no tools were used", () => {
    const s = summary({ ergonomics: { perTool: [], firstCallSuccessRate: null, heavyPayloadTools: [], unclearTools: [], payloadThresholdTokens: 1500 } });
    expect(ergonomicsScore(s)).toBeNull();
  });
  it("dings heavy and unclear tools", () => {
    const s = summary({ ergonomics: { perTool: [{ name: "t", calls: 1, resultTokensMean: 0, resultTokensMax: 0, resultTokenShare: 1, heavyPayload: true, firstCalls: 2, firstCallSchemaErrorRate: 0.5, firstCallErrorRate: 0 }], firstCallSuccessRate: 1, heavyPayloadTools: ["t"], unclearTools: ["t"], payloadThresholdTokens: 1500 } });
    expect(ergonomicsScore(s)).toBe(75); // 100 - 10 (heavy) - 15 (unclear)
  });
});

describe("computeScorecard", () => {
  it("grades correctness, reliability, ergonomics and a composite", () => {
    const c = computeScorecard(summary());
    expect(c.graded.map((g) => g.pillar)).toEqual(["Correctness", "Reliability", "Server ergonomics"]);
    expect(c.composite).toBe("A"); // 92, 100, 100 → ~97
    expect(c.measured.find((m) => m.label === "$/task")!.value).toBe("$0.0500");
  });

  it("omits correctness when the judge was off", () => {
    const c = computeScorecard(summary({ correctness: { scoreMean: null, judged: false } }));
    expect(c.graded.find((g) => g.pillar === "Correctness")).toBeUndefined();
    expect(c.note).toMatch(/judge was off/);
  });

  it("produces a shields endpoint badge", () => {
    const b = badgeEndpoint(computeScorecard(summary()));
    expect(b.schemaVersion).toBe(1);
    expect(b.message).toMatch(/design quality/);
    expect(b.color).toBe("brightgreen");
  });
});
