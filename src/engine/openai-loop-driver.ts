import type { ToolCall, TokenUsage, Transcript, TurnTranscript } from "../types.js";
import { DEFAULT_SYSTEM, taskTurns, type DriveOptions, type ModelDriver } from "./driver.js";
import type { ProviderConfig } from "./providers.js";
import {
  mapUsage,
  normalizeSchema,
  openaiChat,
  parseToolArgs,
  type ChatMessage,
  type ChatToolDef,
  type ChatUsage,
} from "./openai-chat.js";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 25;

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function addUsage(acc: TokenUsage, u: ChatUsage): void {
  const m = mapUsage(u);
  acc.inputTokens += m.inputTokens;
  acc.outputTokens += m.outputTokens;
  acc.cacheCreationTokens += m.cacheCreationTokens;
  acc.cacheReadTokens += m.cacheReadTokens;
}

/**
 * Provider-agnostic engine: our own agent loop over an OpenAI-compatible Chat
 * Completions endpoint. We build the tool list and execute every call through the
 * MCP connection, so usage is exact and tool-def/arg/result bytes are measured the
 * same way as the Anthropic API driver. Covers OpenAI, OpenRouter, Google, Groq,
 * Together, and local servers — selected by the ProviderConfig.
 */
export class OpenAiLoopDriver implements ModelDriver {
  readonly kind = "api" as const;
  readonly usesConnection = true;

  constructor(private provider: ProviderConfig) {}

  async drive(opts: DriveOptions): Promise<Transcript> {
    if (!opts.conn) throw new Error("OpenAiLoopDriver requires a live MCP connection");
    const conn = opts.conn;
    const start = performance.now();
    const system = opts.system ?? DEFAULT_SYSTEM;
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    const tools: ChatToolDef[] = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: normalizeSchema(t.inputSchema) },
    }));

    const messages: ChatMessage[] = [{ role: "system", content: system }];
    const turns: TurnTranscript[] = [];

    for (const userPrompt of taskTurns(opts.task)) {
      messages.push({ role: "user", content: userPrompt });
      const usage = zeroUsage();
      const assistantTexts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (let iter = 0; iter < maxIterations; iter++) {
        const resp = await openaiChat({
          provider: this.provider,
          model: opts.model,
          messages,
          tools,
          maxTokens,
        });
        addUsage(usage, resp.usage);
        if (resp.message.content) assistantTexts.push(resp.message.content);

        const calls = resp.message.tool_calls ?? [];
        // Echo the assistant turn back verbatim; tool_calls must be present so the
        // follow-up tool messages can be matched by id.
        messages.push({
          role: "assistant",
          content: resp.message.content ?? "",
          ...(calls.length ? { tool_calls: calls } : {}),
        });
        if (calls.length === 0) break;

        for (const call of calls) {
          const { args, raw } = parseToolArgs(call.function.arguments);
          const outcome = await conn.callTool(call.function.name, args).catch((err) => ({
            text: `Tool call threw: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
            durationMs: 0,
            nonTextTypes: [] as string[],
          }));
          toolCalls.push({
            name: call.function.name,
            args: raw ?? args,
            result: outcome.text,
            isError: outcome.isError,
            durationMs: outcome.durationMs,
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: outcome.text });
        }
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
