import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, specFromBlock } from "../src/config-file.js";

let dir: string;
let cfgPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyno-cfg-"));
  cfgPath = join(dir, "dyno.config.json");
  await writeFile(
    cfgPath,
    JSON.stringify({
      base: { target: "node ./a.js", transport: "stdio", env: { API_KEY: "AAA" }, label: "v1" },
      head: { target: "https://example.com/mcp", transport: "http", headers: { Authorization: "Bearer X" } },
      epochs: 7,
      model: "claude-sonnet-4-6",
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("reads a config file and its fields", async () => {
    const cfg = await loadConfig(cfgPath);
    expect(cfg.epochs).toBe(7);
    expect(cfg.model).toBe("claude-sonnet-4-6");
    expect(cfg.base?.env?.API_KEY).toBe("AAA");
  });
  it("throws on a missing explicit path", async () => {
    await expect(loadConfig(join(dir, "nope.json"))).rejects.toThrow(/not found/);
  });
});

describe("specFromBlock", () => {
  it("carries per-server env (the compare use-case)", async () => {
    const cfg = await loadConfig(cfgPath);
    const base = specFromBlock(cfg.base!, "base");
    expect(base).toMatchObject({ target: "node ./a.js", transport: "stdio", label: "v1" });
    expect(base.env?.API_KEY).toBe("AAA");
  });
  it("carries headers for remote transports", async () => {
    const cfg = await loadConfig(cfgPath);
    const head = specFromBlock(cfg.head!, "head");
    expect(head.transport).toBe("http");
    expect(head.headers?.Authorization).toBe("Bearer X");
    expect(head.label).toBe("head"); // default when block has no label
  });
  it("rejects remote transport with a non-URL target", () => {
    expect(() => specFromBlock({ target: "node ./x.js", transport: "sse" }, "head")).toThrow(/http/);
  });
});
