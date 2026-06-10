/**
 * Minimal OpenAI-compatible Chat Completions client (fetch-based, no SDK dependency).
 * One client reaches OpenAI, OpenRouter, Google's OpenAI endpoint, Groq, Together,
 * and any local server speaking the same protocol — selected by ProviderConfig.
 */
import type { TokenUsage } from "../types.js";
import { apiKeyFor, baseUrlFor, type ProviderConfig } from "./providers.js";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface ChatResponse {
  message: { content: string | null; tool_calls?: ChatToolCall[] };
  finishReason: string | null;
  usage: ChatUsage;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Map an OpenAI-compatible usage block onto the billable-token convention. */
export function mapUsage(u: ChatUsage): TokenUsage {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const prompt = u.prompt_tokens ?? 0;
  return {
    // Non-cached prompt tokens are the real "input"; the cached portion is a read.
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: u.completion_tokens ?? 0,
    // OpenAI-style auto-caching has no separate cache-write billing line.
    cacheCreationTokens: 0,
    cacheReadTokens: cached,
  };
}

/** Ensure a tool's parameters are a valid JSON-Schema object (OpenAI requires `type`). */
export function normalizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  if (!("type" in schema)) return { type: "object", properties: {}, ...schema };
  return schema;
}

/** Parse a tool-call arguments string. Empty/malformed → {} but the raw text is preserved. */
export function parseToolArgs(argString: string | undefined): { args: Record<string, unknown>; raw?: string } {
  const s = (argString ?? "").trim();
  if (!s) return { args: {} };
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { args: parsed } : { args: {}, raw: s };
  } catch {
    return { args: {}, raw: s };
  }
}

export async function openaiChat(opts: {
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  maxTokens: number;
  maxRetries?: number;
}): Promise<ChatResponse> {
  const url = `${baseUrlFor(opts.provider)}/chat/completions`;
  const apiKey = apiKeyFor(opts.provider);
  const maxRetries = opts.maxRetries ?? 3;
  let tokenField = opts.provider.tokenField ?? "max_tokens";

  const buildBody = (): string => {
    const body: Record<string, unknown> = { model: opts.model, messages: opts.messages };
    body[tokenField] = opts.maxTokens;
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }
    return JSON.stringify(body);
  };

  let lastErrText = "";
  let flipTried = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: buildBody(),
      });
    } catch (err) {
      lastErrText = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err instanceof Error ? err : new Error(lastErrText);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastErrText = `${opts.provider.id} chat error ${res.status}: ${text.slice(0, 300)}`;
      // Provider disagreed on the token-limit field name — flip it ONCE and resend WITHOUT
      // consuming a retry (so the fallback still fires on the final attempt).
      if (res.status === 400 && !flipTried && /max_completion_tokens|max_tokens/.test(text)) {
        flipTried = true;
        tokenField = tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens";
        attempt--; // re-run this iteration with the flipped field
        continue;
      }
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(lastErrText);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: ChatToolCall[] }; finish_reason?: string }>;
      usage?: ChatUsage;
    };
    const choice = json.choices?.[0];
    if (!choice) throw new Error(`${opts.provider.id} returned no choices`);
    const msg = choice.message ?? {};
    return {
      message: {
        content: typeof msg.content === "string" ? msg.content : msg.content == null ? null : String(msg.content),
        tool_calls: Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : undefined,
      },
      finishReason: choice.finish_reason ?? null,
      usage: json.usage ?? {},
    };
  }
  throw new Error(lastErrText || `${opts.provider.id} request failed`);
}
