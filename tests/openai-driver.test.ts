import { describe, it, expect } from "vitest";
import { mapUsage, normalizeSchema, parseToolArgs } from "../src/engine/openai-chat.js";
import { resolveModel, KNOWN_PROVIDERS } from "../src/engine/providers.js";

describe("resolveModel", () => {
  it("treats a bare id as Anthropic (back-compat)", () => {
    const r = resolveModel("claude-sonnet-4-6");
    expect(r.provider.id).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("splits provider/model on the first slash only (OpenRouter nesting)", () => {
    const r = resolveModel("openrouter/anthropic/claude-3.5-sonnet");
    expect(r.provider.id).toBe("openrouter");
    expect(r.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("resolves an OpenAI model", () => {
    const r = resolveModel("openai/gpt-4o-mini");
    expect(r.provider.kind).toBe("openai-compat");
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("throws on an unknown provider prefix", () => {
    expect(() => resolveModel("acme/foo")).toThrow(/Unknown model provider/);
    expect(KNOWN_PROVIDERS).toContain("openai");
  });
});

describe("mapUsage → billable-token convention", () => {
  it("splits cached tokens out of input and into cache-read", () => {
    const m = mapUsage({ prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 300 } });
    expect(m.inputTokens).toBe(700); // 1000 prompt - 300 cached
    expect(m.cacheReadTokens).toBe(300);
    expect(m.outputTokens).toBe(200);
    expect(m.cacheCreationTokens).toBe(0); // no separate cache-write line for OpenAI-style caching
  });

  it("handles a usage block with no cache details", () => {
    const m = mapUsage({ prompt_tokens: 500, completion_tokens: 50 });
    expect(m.inputTokens).toBe(500);
    expect(m.cacheReadTokens).toBe(0);
  });

  it("never returns negative input", () => {
    const m = mapUsage({ prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 10 } });
    expect(m.inputTokens).toBe(0);
  });
});

describe("normalizeSchema", () => {
  it("defaults empty/missing schema to an object schema", () => {
    expect(normalizeSchema(undefined)).toEqual({ type: "object", properties: {} });
  });

  it("adds a missing type but keeps existing properties", () => {
    const out = normalizeSchema({ properties: { q: { type: "string" } } } as Record<string, unknown>);
    expect(out.type).toBe("object");
    expect(out.properties).toEqual({ q: { type: "string" } });
  });

  it("passes through a well-formed schema unchanged", () => {
    const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };
    expect(normalizeSchema(schema)).toBe(schema);
  });
});

describe("parseToolArgs", () => {
  it("returns {} for empty args", () => {
    expect(parseToolArgs("")).toEqual({ args: {} });
    expect(parseToolArgs(undefined)).toEqual({ args: {} });
  });

  it("parses valid JSON object args", () => {
    expect(parseToolArgs('{"q":"hi"}')).toEqual({ args: { q: "hi" } });
  });

  it("preserves raw text when args are malformed", () => {
    const r = parseToolArgs("{not json");
    expect(r.args).toEqual({});
    expect(r.raw).toBe("{not json");
  });

  it("treats a non-object JSON value as malformed (keeps raw)", () => {
    const r = parseToolArgs("42");
    expect(r.args).toEqual({});
    expect(r.raw).toBe("42");
  });
});
