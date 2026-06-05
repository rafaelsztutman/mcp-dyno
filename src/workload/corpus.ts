import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Versioned, in-repo task corpora keyed by server archetype. Unlike auto-generated
 * tasks (which differ per run), a corpus is fixed and human-written, so runs against
 * it are comparable across servers and over time. Files live at
 * `corpus/<archetype>/v<version>.yaml`; select with "<archetype>@<version>" (or just
 * "<archetype>" for the latest version).
 */
const CORPUS_ROOT = fileURLToPath(new URL("../../corpus/", import.meta.url));

function listVersions(dir: string): number[] {
  try {
    return readdirSync(dir)
      .map((f) => /^v(\d+)\.ya?ml$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

export function listArchetypes(): string[] {
  try {
    return readdirSync(CORPUS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function listCorpora(): Array<{ archetype: string; versions: number[] }> {
  return listArchetypes().map((a) => ({ archetype: a, versions: listVersions(join(CORPUS_ROOT, a)).sort((x, y) => x - y) }));
}

/** Resolve "<archetype>[@<version>]" to a corpus YAML path (latest version if omitted). */
export function resolveCorpus(selector: string): string {
  const [archetype, ver] = selector.split("@");
  if (!archetype) throw new Error(`empty corpus selector — use "<archetype>" or "<archetype>@<version>"`);
  const dir = join(CORPUS_ROOT, archetype);
  const available = listArchetypes();
  if (!existsSync(dir)) {
    throw new Error(`unknown corpus archetype "${archetype}". Available: ${available.join(", ") || "(none)"}`);
  }
  const versions = listVersions(dir);
  const version = ver ? Number(ver) : versions.length ? Math.max(...versions) : NaN;
  if (!Number.isFinite(version)) throw new Error(`corpus "${archetype}" has no versions`);
  const file = join(dir, `v${version}.yaml`);
  if (!existsSync(file)) {
    throw new Error(`corpus "${archetype}@${version}" not found. Available versions: ${versions.join(", ") || "(none)"}`);
  }
  return file;
}
