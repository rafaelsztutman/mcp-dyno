import Anthropic from "@anthropic-ai/sdk";
import type { AuthMode } from "../types.js";
import { runClaude } from "./claude-process.js";
import { parseStreamJson } from "./stream-json.js";

/**
 * One-shot text completion with no tools/MCP, used by the judge and the task
 * generator. Mirrors the run's auth: CLI = `claude -p` (subscription, $0),
 * API = Anthropic Messages. Returns the model's final text.
 */
export interface CompleteOpts {
  model: string;
  auth: AuthMode;
  system: string;
  user: string;
  maxTokens?: number;
}

let apiClient: Anthropic | null = null;

export async function completeText(opts: CompleteOpts): Promise<string> {
  if (opts.auth === "cli") {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      opts.model,
      "--append-system-prompt",
      opts.system,
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ];
    const raw = await runClaude(args, opts.user);
    return parseStreamJson(raw, "none").finalText;
  }
  if (!apiClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set for API-mode completion");
    apiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  const resp = await apiClient.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
}

/** Extract the first balanced JSON object/array from possibly-fenced model text. */
export function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const start = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
