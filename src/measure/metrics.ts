import type { EfficiencySignals, Transcript } from "../types.js";
import { billableTokens } from "../config.js";

/**
 * Heuristic classifier for "discovery" tool calls — exploratory lookups (search,
 * list, describe, schema introspection) as opposed to action calls. A generic
 * name-based heuristic; overridable later via config.
 */
const DISCOVERY_RE = /(search|list|find|discover|describe|lookup|read[_-]?doc|schema|introspect|catalog)/i;

export function isDiscoveryTool(name: string): boolean {
  return DISCOVERY_RE.test(name);
}

/** Headline efficiency signals for one attempt (port of decompose.extract_efficiency). */
export function extractSignals(transcript: Transcript): EfficiencySignals {
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let toolCalls = 0;
  let discoveryRoundtrips = 0;
  let refetchRoundtrips = 0;

  for (const turn of transcript.turns) {
    totalTokens += billableTokens({
      inputTokens: turn.usage.inputTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      outputTokens: turn.usage.outputTokens,
    });
    cacheReadTokens += turn.usage.cacheReadTokens;
    toolCalls += turn.toolCalls.length;

    // refetch = repeated calls to a tool already used earlier in the same turn
    // (signals inspect-then-refetch loops).
    const seen = new Set<string>();
    for (const call of turn.toolCalls) {
      if (isDiscoveryTool(call.name)) discoveryRoundtrips++;
      if (seen.has(call.name)) refetchRoundtrips++;
      else seen.add(call.name);
    }
  }

  return {
    totalTokens,
    cacheReadTokens,
    durationMs: transcript.durationMs,
    toolCalls,
    discoveryRoundtrips,
    refetchRoundtrips,
    turns: transcript.turns.length,
  };
}

// --- aggregation helpers (percentiles) ---

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export const median = (v: number[]): number => percentile(v, 50);
export const p90 = (v: number[]): number => percentile(v, 90);
export const iqr = (v: number[]): number => percentile(v, 75) - percentile(v, 25);
export const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** Cost-of-pass: total tokens spent across attempts per one passing attempt. */
export function costOfPass(totalsPerAttempt: number[], passes: number): number {
  const spent = totalsPerAttempt.reduce((a, b) => a + b, 0);
  return passes > 0 ? spent / passes : Infinity;
}
