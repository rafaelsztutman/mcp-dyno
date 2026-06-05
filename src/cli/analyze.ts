import pc from "picocolors";
import { buildServerSpec, posInt } from "./options.js";
import { DEFAULTS } from "../config.js";
import { loadConfig, specFromBlock } from "../config-file.js";
import type { AuthMode } from "../types.js";
import { resolve } from "node:path";
import { loadTasks } from "../workload/load.js";
import { resolveCorpus } from "../workload/corpus.js";
import { generateTasks, saveTasks } from "../workload/generate.js";
import { runServer, listServerTools, type ProgressEvent } from "../run/runner.js";
import type { Task, ToolDef } from "../types.js";
import { aggregateServer } from "../run/aggregate.js";
import { printServerSummary } from "../report/terminal.js";
import { makeRunId, writeRunArtifacts } from "../report/json.js";

export interface AnalyzeOpts {
  server?: string;
  config?: string;
  transport?: string;
  header?: string[];
  env?: string[];
  auth?: string;
  model?: string;
  judgeModel?: string;
  epochs?: string;
  concurrency?: string;
  tasks?: string;
  out?: string;
  [k: string]: unknown;
}

export function progressLogger(): (e: ProgressEvent) => void {
  return (e) => {
    if (e.kind === "tools") process.stdout.write(pc.dim(`  discovered ${e.count} tools\n  running `));
    else process.stdout.write(e.failed ? pc.red("x") : pc.green("."));
  };
}

export async function runAnalyze(opts: AnalyzeOpts): Promise<void> {
  const config = await loadConfig(opts.config as string | undefined);
  const server = opts.server
    ? buildServerSpec(opts.server, opts, "subject")
    : config.server
      ? specFromBlock(config.server, "subject")
      : (() => {
          throw new Error("no server given — pass --server or set `server` in dyno.config.json");
        })();
  const epochs = posInt(opts.epochs ?? config.epochs ?? DEFAULTS.epochs, "epochs");
  const concurrency = posInt(opts.concurrency ?? config.concurrency ?? DEFAULTS.concurrency, "concurrency");
  const auth = (opts.auth ?? config.auth ?? DEFAULTS.auth) as AuthMode;
  const model = opts.model ?? config.model ?? DEFAULTS.driverModel;
  const judgeModel = opts.judgeModel ?? config.judgeModel ?? DEFAULTS.judgeModel;
  const judge = Boolean(opts.judge || config.judge);
  const corpusSel = opts.corpus as string | undefined;
  const tasksPath = (opts.tasks as string | undefined) ?? config.tasks;

  let tasks: Task[];
  let preTools: ToolDef[] | undefined;
  let tasksSource: string;
  if (tasksPath) {
    tasks = await loadTasks(tasksPath);
    tasksSource = `from ${tasksPath}`;
  } else if (corpusSel) {
    const file = resolveCorpus(corpusSel);
    tasks = await loadTasks(file);
    tasksSource = `corpus ${corpusSel}`;
  } else {
    process.stdout.write(pc.dim("\n  no --tasks given — auto-generating a starter suite from the tool surface...\n"));
    preTools = await listServerTools(server);
    tasks = await generateTasks(preTools, { count: DEFAULTS.autoTaskCount, model, auth });
    const genPath = resolve(process.cwd(), "dyno-tasks.generated.yaml");
    await saveTasks(genPath, tasks);
    process.stdout.write(pc.dim(`  generated ${tasks.length} tasks → ${genPath} (review/edit and re-run with --tasks)\n`));
    tasksSource = "auto-generated";
  }

  console.log(pc.bold("\nmcp-dyno analyze"));
  console.log(`  server   ${server.target} ${pc.dim(`(${server.transport})`)}`);
  console.log(`  tasks    ${tasks.length} ${tasksSource}`);
  console.log(`  model    ${model} ${pc.dim(`· auth=${auth} · epochs=${epochs}${judge ? " · judge on" : ""}`)}\n`);

  const { tools, attempts } = await runServer(
    {
      server,
      tasks,
      tools: preTools,
      epochs,
      model,
      auth,
      concurrency,
      bytesPerToken: DEFAULTS.bytesPerToken,
      priceOverrides: config.prices,
      skipPermissions: Boolean(opts.skipPermissions),
      judge,
      judgeModel,
    },
    progressLogger(),
  );
  process.stdout.write("\n");

  const summary = aggregateServer(server.label ?? server.target, epochs, attempts);
  printServerSummary(summary);

  const out = opts.out ?? DEFAULTS.outDir;
  const runId = makeRunId();
  const path = await writeRunArtifacts(out, runId, {
    kind: "analyze",
    runId,
    server: { ...server, env: undefined, headers: undefined },
    model,
    judgeModel: judge ? judgeModel : undefined,
    auth,
    epochs,
    toolCount: tools.length,
    // Persisted so `dyno judge` can re-score this run's transcripts without re-driving.
    tasks,
    summary,
    attempts,
  });
  console.log(pc.dim(`\n  artifacts → ${path}`));
}
