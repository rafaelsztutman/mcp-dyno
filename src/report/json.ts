import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Filesystem-safe run id from an ISO timestamp. */
export function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeRunArtifacts(
  outDir: string,
  runId: string,
  record: unknown,
): Promise<string> {
  const dir = join(outDir, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "results.json");
  await writeFile(path, JSON.stringify(record, null, 2), "utf8");
  return path;
}
