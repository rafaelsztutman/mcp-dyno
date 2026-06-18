#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";
import { runInit } from "./init.js";
import { runAnalyze } from "./analyze.js";
import { runCompare } from "./compare.js";
import { runView } from "./view.js";
import { runJudge } from "./judge.js";
import { runAssert } from "./assert.js";
import { runScorecard } from "./scorecard.js";

const program = new Command();

program
  .name("dyno")
  .description("Put your MCP server on the dyno — holistic, LLM-driven MCP analysis.")
  .version("0.2.1");

function transportOption(cmd: Command): Command {
  return cmd
    .option("--transport <kind>", "MCP transport: stdio | sse | http", "stdio")
    .option("--header <k:v...>", "HTTP/SSE header (repeatable)")
    .option("--env <k=v...>", "env var for stdio child (repeatable)")
    .option("--auth <mode>", `Anthropic auth: api (key) | cli (subscription) [${DEFAULTS.auth}]`)
    .option("--model <id>", `driver model: "<provider>/<id>" (openai/, google/, openrouter/…) or bare Claude id [${DEFAULTS.driverModel}]`)
    .option("--judge-model <id>", `judge model (cross-family ok, e.g. openai/gpt-4o) [${DEFAULTS.judgeModel}]`)
    .option("--epochs <n>", `repeats per task [${DEFAULTS.epochs}]`)
    .option("--concurrency <n>", `max concurrent attempts [${DEFAULTS.concurrency}]`)
    .option("--tasks <file>", "BYO task file (yaml/json); omit to auto-generate")
    .option("--corpus <archetype[@ver]>", "use a built-in task corpus (e.g. filesystem@1, fetch)")
    .option("--config <file>", "dyno.config.json with server blocks / defaults")
    .option("--judge", "score the correctness pillar with an LLM judge (extra model calls)", false)
    .option("--skip-permissions", "CLI auth only: bypass all permission gates (dangerous; default off)", false)
    .option("--out <dir>", "output directory", DEFAULTS.outDir);
}

transportOption(
  program
    .command("analyze")
    .description("Run a holistic analysis of a single MCP server.")
    .option("--server <target>", "stdio command or sse/http URL (or set in --config)")
    .option("--label <name>", "label for this server/run (shown in the dashboard & matrix)"),
).action(async (opts) => {
  await runAnalyze(opts).catch(fail);
});

transportOption(
  program
    .command("compare")
    .description("Compare two server variants (before/after) with paired statistics.")
    .option("--base <target>", "baseline server (stdio command or url; or set in --config)")
    .option("--head <target>", "candidate server (stdio command or url; or set in --config)")
    .option("--fail-on-regression", "exit non-zero if a metric regresses resolvably (for CI)", false)
    .option("--summary-md <file>", "write a markdown summary (e.g. $GITHUB_STEP_SUMMARY)"),
).action(async (opts) => {
  await runCompare(opts).catch(fail);
});

program
  .command("init")
  .description("Scaffold a dyno.config.json and a sample task file.")
  .option("--force", "overwrite existing files")
  .action(async (opts) => {
    await runInit(opts).catch(fail);
  });

program
  .command("judge")
  .description("Re-score a saved run's transcripts with a (possibly different) judge — no re-driving.")
  .option("--run <id|dir|file>", "run id under --out, a run dir, or a path to results.json")
  .option("--judge-model <id>", `judge model (cross-family ok, e.g. openai/gpt-4o) [${DEFAULTS.judgeModel}]`)
  .option("--judge-models <list>", "comma-separated judges for an ensemble + agreement (e.g. claude-opus-4-8,openai/gpt-4o)")
  .option("--tasks <file>", "criteria source if the run has none persisted (matched by task id)")
  .option("--auth <mode>", `Anthropic auth for the judge: api | cli [${DEFAULTS.auth}]`)
  .option("--concurrency <n>", `max concurrent judge calls [${DEFAULTS.concurrency}]`)
  .option("--out <dir>", "results directory", DEFAULTS.outDir)
  .action(async (opts) => {
    await runJudge(opts).catch(fail);
  });

program
  .command("assert")
  .description("Check a run against budget thresholds; non-zero exit on any breach (for CI).")
  .option("--run <id|dir|file>", "run to check (defaults to the most recent in --out)")
  .option("--budgets <file>", "JSON budgets file (else uses `budgets` in dyno.config.json)")
  .option("--config <file>", "dyno.config.json holding a `budgets` block")
  .option("--summary-md <file>", "write a markdown summary (e.g. $GITHUB_STEP_SUMMARY)")
  .option("--out <dir>", "results directory", DEFAULTS.outDir)
  .action(async (opts) => {
    await runAssert(opts).catch(fail);
  });

program
  .command("scorecard")
  .description("Per-pillar letter grades + a committable badge for a run.")
  .option("--run <id|dir|file>", "run to score (defaults to the most recent in --out)")
  .option("--badge <file>", "write a shields.io endpoint-badge JSON")
  .option("--out <dir>", "results directory", DEFAULTS.outDir)
  .action(async (opts) => {
    await runScorecard(opts).catch(fail);
  });

program
  .command("view")
  .description("Open the local dashboard to explore runs.")
  .option("--out <dir>", "results directory", DEFAULTS.outDir)
  .option("--port <n>", "port", "4000")
  .action(async (opts) => {
    await runView(opts).catch(fail);
  });

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(pc.red(`\n✖ ${msg}`));
  process.exit(1);
}

program.parseAsync();
