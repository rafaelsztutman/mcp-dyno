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

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
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
