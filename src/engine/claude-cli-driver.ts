import type { ServerSpec, Transcript } from "../types.js";
import { taskTurns, type DriveOptions, type ModelDriver } from "./driver.js";
import { tokenizeCommand } from "../mcp/connection.js";
import { parseStreamJson } from "./stream-json.js";
import { runClaudeTurns } from "./claude-process.js";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "sut";
}

/**
 * Claude Code "bypass" built-ins: tools that let the model accomplish the task WITHOUT
 * the server under test (e.g. computing with Bash, reading files, fetching the web). We
 * --disallow these so the model is forced through the SUT's MCP tools. We deliberately do
 * NOT disallow ToolSearch: in current Claude Code, MCP tools are surfaced through it, so
 * blocking it blocks MCP access entirely.
 */
export const BYPASS_BUILTINS = [
  "Bash",
  "BashOutput",
  "KillBash",
  "KillShell",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "Task",
  "WebFetch",
  "WebSearch",
];

/**
 * The full set of Claude Code built-in / meta tools, used to FILTER them out of the recorded
 * transcript so SUT metrics (tool-call count, hallucination, ergonomics) reflect only the
 * server's own tools — not Claude Code scaffolding like ToolSearch. The API/OpenAI drivers
 * never see these, so filtering keeps all drivers measuring the same thing.
 */
export const CLAUDE_CODE_BUILTINS = new Set([
  ...BYPASS_BUILTINS,
  "AskUserQuestion",
  "CronCreate",
  "CronDelete",
  "CronList",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Monitor",
  "PushNotification",
  "RemoteTrigger",
  "ScheduleWakeup",
  "Skill",
  "SlashCommand",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "Workflow",
]);

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
  readonly usesConnection = false;

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
      // Block "bypass" built-ins so the model can't accomplish the task outside the SUT
      // (e.g. via Bash). ToolSearch is intentionally left enabled — MCP tools surface through it.
      "--disallowedTools",
      BYPASS_BUILTINS.join(","),
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
        // Drop Claude Code's own tool calls (ToolSearch, etc.) so metrics reflect only the SUT.
        toolCalls: t.toolCalls.filter((c) => !CLAUDE_CODE_BUILTINS.has(c.name)),
        usage: t.usage,
      })),
      toolDefs: o.tools, // exact tool surface from a free listTools probe (runner supplies it)
      estimated: true,
      durationMs: parsed.durationMs,
      reportedCostUsd: parsed.costUsd,
    };
  }
}
