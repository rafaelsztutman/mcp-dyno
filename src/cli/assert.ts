import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";
import { loadConfig } from "../config-file.js";
import { evaluateBudgets, type Budgets, type BudgetCheck } from "../run/gate.js";
import type { ServerSummary } from "../run/aggregate.js";
import { budgetMarkdown } from "../report/markdown.js";

export interface AssertOpts {
  run?: string;
  budgets?: string;
  config?: string;
  out?: string;
  summaryMd?: string;
}

function summaryOf(data: any): ServerSummary | null {
  return data?.summary ?? data?.headSummary ?? data?.baseSummary ?? null;
}

/** Resolve --run (id | dir | results.json), or fall back to the most-recent run in outDir. */
async function resolveRunFile(run: string | undefined, outDir: string): Promise<string> {
  if (run) {
    const candidates = [run.endsWith("results.json") ? run : null, join(run, "results.json"), join(outDir, run, "results.json")].filter(
      (c): c is string => c !== null,
    );
    for (const c of candidates) {
      const abs = isAbsolute(c) ? c : resolve(process.cwd(), c);
      if (existsSync(abs)) return abs;
    }
    throw new Error(`could not find results.json for --run "${run}"`);
  }
  // newest run in outDir
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    throw new Error(`no runs found in ${outDir} — run \`dyno analyze\` first, or pass --run`);
  }
  let best: { file: string; mtime: number } | null = null;
  for (const id of entries) {
    const file = join(outDir, id, "results.json");
    try {
      const s = await stat(file);
      if (!best || s.mtimeMs > best.mtime) best = { file, mtime: s.mtimeMs };
    } catch {
      /* skip */
    }
  }
  if (!best) throw new Error(`no results.json found under ${outDir}`);
  return best.file;
}

function fmtCheck(c: BudgetCheck): string {
  const v = c.actual == null ? "n/a" : c.actual.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const line = `  ${c.pass ? pc.green("✓") : pc.red("✗")} ${c.name.padEnd(22)} ${c.comparator} ${c.limit}  ${pc.dim("actual " + v)}`;
  return c.pass ? line : pc.red(line);
}

/** Check a saved run's summary against budget thresholds; non-zero exit on any breach (for CI). */
export async function runAssert(opts: AssertOpts): Promise<void> {
  const outDir = opts.out ?? DEFAULTS.outDir;
  const config = await loadConfig(opts.config);
  const budgets: Budgets = opts.budgets
    ? (JSON.parse(await readFile(resolve(process.cwd(), opts.budgets), "utf8")) as Budgets)
    : config.budgets ?? {};
  if (!Object.keys(budgets).length) {
    throw new Error("no budgets set — pass --budgets <file> or add a `budgets` block to dyno.config.json");
  }

  const file = await resolveRunFile(opts.run, outDir);
  const data = JSON.parse(await readFile(file, "utf8"));
  const summary = summaryOf(data);
  if (!summary) throw new Error(`run ${file} has no summary to assert against`);

  const checks = evaluateBudgets(summary, budgets);
  const failed = checks.filter((c) => !c.pass);

  console.log(pc.bold("\nmcp-dyno assert"));
  console.log(pc.dim(`  run ${file}\n`));
  for (const c of checks) console.log(fmtCheck(c));

  if (opts.summaryMd) {
    await writeFile(resolve(process.cwd(), opts.summaryMd), budgetMarkdown(summary.label, checks), "utf8");
    console.log(pc.dim(`\n  markdown summary → ${opts.summaryMd}`));
  }

  if (failed.length) {
    console.log(pc.red(`\n✖ ${failed.length}/${checks.length} budget(s) breached`));
    process.exit(1);
  }
  console.log(pc.green(`\n✓ all ${checks.length} budgets met`));
}
