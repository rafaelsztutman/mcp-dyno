import type { AuthMode } from "./types.js";

/**
 * Default Claude model ids (v1 is Claude-only; the ModelDriver interface keeps
 * the door open for other providers later).
 */
export const DEFAULT_DRIVER_MODEL = "claude-sonnet-4-6";

/**
 * The judge is intentionally a *different* model than the driver, to avoid the
 * self-enhancement bias. If the user
 * sets the driver to this same id, the CLI warns.
 */
export const DEFAULT_JUDGE_MODEL = "claude-opus-4-8";

export const DEFAULTS = {
  epochs: 5,
  concurrency: 4,
  auth: "api" as AuthMode,
  driverModel: DEFAULT_DRIVER_MODEL,
  judgeModel: DEFAULT_JUDGE_MODEL,
  /** Bytes-per-token tariff used for channel token estimates (calibratable). */
  bytesPerToken: 4,
  /** Number of auto-generated tasks when none are supplied. */
  autoTaskCount: 12,
  outDir: ".dyno",
};

/**
 * Server Ergonomics: a tool whose mean result payload exceeds this many (estimated)
 * tokens per call is flagged as "heavy" — a candidate for pagination / field-selection.
 */
export const DEFAULT_HEAVY_PAYLOAD_TOKENS = 1500;

/** "billable tokens" convention — single source of truth. */
export function billableTokens(u: {
  inputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}): number {
  return u.inputTokens + u.cacheCreationTokens + u.outputTokens;
}
