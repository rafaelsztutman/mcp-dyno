import { describe, it, expect } from "vitest";
import { attemptErgonomics, aggregateErgonomics } from "../src/measure/ergonomics.js";
import type { AttemptResult, ToolDef, Transcript } from "../src/types.js";

const TOOLS: ToolDef[] = [
  { name: "search", description: "Search", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
  { name: "fetchBig", description: "Fetch a big blob", inputSchema: { type: "object", properties: {} } },
  { name: "get", description: "Get one", inputSchema: { type: "object", properties: { x: { type: "number" } } } },
];

function tx(calls: Array<{ name: string; args: unknown; result: string; isError?: boolean }>): Transcript {
  return {
    finalText: "done",
    turns: [
      {
        userPrompt: "do it",
        assistantText: "",
        toolCalls: calls.map((c) => ({ name: c.name, args: c.args, result: c.result, isError: c.isError ?? false })),
        usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
    ],
    toolDefs: TOOLS,
    estimated: false,
    durationMs: 100,
  };
}

const BPT = 4;

describe("attemptErgonomics", () => {
  it("records the first call and per-tool result tokens", () => {
    // search called first with MISSING required `q` (affordance failure), then a heavy fetch.
    const e = attemptErgonomics(tx([
      { name: "search", args: {}, result: "" },
      { name: "fetchBig", args: {}, result: "y".repeat(12000) },
    ]), TOOLS, BPT);

    expect(e.firstCall).toEqual({ name: "search", errored: false, schemaViolated: true });
    expect(e.perTool.fetchBig!.resultTokens).toBe(3000); // 12000 bytes / 4
    expect(e.perTool.fetchBig!.calls).toBe(1);
    expect(e.firstCallByTool.search).toEqual({ errored: false, schemaViolated: true });
  });

  it("flags an unknown tool as an affordance failure", () => {
    const e = attemptErgonomics(tx([{ name: "ghost", args: {}, result: "?" }]), TOOLS, BPT);
    expect(e.firstCall).toEqual({ name: "ghost", errored: false, schemaViolated: true });
  });
});

describe("aggregateErgonomics", () => {
  const e1 = attemptErgonomics(tx([
    { name: "search", args: {}, result: "" }, // bad first call
    { name: "fetchBig", args: {}, result: "y".repeat(12000) }, // 3000 tok → heavy
  ]), TOOLS, BPT);
  const e2 = attemptErgonomics(tx([
    { name: "search", args: {}, result: "" }, // bad first call again
    { name: "get", args: { x: 1 }, result: "small" },
  ]), TOOLS, BPT);
  const attempts = [
    { failed: false, ergonomics: e1 },
    { failed: false, ergonomics: e2 },
  ] as unknown as AttemptResult[];

  const s = aggregateErgonomics(attempts);

  it("flags the heavy-payload tool only", () => {
    expect(s.heavyPayloadTools).toEqual(["fetchBig"]);
  });

  it("flags the repeatedly mis-called tool as unclear (needs >=2 first uses)", () => {
    expect(s.unclearTools).toEqual(["search"]);
    const search = s.perTool.find((t) => t.name === "search")!;
    expect(search.firstCalls).toBe(2);
    expect(search.firstCallSchemaErrorRate).toBe(1);
  });

  it("computes first-call success rate over attempts", () => {
    expect(s.firstCallSuccessRate).toBe(0); // both attempts started with a bad search call
  });

  it("sorts perTool by result-token share (heaviest first)", () => {
    expect(s.perTool[0]!.name).toBe("fetchBig");
    expect(s.perTool[0]!.resultTokenShare).toBeGreaterThan(0.99); // fetchBig holds nearly all result tokens
  });

  it("ignores attempts that lack ergonomics (pre-0.2 runs)", () => {
    const mixed = [...attempts, { failed: false } as AttemptResult];
    expect(() => aggregateErgonomics(mixed)).not.toThrow();
  });
});
