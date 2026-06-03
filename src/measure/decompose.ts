import type { Channel, Decomposition, Transcript } from "../types.js";
import { billableTokens } from "../config.js";

/**
 * 4-channel context-bloat decomposition. Byte buckets are EXACT (measured). Per-channel *token*
 * numbers are estimates at a fixed bytes/token tariff — we deliberately do NOT
 * scale them to sum to billable. The unexplained remainder surfaces as
 * `floorTokens` (system prompt + scaffolding not attributable to the MCP), and
 * `attributableShare` is how much of billable the MCP surface can actually touch.
 *
 * Channels:
 *   toolDef    — the tool definitions sent to the model (name + description + schema)
 *   toolArg    — arguments the model emitted on tool calls (output bytes)
 *   toolResult — content the server returned (input/cache-creation bytes next turn)
 *   reasoning  — assistant prose / chain-of-thought (output bytes)
 */
function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function jsonBytes(v: unknown): number {
  try {
    return bytes(JSON.stringify(v) ?? "");
  } catch {
    return 0;
  }
}

export function decompose(transcript: Transcript, bytesPerToken: number): Decomposition {
  const b: Record<Channel, number> = { toolDef: 0, toolArg: 0, toolResult: 0, reasoning: 0 };

  // Tool definitions are sent once and amortized; attribute the full surface once.
  for (const t of transcript.toolDefs) {
    b.toolDef += bytes(t.name) + bytes(t.description ?? "") + jsonBytes(t.inputSchema);
  }

  let billableTotal = 0;
  let cacheReadTokens = 0;
  for (const turn of transcript.turns) {
    b.reasoning += bytes(turn.assistantText);
    for (const call of turn.toolCalls) {
      b.toolArg += jsonBytes(call.args);
      b.toolResult += bytes(call.result ?? "");
    }
    billableTotal += billableTokens({
      inputTokens: turn.usage.inputTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      outputTokens: turn.usage.outputTokens,
    });
    cacheReadTokens += turn.usage.cacheReadTokens;
  }

  const total = b.toolDef + b.toolArg + b.toolResult + b.reasoning;
  const tokensEst: Record<Channel, number> = {
    toolDef: b.toolDef / bytesPerToken,
    toolArg: b.toolArg / bytesPerToken,
    toolResult: b.toolResult / bytesPerToken,
    reasoning: b.reasoning / bytesPerToken,
  };
  const shares: Record<Channel, number> = {
    toolDef: total ? b.toolDef / total : 0,
    toolArg: total ? b.toolArg / total : 0,
    toolResult: total ? b.toolResult / total : 0,
    reasoning: total ? b.reasoning / total : 0,
  };
  const attributedTokens =
    tokensEst.toolDef + tokensEst.toolArg + tokensEst.toolResult + tokensEst.reasoning;
  const floorTokens = Math.max(0, billableTotal - attributedTokens);

  return {
    bytes: { ...b, total },
    shares,
    tokensEst,
    usage: {
      billableTotal,
      cacheReadTokens,
      cacheReadShare: billableTotal + cacheReadTokens > 0
        ? cacheReadTokens / (billableTotal + cacheReadTokens)
        : 0,
      attributedTokens,
      floorTokens,
      attributableShare: billableTotal ? Math.min(1, attributedTokens / billableTotal) : 0,
    },
    estimated: transcript.estimated,
  };
}
