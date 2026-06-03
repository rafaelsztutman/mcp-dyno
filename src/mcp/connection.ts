import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport as McpTransport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerSpec, ToolDef } from "../types.js";

export interface ToolCallOutcome {
  /** Flattened text of the result content blocks. */
  text: string;
  isError: boolean;
  durationMs: number;
  /** Non-text content block types encountered (image/audio/resource). */
  nonTextTypes: string[];
}

/** Driver-agnostic handle on a running MCP server under test. */
export interface McpConnection {
  readonly label: string;
  connect(): Promise<void>;
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

/** Minimal shell-style tokenizer for stdio command strings (handles ' and "). */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

function buildTransport(spec: ServerSpec): McpTransport {
  if (spec.transport === "stdio") {
    const [command, ...args] = tokenizeCommand(spec.target);
    if (!command) throw new Error(`Empty stdio command: "${spec.target}"`);
    return new StdioClientTransport({
      command,
      args,
      env: { ...getDefaultEnvironment(), ...(spec.env ?? {}) },
      stderr: "pipe",
    });
  }
  const url = new URL(spec.target);
  const requestInit = spec.headers ? { headers: spec.headers } : undefined;
  if (spec.transport === "sse") {
    return new SSEClientTransport(url, { requestInit });
  }
  return new StreamableHTTPClientTransport(url, { requestInit });
}

class SdkConnection implements McpConnection {
  readonly label: string;
  private client: Client;
  private transport: McpTransport;

  constructor(private spec: ServerSpec) {
    this.label = spec.label ?? spec.target;
    this.client = new Client({ name: "mcp-dyno", version: "0.1.0" });
    this.transport = buildTransport(spec);
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<ToolDef[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: unknown): Promise<ToolCallOutcome> {
    const start = performance.now();
    const res = await this.client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
    const durationMs = performance.now() - start;

    const blocks = Array.isArray(res.content) ? res.content : [];
    const textParts: string[] = [];
    const nonTextTypes: string[] = [];
    for (const b of blocks as Array<{ type: string; text?: string }>) {
      if (b.type === "text" && typeof b.text === "string") textParts.push(b.text);
      else nonTextTypes.push(b.type);
    }
    return {
      text: textParts.join("\n"),
      isError: res.isError === true,
      durationMs,
      nonTextTypes,
    };
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {});
  }
}

export function createConnection(spec: ServerSpec): McpConnection {
  return new SdkConnection(spec);
}
