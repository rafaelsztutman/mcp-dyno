import type { AttemptResult, AuthMode, Decomposition, EfficiencySignals, ServerSpec, Task, ToolDef } from "../types.js";
import { createConnection } from "../mcp/connection.js";
import { ApiLoopDriver } from "../engine/api-loop-driver.js";
import { ClaudeCliDriver } from "../engine/claude-cli-driver.js";
import type { ModelDriver } from "../engine/driver.js";
import { decompose } from "../measure/decompose.js";
import { extractSignals } from "../measure/metrics.js";
import { structuralFlags } from "../score/structural.js";
import { judgeAttempt } from "../score/judge.js";
import { costUsd, type ModelPrice } from "../pricing/prices.js";
import { DEFAULT_JUDGE_MODEL } from "../config.js";
import type { AttemptLog, JudgeResult, Transcript } from "../types.js";

const LOG_CAP = 2000;
const cap = (s: string): string => (s.length > LOG_CAP ? s.slice(0, LOG_CAP) + " …[truncated]" : s);

function buildLog(t: Transcript): AttemptLog {
  return {
    finalText: cap(t.finalText ?? ""),
    turns: t.turns.map((turn) => ({
      userPrompt: turn.userPrompt,
      assistantText: cap(turn.assistantText ?? ""),
      toolCalls: turn.toolCalls.map((c) => ({
        name: c.name,
        args: c.args,
        result: cap(c.result ?? ""),
        isError: c.isError === true,
      })),
    })),
  };
}

export interface RunInput {
  server: ServerSpec;
  tasks: Task[];
  epochs: number;
  model: string;
  auth: AuthMode;
  concurrency: number;
  bytesPerToken: number;
  priceOverrides?: Record<string, ModelPrice>;
  /** CLI driver only: pass --dangerously-skip-permissions (opt-in, off by default). */
  skipPermissions?: boolean;
  /** Run the LLM judge for the correctness pillar (off by default). */
  judge?: boolean;
  judgeModel?: string;
  /** Pre-fetched tool surface; if omitted the runner probes the server once. */
  tools?: ToolDef[];
}

export interface RunOutput {
  tools: ToolDef[];
  attempts: AttemptResult[];
}

export type ProgressEvent =
  | { kind: "tools"; count: number }
  | { kind: "attempt"; taskId: string; epoch: number; failed: boolean; error?: string };

function makeDriver(auth: AuthMode, skipPermissions?: boolean): ModelDriver {
  return auth === "cli" ? new ClaudeCliDriver({ skipPermissions }) : new ApiLoopDriver();
}

function zeroSignals(): EfficiencySignals {
  return {
    totalTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
    toolCalls: 0,
    discoveryRoundtrips: 0,
    refetchRoundtrips: 0,
    turns: 0,
  };
}

function zeroDecomp(): Decomposition {
  const z = { toolDef: 0, toolArg: 0, toolResult: 0, reasoning: 0 };
  return {
    bytes: { ...z, total: 0 },
    shares: { ...z },
    tokensEst: { ...z },
    usage: {
      billableTotal: 0,
      cacheReadTokens: 0,
      cacheReadShare: 0,
      attributedTokens: 0,
      floorTokens: 0,
      attributableShare: 0,
    },
    estimated: true,
  };
}

/** Probe the server's tool surface once (free — no model calls). */
export async function listServerTools(server: ServerSpec): Promise<ToolDef[]> {
  const conn = createConnection(server);
  await conn.connect();
  try {
    return await conn.listTools();
  } finally {
    await conn.close();
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (idx < items.length) {
      const item = items[idx++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function runServer(input: RunInput, onProgress?: (e: ProgressEvent) => void): Promise<RunOutput> {
  const tools = input.tools ?? (await listServerTools(input.server));
  onProgress?.({ kind: "tools", count: tools.length });

  const driver = makeDriver(input.auth, input.skipPermissions);
  const jobs: Array<{ task: Task; epoch: number }> = [];
  for (const task of input.tasks) {
    for (let e = 1; e <= input.epochs; e++) jobs.push({ task, epoch: e });
  }

  const attempts: AttemptResult[] = [];
  await runPool(jobs, input.concurrency, async ({ task, epoch }) => {
    try {
      let transcript;
      if (input.auth === "api") {
        const conn = createConnection(input.server);
        await conn.connect();
        try {
          transcript = await driver.drive({ task, tools, conn, server: input.server, model: input.model });
        } finally {
          await conn.close();
        }
      } else {
        transcript = await driver.drive({ task, tools, server: input.server, model: input.model });
      }

      const decomposition = decompose(transcript, input.bytesPerToken);
      const totalsForCost = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      for (const t of transcript.turns) {
        totalsForCost.inputTokens += t.usage.inputTokens;
        totalsForCost.outputTokens += t.usage.outputTokens;
        totalsForCost.cacheCreationTokens += t.usage.cacheCreationTokens;
        totalsForCost.cacheReadTokens += t.usage.cacheReadTokens;
      }
      const cost = transcript.reportedCostUsd ?? costUsd(input.model, totalsForCost, input.priceOverrides);

      let judge: JudgeResult[] = [];
      let score: number | null = null;
      if (input.judge) {
        const toolSummary = transcript.turns
          .flatMap((t) => t.toolCalls)
          .map((c) => `${c.name}${c.isError ? " (error)" : ""}`)
          .join(", ");
        const jo = await judgeAttempt(task, transcript.finalText, {
          model: input.judgeModel ?? DEFAULT_JUDGE_MODEL,
          auth: input.auth,
          toolSummary,
        });
        judge = jo.verdicts;
        score = jo.score;
      }

      attempts.push({
        taskId: task.id,
        epoch,
        signals: extractSignals(transcript),
        decomposition,
        structural: structuralFlags(transcript, tools),
        judge,
        score,
        costUsd: cost,
        log: buildLog(transcript),
        failed: false,
      });
      onProgress?.({ kind: "attempt", taskId: task.id, epoch, failed: false });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      attempts.push({
        taskId: task.id,
        epoch,
        signals: zeroSignals(),
        decomposition: zeroDecomp(),
        structural: { hallucinatedToolCalls: 0, schemaViolations: 0, toolErrors: 0, recoveredFromError: false },
        judge: [],
        score: null,
        failed: true,
        error,
      });
      onProgress?.({ kind: "attempt", taskId: task.id, epoch, failed: true, error });
    }
  });

  // stable order: by task, then epoch
  attempts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.epoch - b.epoch);
  return { tools, attempts };
}
