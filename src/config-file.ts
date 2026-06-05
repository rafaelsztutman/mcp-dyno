import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import type { ServerSpec, Transport } from "./types.js";
import type { ModelPrice } from "./pricing/prices.js";
import type { Budgets } from "./run/gate.js";

/** A server definition in dyno.config.json — each carries its OWN env/headers,
 * which is what lets `compare` target two servers with different secrets/auth. */
export interface ServerBlock {
  target: string;
  transport?: Transport;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  label?: string;
}

export interface DynoConfig {
  /** analyze: the server under test. */
  server?: ServerBlock;
  /** compare: the two variants. */
  base?: ServerBlock;
  head?: ServerBlock;
  tasks?: string;
  model?: string;
  judgeModel?: string;
  auth?: "api" | "cli";
  epochs?: number;
  concurrency?: number;
  judge?: boolean;
  prices?: Record<string, ModelPrice>;
  /** CI thresholds for `dyno assert`. */
  budgets?: Budgets;
}

const DEFAULT_CONFIG_FILE = "dyno.config.json";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load dyno.config.json. With an explicit path, a missing file is an error.
 * Without one, falls back to ./dyno.config.json if present, else returns {}.
 */
export async function loadConfig(path?: string): Promise<DynoConfig> {
  let file: string | undefined = path ? resolve(process.cwd(), path) : undefined;
  if (!file) {
    const def = resolve(process.cwd(), DEFAULT_CONFIG_FILE);
    if (await exists(def)) file = def;
  }
  if (!file) return {};
  if (!(await exists(file))) throw new Error(`config file not found: ${file}`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as DynoConfig;
  } catch (err) {
    throw new Error(`invalid config file ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function specFromBlock(block: ServerBlock, label: string): ServerSpec {
  const transport = block.transport ?? "stdio";
  if ((transport === "sse" || transport === "http") && !/^https?:\/\//.test(block.target)) {
    throw new Error(`config server "${label}" uses ${transport} but target is not an http(s) URL`);
  }
  return {
    target: block.target,
    transport,
    env: block.env,
    headers: block.headers,
    label: block.label ?? label,
  };
}
