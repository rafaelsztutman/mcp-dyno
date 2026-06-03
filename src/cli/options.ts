import type { ServerSpec, Transport } from "../types.js";

/** Parse repeatable "k:v" / "k=v" pairs into a record. */
export function parsePairs(items: string[] | undefined, sep: ":" | "="): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of items ?? []) {
    const idx = raw.indexOf(sep);
    if (idx === -1) throw new Error(`Invalid pair "${raw}" — expected key${sep}value`);
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  return out;
}

export function parseTransport(value: string): Transport {
  if (value === "stdio" || value === "sse" || value === "http") return value;
  throw new Error(`Unknown transport "${value}" — use stdio | sse | http`);
}

export function buildServerSpec(target: string, opts: Record<string, unknown>, label?: string): ServerSpec {
  const transport = parseTransport(String(opts.transport ?? "stdio"));
  if ((transport === "sse" || transport === "http") && !/^https?:\/\//.test(target)) {
    throw new Error(`Transport "${transport}" needs an http(s) URL, got "${target}"`);
  }
  return {
    target,
    transport,
    env: parsePairs(opts.env as string[] | undefined, "="),
    headers: parsePairs(opts.header as string[] | undefined, ":"),
    label,
  };
}

export function posInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}
