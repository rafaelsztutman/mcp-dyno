import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolUseBlock,
  ContentBlockParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { ToolCall, TokenUsage, Transcript, TurnTranscript } from "../types.js";
import { DEFAULT_SYSTEM, taskTurns, type DriveOptions, type ModelDriver } from "./driver.js";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 25;

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function addUsage(acc: TokenUsage, u: Usage): void {
  acc.inputTokens += u.input_tokens ?? 0;
  acc.outputTokens += u.output_tokens ?? 0;
  acc.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
  acc.cacheReadTokens += u.cache_read_input_tokens ?? 0;
}

/**
 * Canonical engine: our own agent loop over the Anthropic Messages API. We build
 * the tool list ourselves and execute every tool call through the MCP connection,
 * so token usage and tool-def/arg/result bytes are all measured exactly.
 */
export class ApiLoopDriver implements ModelDriver {
  readonly kind = "api" as const;
  private client: Anthropic;

  constructor(opts: { apiKey?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Provide an API key, or use --auth cli for subscription mode.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async drive(opts: DriveOptions): Promise<Transcript> {
    if (!opts.conn) throw new Error("ApiLoopDriver requires a live MCP connection");
    const conn = opts.conn;
    const start = performance.now();
    const system = opts.system ?? DEFAULT_SYSTEM;
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    const tools: Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Tool.InputSchema,
    }));

    const messages: MessageParam[] = [];
    const turns: TurnTranscript[] = [];

    for (const userPrompt of taskTurns(opts.task)) {
      messages.push({ role: "user", content: userPrompt });
      const usage = zeroUsage();
      const assistantTexts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (let iter = 0; iter < maxIterations; iter++) {
        const resp = await this.client.messages.create({
          model: opts.model,
          max_tokens: maxTokens,
          system,
          tools,
          messages,
        });
        addUsage(usage, resp.usage);

        for (const block of resp.content) {
          if (block.type === "text") assistantTexts.push(block.text);
        }
        messages.push({ role: "assistant", content: resp.content });

        const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

        const results: ContentBlockParam[] = [];
        for (const tu of toolUses) {
          const outcome = await conn.callTool(tu.name, tu.input).catch((err) => ({
            text: `Tool call threw: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
            durationMs: 0,
            nonTextTypes: [] as string[],
          }));
          toolCalls.push({
            name: tu.name,
            args: tu.input,
            result: outcome.text,
            isError: outcome.isError,
            durationMs: outcome.durationMs,
          });
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: outcome.text,
            is_error: outcome.isError,
          });
        }
        messages.push({ role: "user", content: results });
      }

      turns.push({ userPrompt, assistantText: assistantTexts.join("\n"), toolCalls, usage });
    }

    return {
      finalText: turns.at(-1)?.assistantText ?? "",
      turns,
      toolDefs: opts.tools,
      estimated: false,
      durationMs: performance.now() - start,
    };
  }
}
