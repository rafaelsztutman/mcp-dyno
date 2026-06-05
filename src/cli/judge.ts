import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import pc from "picocolors";
import { DEFAULTS, DEFAULT_JUDGE_MODEL } from "../config.js";
import type { AttemptResult, AuthMode, Task } from "../types.js";
import { judgeAttempt, judgeEnsemble } from "../score/judge.js";
import { aggregateServer } from "../run/aggregate.js";
import { runPool } from "../run/runner.js";
import { printServerSummary } from "../report/terminal.js";
import { loadTasks } from "../workload/load.js";
import { makeRunId, writeRunArtifacts } from "../report/json.js";

export interface JudgeOpts {
  run?: string;
  out?: string;
  judgeModel?: string;
  judgeModels?: string;
  tasks?: string;
  auth?: string;
  concurrency?: string;
}

/** Resolve --run (a run id, a run dir, or a path to results.json) to the artifact file. */
function resolveRunFile(run: string, outDir: string): string {
  const candidates = [
    run.endsWith("results.json") ? run : null,
    join(run, "results.json"),
    join(outDir, run, "results.json"),
  ].filter((c): c is string => c !== null);
  for (const c of candidates) {
    const abs = isAbsolute(c) ? c : resolve(process.cwd(), c);
    if (existsSync(abs)) return abs;
  }
  throw new Error(`could not find results.json for --run "${run}" (looked under ${outDir}/ and as a path)`);
}

function toolSummaryOf(attempt: AttemptResult): string {
  return (attempt.log?.turns ?? [])
    .flatMap((t) => t.toolCalls)
    .map((c) => `${c.name}${c.isError ? " (error)" : ""}`)
    .join(", ");
}

/** Re-grade an existing run's stored transcripts with a (possibly different) judge — no re-driving. */
export async function runJudge(opts: JudgeOpts): Promise<void> {
  if (!opts.run) throw new Error("pass --run <runId|dir|results.json>");
  const outDir = opts.out ?? DEFAULTS.outDir;
  const models = (opts.judgeModels ? opts.judgeModels.split(",").map((m) => m.trim()).filter(Boolean) : [opts.judgeModel ?? DEFAULT_JUDGE_MODEL]);
  const judgeLabel = models.length > 1 ? `ensemble(${models.join(", ")})` : models[0]!;
  const auth = (opts.auth ?? DEFAULTS.auth) as AuthMode;
  const concurrency = Number(opts.concurrency ?? DEFAULTS.concurrency);

  const file = resolveRunFile(opts.run, outDir);
  const data = JSON.parse(await readFile(file, "utf8"));
  if (data.kind !== "analyze") {
    throw new Error(`dyno judge re-scores analyze runs; this run is "${data.kind}". Re-run the variants instead.`);
  }
  const attempts: AttemptResult[] = data.attempts ?? [];
  if (!attempts.length) throw new Error("run has no stored attempts to re-score");

  // Criteria come from the run's persisted tasks, or an explicit --tasks override.
  const taskList: Task[] = opts.tasks ? await loadTasks(opts.tasks) : (data.tasks ?? []);
  const byId = new Map(taskList.map((t) => [t.id, t]));
  if (!byId.size) {
    throw new Error("no task criteria available — this run predates task persistence; pass --tasks <file>");
  }

  const label = data.summary?.label ?? data.server?.label ?? "run";
  const beforeScore = data.summary?.correctness?.scoreMean ?? null;

  console.log(pc.bold("\nmcp-dyno judge"));
  console.log(`  run      ${file}`);
  console.log(`  judge    ${judgeLabel} ${pc.dim(`· auth=${auth} · re-scoring ${attempts.length} attempts`)}\n  `);

  const agreements: Array<{ taskId: string; epoch: number; agreement: number }> = [];
  await runPool(attempts, concurrency, async (attempt) => {
    const task = byId.get(attempt.taskId);
    if (attempt.failed || !task || !task.criteria.length) {
      process.stdout.write(pc.dim("·"));
      return;
    }
    const finalAnswer = attempt.log?.finalText ?? "";
    const toolSummary = toolSummaryOf(attempt);
    if (models.length > 1) {
      const eo = await judgeEnsemble(task, finalAnswer, { models, auth, toolSummary });
      attempt.judge = eo.verdicts;
      attempt.score = eo.score;
      if (eo.agreement != null) agreements.push({ taskId: attempt.taskId, epoch: attempt.epoch, agreement: eo.agreement });
    } else {
      const jo = await judgeAttempt(task, finalAnswer, { model: models[0]!, auth, toolSummary }).catch(() => ({ verdicts: [], score: null }));
      attempt.judge = jo.verdicts;
      attempt.score = jo.score;
    }
    process.stdout.write(pc.green("."));
  });
  process.stdout.write("\n");

  if (models.length > 1 && agreements.length) {
    const meanAgree = agreements.reduce((s, a) => s + a.agreement, 0) / agreements.length;
    const low = agreements.filter((a) => a.agreement < 0.7).map((a) => `${a.taskId}#${a.epoch}`);
    console.log(`  judge agreement ${pc.bold((meanAgree * 100).toFixed(0) + "%")} ${pc.dim(`across ${models.length} judges`)}`);
    if (low.length) console.log(pc.yellow(`  low agreement (<70%): ${low.join(", ")}`) + pc.dim("  — inspect these transcripts"));
  }

  const summary = aggregateServer(label, data.epochs ?? 1, attempts);
  printServerSummary(summary);

  const afterScore = summary.correctness.scoreMean;
  const fp = (v: number | null): string => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);
  console.log(
    `\n  pass-rate ${pc.bold(fp(beforeScore))} ${pc.dim("(original)")} → ${pc.bold(fp(afterScore))} ${pc.dim(`(${judgeLabel})`)}`,
  );

  const runId = `${makeRunId()}-rejudged`;
  const path = await writeRunArtifacts(outDir, runId, {
    ...data,
    runId,
    judgeModel: judgeLabel,
    rejudgedFrom: data.runId,
    summary,
    attempts,
  });
  console.log(pc.dim(`\n  artifacts → ${path} (original left untouched)`));
}
