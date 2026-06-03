import pc from "picocolors";
import { buildServerSpec, posInt } from "./options.js";
import { DEFAULTS } from "../config.js";
import { loadConfig, specFromBlock } from "../config-file.js";
import type { AuthMode, ServerSpec } from "../types.js";
import { resolve } from "node:path";
import { loadTasks } from "../workload/load.js";
import { generateTasks, saveTasks } from "../workload/generate.js";
import { runServer, listServerTools } from "../run/runner.js";
import type { Task } from "../types.js";
import { aggregateServer } from "../run/aggregate.js";
import { printServerSummary, printCompare } from "../report/terminal.js";
import { buildCompareRows } from "../run/compare.js";
import { progressLogger } from "./analyze.js";
import { makeRunId, writeRunArtifacts } from "../report/json.js";

export interface CompareOpts {
  base?: string;
  head?: string;
  config?: string;
  transport?: string;
  header?: string[];
  env?: string[];
  auth?: string;
  model?: string;
  judgeModel?: string;
  judge?: boolean;
  skipPermissions?: boolean;
  epochs?: string;
  concurrency?: string;
  tasks?: string;
  out?: string;
  [k: string]: unknown;
}

export async function runCompare(opts: CompareOpts): Promise<void> {
  const config = await loadConfig(opts.config as string | undefined);
  const resolveSpec = (flag: string | undefined, block: ServerSpec | undefined, label: string): ServerSpec => {
    if (flag) return buildServerSpec(flag, opts, label);
    if (block) return block;
    throw new Error(`no ${label} server — pass --${label} or set \`${label}\` in dyno.config.json`);
  };
  const base = resolveSpec(opts.base, config.base ? specFromBlock(config.base, "base") : undefined, "base");
  const head = resolveSpec(opts.head, config.head ? specFromBlock(config.head, "head") : undefined, "head");
  const epochs = posInt(opts.epochs ?? config.epochs ?? DEFAULTS.epochs, "epochs");
  const concurrency = posInt(opts.concurrency ?? config.concurrency ?? DEFAULTS.concurrency, "concurrency");
  const auth = (opts.auth ?? config.auth ?? DEFAULTS.auth) as AuthMode;
  const model = opts.model ?? config.model ?? DEFAULTS.driverModel;
  const judgeModel = opts.judgeModel ?? config.judgeModel ?? DEFAULTS.judgeModel;
  const judge = Boolean(opts.judge || config.judge);
  const tasksPath = (opts.tasks as string | undefined) ?? config.tasks;

  let tasks: Task[];
  if (tasksPath) {
    tasks = await loadTasks(tasksPath);
  } else {
    process.stdout.write(pc.dim("\n  no --tasks given — auto-generating a shared suite from the base server...\n"));
    const baseTools = await listServerTools(base);
    tasks = await generateTasks(baseTools, { count: DEFAULTS.autoTaskCount, model, auth });
    const genPath = resolve(process.cwd(), "dyno-tasks.generated.yaml");
    await saveTasks(genPath, tasks);
    process.stdout.write(pc.dim(`  generated ${tasks.length} tasks → ${genPath}\n`));
  }

  console.log(pc.bold("\nmcp-dyno compare"));
  console.log(`  base   ${base.target} ${pc.dim(`(${base.transport})`)}`);
  console.log(`  head   ${head.target} ${pc.dim(`(${head.transport})`)}`);
  console.log(`  tasks  ${tasks.length} ${tasksPath ? `from ${tasksPath}` : "auto-generated"} ${pc.dim(`· model=${model} · auth=${auth} · epochs=${epochs}${judge ? " · judge on" : ""}`)}`);

  const common = {
    tasks,
    epochs,
    model,
    auth,
    concurrency,
    bytesPerToken: DEFAULTS.bytesPerToken,
    priceOverrides: config.prices,
    skipPermissions: Boolean(opts.skipPermissions),
    judge,
    judgeModel,
  };

  console.log(pc.bold(`\n[base] ${base.label}`));
  const baseRun = await runServer({ ...common, server: base }, progressLogger());
  process.stdout.write("\n");
  console.log(pc.bold(`\n[head] ${head.label}`));
  const headRun = await runServer({ ...common, server: head }, progressLogger());
  process.stdout.write("\n");

  const baseSummary = aggregateServer(base.label ?? base.target, epochs, baseRun.attempts);
  const headSummary = aggregateServer(head.label ?? head.target, epochs, headRun.attempts);
  printServerSummary(baseSummary);
  printServerSummary(headSummary);

  const { rows, matched, skipped } = buildCompareRows(baseSummary, headSummary);
  if (rows.length === 0) {
    console.log(pc.yellow(`\n  Not enough matched tasks (${matched.length}) for paired stats — need ≥2.`));
  } else {
    printCompare(base.label ?? "base", head.label ?? "head", rows);
    if (skipped.length) console.log(pc.dim(`  skipped (insufficient data): ${skipped.join(", ")}`));
  }

  const out = opts.out ?? DEFAULTS.outDir;
  const runId = makeRunId();
  const path = await writeRunArtifacts(out, runId, {
    kind: "compare",
    runId,
    base: { ...base, env: undefined, headers: undefined },
    head: { ...head, env: undefined, headers: undefined },
    model,
    judgeModel: judge ? judgeModel : undefined,
    auth,
    epochs,
    matchedTasks: matched,
    baseSummary,
    headSummary,
    comparison: rows.map((r) => ({ metric: r.metric, base: r.base, head: r.head, ...r.result })),
    baseAttempts: baseRun.attempts,
    headAttempts: headRun.attempts,
  });
  console.log(pc.dim(`\n  artifacts → ${path}`));
}
