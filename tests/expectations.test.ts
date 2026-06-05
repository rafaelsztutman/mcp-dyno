import { describe, it, expect } from "vitest";
import { checkExpectations, hasExpectations } from "../src/score/expectations.js";
import { ensembleStats } from "../src/score/judge.js";
import type { Transcript } from "../src/types.js";

function tx(finalText: string, toolNames: string[]): Transcript {
  return {
    finalText,
    turns: [
      {
        userPrompt: "do it",
        assistantText: finalText,
        toolCalls: toolNames.map((name) => ({ name, args: {}, result: "ok", isError: false })),
        usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
    ],
    toolDefs: [],
    estimated: false,
    durationMs: 1,
  };
}

describe("hasExpectations", () => {
  it("is false for empty / no fields", () => {
    expect(hasExpectations(undefined)).toBe(false);
    expect(hasExpectations({})).toBe(false);
    expect(hasExpectations({ toolsCalled: [] })).toBe(false);
  });
  it("is true when any field is populated", () => {
    expect(hasExpectations({ answerContains: ["x"] })).toBe(true);
  });
});

describe("checkExpectations", () => {
  it("passes all checks → score 1", () => {
    const r = checkExpectations(tx("the answer is 5", ["search"]), {
      toolsCalled: ["search"],
      answerContains: ["5"],
      answerMatches: ["\\d+"],
    });
    expect(r.score).toBe(1);
    expect(r.verdicts.every((v) => v.verdict === "PASS")).toBe(true);
  });

  it("fails a missing tool and matches case-insensitively", () => {
    const r = checkExpectations(tx("Hello World", ["search"]), {
      toolsCalled: ["missing"],
      answerContains: ["hello"],
    });
    const tool = r.verdicts.find((v) => v.criterion.includes("missing"))!;
    const contains = r.verdicts.find((v) => v.criterion.includes("hello"))!;
    expect(tool.verdict).toBe("FAIL");
    expect(contains.verdict).toBe("PASS");
    expect(r.score).toBe(0.5);
  });

  it("marks an invalid regex as FAIL with a clear reason", () => {
    const r = checkExpectations(tx("x", []), { answerMatches: ["("] });
    expect(r.verdicts[0]!.verdict).toBe("FAIL");
    expect(r.verdicts[0]!.reason).toBe("invalid regex");
  });
});

describe("ensembleStats", () => {
  it("perfect agreement when judges match", () => {
    const r = ensembleStats([0.8, 0.8, 0.8]);
    expect(r.score).toBeCloseTo(0.8, 10);
    expect(r.agreement).toBeCloseTo(1, 10);
  });
  it("zero agreement at maximal spread", () => {
    expect(ensembleStats([1, 0])).toEqual({ score: 0.5, agreement: 0 });
  });
  it("no agreement metric with a single score", () => {
    expect(ensembleStats([0.9, null])).toEqual({ score: 0.9, agreement: null });
  });
  it("null score when nothing was judged", () => {
    expect(ensembleStats([null, null])).toEqual({ score: null, agreement: null });
  });
});
