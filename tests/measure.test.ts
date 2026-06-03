import { describe, it, expect } from "vitest";
import type { ToolDef, Transcript } from "../src/types.js";
import { decompose } from "../src/measure/decompose.js";
import { extractSignals, percentile, median, iqr } from "../src/measure/metrics.js";
import { structuralFlags } from "../src/score/structural.js";

const toolDefs: ToolDef[] = [
  {
    name: "search_items",
    description: "Search items.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "get_item",
    description: "Get one item.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
];

const transcript: Transcript = {
  finalText: "Here is the answer.",
  estimated: false,
  durationMs: 1234,
  toolDefs,
  turns: [
    {
      userPrompt: "find stuff",
      assistantText: "Let me look.",
      usage: { inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 50 },
      toolCalls: [
        { name: "search_items", args: { q: "x" }, result: "r1", isError: false },
        { name: "search_items", args: { q: "y" }, result: "r2", isError: false },
        { name: "get_item", args: { id: 5 }, result: "boom", isError: true },
        { name: "get_item", args: {}, result: "r4", isError: false },
        { name: "delete_all", args: {}, result: "no such tool", isError: true },
      ],
    },
  ],
};

describe("extractSignals", () => {
  const s = extractSignals(transcript);
  it("counts billable tokens (input+cacheCreation+output, excludes cacheRead)", () => {
    expect(s.totalTokens).toBe(1200);
    expect(s.cacheReadTokens).toBe(50);
  });
  it("counts tool calls, discovery, and refetch", () => {
    expect(s.toolCalls).toBe(5);
    expect(s.discoveryRoundtrips).toBe(2); // search_items x2
    expect(s.refetchRoundtrips).toBe(2); // 2nd search_items + 2nd get_item
    expect(s.turns).toBe(1);
  });
});

describe("decompose", () => {
  const d = decompose(transcript, 4);
  it("byte buckets sum to total", () => {
    expect(d.bytes.toolDef + d.bytes.toolArg + d.bytes.toolResult + d.bytes.reasoning).toBe(d.bytes.total);
    expect(d.bytes.toolDef).toBeGreaterThan(0);
    expect(d.bytes.reasoning).toBe(Buffer.byteLength("Let me look.", "utf8"));
  });
  it("computes billable + floor honestly", () => {
    expect(d.usage.billableTotal).toBe(1200);
    expect(d.usage.cacheReadTokens).toBe(50);
    expect(d.usage.floorTokens).toBeCloseTo(1200 - d.usage.attributedTokens, 6);
    expect(d.usage.attributableShare).toBeGreaterThan(0);
    expect(d.usage.attributableShare).toBeLessThanOrEqual(1);
  });
  it("shares sum to ~1", () => {
    const sum = d.shares.toolDef + d.shares.toolArg + d.shares.toolResult + d.shares.reasoning;
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("structuralFlags", () => {
  const f = structuralFlags(transcript, toolDefs);
  it("flags hallucinated, schema-violating, and erroring calls", () => {
    expect(f.hallucinatedToolCalls).toBe(1); // delete_all
    expect(f.schemaViolations).toBe(1); // get_item with missing required id
    expect(f.toolErrors).toBe(1); // get_item error (delete_all not counted: unknown tool)
    expect(f.recoveredFromError).toBe(true);
  });
});

describe("percentile helpers", () => {
  it("matches linear-interpolation percentiles", () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 6);
    expect(percentile([10, 20, 30, 40], 90)).toBeCloseTo(37, 6);
    expect(iqr([1, 2, 3, 4, 5])).toBeCloseTo(2, 6);
  });
});
