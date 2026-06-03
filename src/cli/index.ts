#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";
import { runInit } from "./init.js";
import { runAnalyze } from "./analyze.js";
import { runCompare } from "./compare.js";
import { runView } from "./view.js";

const program = new Command();

program
  .name("dyno")
  .description("Put your MCP server on the dyno — holistic, LLM-driven MCP analysis.")
  .version("0.1.0");

function transportOption(cmd: Command): Command {
  return cmd
    .option("--transport <kind>", "MCP transport: stdio | sse | http", "stdio")
    .option("--header <k:v...>", "HTTP/SSE header (repeatable)")
    .option("--env <k=v...>", "env var for stdio child (repeatable)")
    .option("--auth <mode>", `Claude auth: api (key) | cli (subscription) [${DEFAULTS.auth}]`)
    .option("--model <id>", `driver model id [${DEFAULTS.driverModel}]`)
    .option("--judge-model <id>", `judge model id [${DEFAULTS.judgeModel}]`)
    .option("--epochs <n>", `repeats per task [${DEFAULTS.epochs}]`)
    .option("--concurrency <n>", `max concurrent attempts [${DEFAULTS.concurrency}]`)
    .option("--tasks <file>", "BYO task file (yaml/json); omit to auto-generate")
    .option("--config <file>", "dyno.config.json with server blocks / defaults")
    .option("--judge", "score the correctness pillar with an LLM judge (extra model calls)", false)
    .option("--skip-permissions", "CLI auth only: bypass all permission gates (dangerous; default off)", false)
    .option("--out <dir>", "output directory", DEFAULTS.outDir);
}

transportOption(
  program
    .command("analyze")
    .description("Run a holistic analysis of a single MCP server.")
    .option("--server <target>", "stdio command or sse/http URL (or set in --config)"),
).action(async (opts) => {
  await runAnalyze(opts).catch(fail);
});

transportOption(
  program
    .command("compare")
    .description("Compare two server variants (before/after) with paired statistics.")
    .option("--base <target>", "baseline server (stdio command or url; or set in --config)")
    .option("--head <target>", "candidate server (stdio command or url; or set in --config)"),
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
