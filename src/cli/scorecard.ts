import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";
import type { ServerSummary } from "../run/aggregate.js";
import { badgeEndpoint, computeScorecard, type Grade } from "../run/scorecard.js";

export interface ScorecardOpts {
  run?: string;
  out?: string;
  badge?: string;
}

function summaryOf(data: any): ServerSummary | null {
  return data?.summary ?? data?.headSummary ?? data?.baseSummary ?? null;
}

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
      const st = await stat(file);
      if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
    } catch {
      /* skip */
    }
  }
  if (!best) throw new Error(`no results.json found under ${outDir}`);
  return best.file;
}

function colorGrade(g: Grade): string {
  const c = g === "A" || g === "B" ? pc.green : g === "C" ? pc.yellow : pc.red;
  return c(pc.bold(g));
}

/** Print a per-pillar scorecard for a run and optionally emit a committable badge JSON. */
export async function runScorecard(opts: ScorecardOpts): Promise<void> {
  const outDir = opts.out ?? DEFAULTS.outDir;
  const file = await resolveRunFile(opts.run, outDir);
  const data = JSON.parse(await readFile(file, "utf8"));
  const summary = summaryOf(data);
  if (!summary) throw new Error(`run ${file} has no summary to score`);

  const card = computeScorecard(summary);

  console.log(pc.bold(`\nmcp-dyno scorecard — ${summary.label}`));
  console.log(pc.dim(`  ${file}\n`));
  for (const g of card.graded) {
    console.log(`  ${colorGrade(g.grade)}  ${g.pillar.padEnd(18)} ${pc.dim(g.detail)}`);
  }
  if (card.composite) {
    console.log(`\n  ${colorGrade(card.composite)}  ${pc.bold("design quality")} ${pc.dim(`(composite of ${card.graded.length} pillars)`)}`);
  }
  console.log(pc.dim("\n  measured (not graded — workload-dependent):"));
  for (const m of card.measured) console.log(pc.dim(`    ${m.label.padEnd(22)} ${m.value}`));
  console.log(pc.dim(`\n  ${card.note}`));

  if (opts.badge) {
    const path = resolve(process.cwd(), opts.badge);
    await writeFile(path, JSON.stringify(badgeEndpoint(card), null, 2), "utf8");
    console.log(pc.dim(`\n  badge → ${opts.badge}`));
    console.log(
      pc.dim(`  add to README: `) +
        `![mcp-dyno](https://img.shields.io/endpoint?url=<raw-url-to-${opts.badge}>)`,
    );
  }
}
