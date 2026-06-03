import type { ServerSpec, Transcript } from "../types.js";
import { taskTurns, type DriveOptions, type ModelDriver } from "./driver.js";
import { tokenizeCommand } from "../mcp/connection.js";
import { parseStreamJson } from "./stream-json.js";
import { runClaudeTurns } from "./claude-process.js";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "sut";
}

/** Build a Claude Code --mcp-config object that connects only to the server under test. */
export function buildMcpConfig(serverName: string, spec: ServerSpec): { mcpServers: Record<string, unknown> } {
  let server: Record<string, unknown>;
  if (spec.transport === "stdio") {
    const [command, ...args] = tokenizeCommand(spec.target);
    server = { command, args, env: spec.env ?? {} };
  } else {
    server = { type: spec.transport, url: spec.target, headers: spec.headers ?? {} };
  }
  return { mcpServers: { [serverName]: server } };
}

/**
 * Subscription-mode driver: shells out to `claude -p` with the server under test
 * wired in via --strict-mcp-config. Token usage and tool/result bytes are read
 * from the stream-json output, but Claude Code's own large system prompt inflates
 * the billable floor, so decomposition is marked `estimated` (the floor is not
 * attributable to the MCP). No Anthropic API spend — billed to the subscription.
 */
export class ClaudeCliDriver implements ModelDriver {
  readonly kind = "cli" as const;

  constructor(private opts: { timeoutMs?: number; skipPermissions?: boolean } = {}) {}

  async drive(o: DriveOptions): Promise<Transcript> {
    const turns = taskTurns(o.task);
    const serverName = sanitizeName(o.server.label ?? "sut");
    const mcpConfig = JSON.stringify(buildMcpConfig(serverName, o.server));

    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--model",
      o.model,
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfig,
      // Pre-allow ONLY the server-under-test's tools; every other approval gate
      // stays intact. This is the safe default — no blanket permission bypass.
      "--allowedTools",
      `mcp__${serverName}__*`,
    ];
    if (this.opts.skipPermissions) args.push("--dangerously-skip-permissions");

    // Feed each user turn only after the prior turn's result arrives; one process
    // keeps the MCP server warm across turns (so server state persists) while
    // ensuring each message becomes its own turn.
    const raw = await runClaudeTurns(args, turns, { timeoutMs: this.opts.timeoutMs });
    const parsed = parseStreamJson(raw, serverName);

    return {
      finalText: parsed.finalText,
      turns: parsed.turns.map((t, i) => ({
        userPrompt: t.userPrompt || turns[i] || "",
        assistantText: t.assistantText,
        toolCalls: t.toolCalls,
        usage: t.usage,
      })),
      toolDefs: o.tools, // exact tool surface from a free listTools probe (runner supplies it)
      estimated: true,
      durationMs: parsed.durationMs,
      reportedCostUsd: parsed.costUsd,
    };
  }
}
