import type { McpConnection } from "../mcp/connection.js";
import type { ServerSpec, Task, ToolDef, Transcript } from "../types.js";

export interface DriveOptions {
  task: Task;
  /** Tool definitions advertised by the server (used by the API driver to build the tool list). */
  tools: ToolDef[];
  /** Live connection used by the API driver to execute tool calls (the CLI driver spawns its own). */
  conn?: McpConnection;
  /** Server spec (used by the CLI driver to configure Claude Code's own MCP connection). */
  server: ServerSpec;
  model: string;
  maxTokens?: number;
  system?: string;
  /** Safety cap on tool-use iterations within a single user turn. */
  maxIterations?: number;
}

/**
 * Drives an LLM through a task against an MCP server and returns a fully recorded
 * transcript. Two implementations: ApiLoopDriver (canonical, exact tokens) and
 * ClaudeCliDriver (subscription mode, decomposition estimated).
 */
export interface ModelDriver {
  readonly kind: "api" | "cli";
  drive(opts: DriveOptions): Promise<Transcript>;
}

/** The turns a task runs as (single prompt → one turn; multi-turn → many). */
export function taskTurns(task: Task): string[] {
  if (task.turns && task.turns.length > 0) return task.turns;
  if (task.prompt) return [task.prompt];
  throw new Error(`Task ${task.id} has neither prompt nor turns`);
}

export const DEFAULT_SYSTEM =
  "You are connected to an MCP server. Use its tools to accomplish the user's request accurately. " +
  "Prefer the provided tools over guessing. Be concise.";
