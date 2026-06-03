import type { TokenUsage, ToolCall } from "../types.js";

/**
 * Parser for the Claude CLI `--output-format stream-json` event stream.
 * Parses the Claude CLI's stream-json events into per-turn transcripts.
 *
 * In multi-turn (`--input-format stream-json --replay-user-messages`) mode the
 * CLI emits one `result` event PER user turn, each carrying that turn's
 * authoritative usage. We segment on `result` events so per-turn usage and
 * tool-call attribution are exact (rather than summing message-level usage,
 * which is reported at message granularity and would double-count tool loops).
 */

export interface ParsedTurn {
  userPrompt: string;
  assistantText: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

export interface ParsedSession {
  turns: ParsedTurn[];
  finalText: string;
  costUsd?: number;
  durationMs: number;
  isError: boolean;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as ContentBlock).text ?? "") : ""))
      .join("\n");
  }
  return "";
}

function stripPrefix(name: string, serverName: string): string {
  const prefix = `mcp__${serverName}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function isToolResultContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((b) => (b as ContentBlock)?.type === "tool_result");
}

export function parseStreamJson(raw: string, serverName: string): ParsedSession {
  const turns: ParsedTurn[] = [];
  let finalText = "";
  let costUsd: number | undefined;
  let durationMs = 0;
  let isError = false;

  // per-turn accumulators
  let curUserPrompt = "";
  let curText: string[] = [];
  const curToolUses = new Map<string, { name: string; input: unknown }>();
  const curResolved = new Set<string>();
  let curToolCalls: ToolCall[] = [];

  const resetTurn = () => {
    curUserPrompt = "";
    curText = [];
    curToolUses.clear();
    curResolved.clear();
    curToolCalls = [];
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = e.type as string;
    const msg = (e.message ?? {}) as { content?: ContentBlock[] | string };

    if (type === "user") {
      if (isToolResultContent(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === "tool_result" && block.tool_use_id) {
            const tu = curToolUses.get(block.tool_use_id);
            curResolved.add(block.tool_use_id);
            curToolCalls.push({
              name: tu?.name ?? "unknown",
              args: tu?.input,
              result: blockText(block.content),
              isError: block.is_error === true,
            });
          }
        }
      } else {
        // replayed user text — marks the prompt for the in-progress turn
        curUserPrompt = blockText(msg.content);
      }
    } else if (type === "assistant") {
      for (const block of (msg.content as ContentBlock[]) ?? []) {
        if (block.type === "text" && block.text) curText.push(block.text);
        else if (block.type === "tool_use" && block.id && block.name) {
          curToolUses.set(block.id, { name: stripPrefix(block.name, serverName), input: block.input });
        }
      }
    } else if (type === "result") {
      const u = (e.usage ?? {}) as Record<string, number>;
      // any tool_use without a tool_result (e.g. last action) still counts
      for (const [id, tu] of curToolUses) {
        if (!curResolved.has(id)) curToolCalls.push({ name: tu.name, args: tu.input, result: "", isError: false });
      }
      turns.push({
        userPrompt: curUserPrompt,
        assistantText: curText.join("\n"),
        toolCalls: curToolCalls,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
        },
      });
      finalText = (e.result as string) ?? finalText;
      if (typeof e.total_cost_usd === "number") costUsd = (costUsd ?? 0) + e.total_cost_usd;
      if (typeof e.duration_ms === "number") durationMs += e.duration_ms;
      if (e.is_error === true) isError = true;
      resetTurn();
    }
  }

  return { turns, finalText, costUsd, durationMs, isError };
}
