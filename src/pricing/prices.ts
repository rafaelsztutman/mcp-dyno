/**
 * Per-model token prices in USD per 1M tokens. User-overridable via dyno.config.
 * Dated so we can track drift — update when Anthropic changes pricing.
 *
 * NOTE: verify these against current Anthropic pricing before relying on $/task;
 * they are placeholders pending confirmation.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-write tokens. */
  cacheWrite: number;
  /** USD per 1M cache-read tokens. */
  cacheRead: number;
}

export const PRICES_AS_OF = "2026-06-02";

/**
 * Keys are BARE model ids (provider prefix already stripped by resolveModel). The
 * OpenAI/Google entries are approximate placeholders — verify before relying on
 * $/task, and override per-run via dyno.config `prices`. `cacheWrite` is unused for
 * OpenAI-style auto-caching (we report 0 cache-creation tokens); `cacheRead` is the
 * cached-input rate.
 */
export const PRICE_TABLE: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-8": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  // OpenAI (approximate)
  "gpt-4o": { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 },
  "gpt-4.1": { input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheWrite: 0.4, cacheRead: 0.1 },
  // Google Gemini (approximate)
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.3125 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cacheWrite: 0.1, cacheRead: 0.025 },
};

export function priceFor(model: string, overrides?: Record<string, ModelPrice>): ModelPrice | undefined {
  return overrides?.[model] ?? PRICE_TABLE[model];
}

/** Cost in USD for one attempt's token usage. */
export function costUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
  overrides?: Record<string, ModelPrice>,
): number | undefined {
  const p = priceFor(model, overrides);
  if (!p) return undefined;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreationTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}
