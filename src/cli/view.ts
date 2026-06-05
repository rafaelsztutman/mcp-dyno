import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";
import { DASHBOARD_HTML } from "../report/dashboard-html.js";
import { buildCompareRows } from "../run/compare.js";
import type { ServerSummary } from "../run/aggregate.js";

export interface ViewOpts {
  out?: string;
  port?: string;
}

interface RunMeta {
  runId: string;
  kind: string;
  labels: string[];
  model?: string;
  mtime: number;
}

async function listRuns(outDir: string): Promise<RunMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return [];
  }
  const runs: RunMeta[] = [];
  for (const id of entries) {
    const file = join(outDir, id, "results.json");
    try {
      const s = await stat(file);
      const data = JSON.parse(await readFile(file, "utf8"));
      const labels =
        data.kind === "compare"
          ? [data.base?.label ?? "base", data.head?.label ?? "head"]
          : [data.summary?.label ?? data.server?.label ?? id];
      runs.push({ runId: id, kind: data.kind ?? "analyze", labels, model: data.model, mtime: s.mtimeMs });
    } catch {
      /* skip dirs without a valid results.json */
    }
  }
  return runs.sort((a, b) => b.mtime - a.mtime);
}

function send(res: import("node:http").ServerResponse, code: number, type: string, body: string): void {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

/** A run artifact exposes its server summary under one of these keys. */
function summaryOf(data: any): ServerSummary | null {
  return data?.summary ?? data?.headSummary ?? data?.baseSummary ?? null;
}

async function loadRun(outDir: string, id: string): Promise<any> {
  return JSON.parse(await readFile(join(outDir, id, "results.json"), "utf8"));
}

/** Compare any two saved runs by their stored per-task summaries (paired stats). */
async function compareRuns(outDir: string, a: string, b: string): Promise<string> {
  const [da, db] = await Promise.all([loadRun(outDir, a), loadRun(outDir, b)]);
  const sa = summaryOf(da);
  const sb = summaryOf(db);
  if (!sa || !sb) throw new Error("one of the runs has no comparable summary");
  const { rows, matched, skipped } = buildCompareRows(sa, sb);
  return JSON.stringify({
    baseLabel: sa.label,
    headLabel: sb.label,
    baseModel: da.model,
    headModel: db.model,
    baseSummary: sa,
    headSummary: sb,
    matched,
    skipped,
    comparison: rows.map((r) => ({ metric: r.metric, base: r.base, head: r.head, lowerIsBetter: r.lowerIsBetter, ...r.result })),
  });
}

/** Load N runs' summaries for the model-matrix view (same task set, different models). */
async function matrixRuns(outDir: string, idsCsv: string): Promise<string> {
  const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const cols: Array<{ runId: string; label: string; model?: string; summary: ServerSummary }> = [];
  for (const id of ids) {
    const data = await loadRun(outDir, id).catch(() => null);
    if (!data) continue;
    const s = summaryOf(data);
    if (!s) continue;
    cols.push({ runId: id, label: s.label, model: data.model, summary: s });
  }
  return JSON.stringify({ cols });
}

export async function runView(opts: ViewOpts): Promise<void> {
  const outDir = opts.out ?? DEFAULTS.outDir;
  const port = Number(opts.port ?? 4000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", DASHBOARD_HTML);
      if (url.pathname === "/api/runs") {
        return send(res, 200, "application/json", JSON.stringify(await listRuns(outDir)));
      }
      if (url.pathname === "/api/compare") {
        const a = url.searchParams.get("a");
        const b = url.searchParams.get("b");
        if (!a || !b) return send(res, 400, "text/plain", "need ?a=<runId>&b=<runId>");
        return send(res, 200, "application/json", await compareRuns(outDir, a, b));
      }
      if (url.pathname === "/api/matrix") {
        const ids = url.searchParams.get("ids");
        if (!ids) return send(res, 400, "text/plain", "need ?ids=<runId>,<runId>,…");
        return send(res, 200, "application/json", await matrixRuns(outDir, ids));
      }
      const m = url.pathname.match(/^\/api\/runs\/(.+)$/);
      if (m) {
        const file = join(outDir, decodeURIComponent(m[1]!), "results.json");
        return send(res, 200, "application/json", await readFile(file, "utf8"));
      }
      send(res, 404, "text/plain", "not found");
    } catch (err) {
      send(res, 500, "text/plain", err instanceof Error ? err.message : String(err));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, resolve);
  });

  console.log(pc.bold("\nmcp-dyno dashboard"));
  console.log(`  serving runs from ${pc.cyan(outDir)}`);
  console.log(`  ${pc.green(`http://localhost:${port}`)}  ${pc.dim("(Ctrl-C to stop)")}\n`);
  await new Promise(() => {}); // run until interrupted
}
