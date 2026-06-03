import { writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import pc from "picocolors";
import { DEFAULTS } from "../config.js";

const CONFIG_FILE = "dyno.config.json";
const TASKS_FILE = "dyno-tasks.yaml";

const SAMPLE_CONFIG = {
  $schema: "https://raw.githubusercontent.com/rafaelsztutman/mcp-dyno/main/schema.json",
  // analyze: the single server under test
  server: { target: "node ./build/index.js", transport: "stdio", env: {} },
  // compare: two variants, EACH with its own env/headers (e.g. different API keys)
  base: { target: "node ./build/index.js", transport: "stdio", env: { API_KEY: "" }, label: "base" },
  head: { target: "node ./build-optimized/index.js", transport: "stdio", env: { API_KEY: "" }, label: "head" },
  epochs: DEFAULTS.epochs,
  concurrency: DEFAULTS.concurrency,
  model: DEFAULTS.driverModel,
  judgeModel: DEFAULTS.judgeModel,
  auth: DEFAULTS.auth,
  tasks: TASKS_FILE,
};

const SAMPLE_TASKS = `# dyno tasks — bring-your-own workload.
# Each task has either a single 'prompt' or a multi-turn 'turns' list,
# plus natural-language 'criteria' the judge uses to grade success.
- id: 01-example-single
  category: baseline
  prompt: "Ask the server to do a representative single-step task here."
  criteria:
    - "The answer uses the correct tool for the request."
    - "No fabricated / hallucinated data."

- id: 02-example-multiturn
  category: medium
  turns:
    - "Start a multi-step investigation here."
    - "Ask a follow-up that depends on the first answer."
  criteria:
    - "Later turns reuse information from earlier turns instead of re-fetching."
    - "Final answer is correct and complete."
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(opts: { force?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const targets: Array<[string, string]> = [
    [resolve(cwd, CONFIG_FILE), JSON.stringify(SAMPLE_CONFIG, null, 2) + "\n"],
    [resolve(cwd, TASKS_FILE), SAMPLE_TASKS],
  ];

  for (const [path, content] of targets) {
    if (!opts.force && (await exists(path))) {
      console.log(pc.yellow(`• skip ${path} (exists — use --force to overwrite)`));
      continue;
    }
    await writeFile(path, content, "utf8");
    console.log(pc.green(`✓ wrote ${path}`));
  }

  console.log(
    `\nNext: edit ${pc.cyan(TASKS_FILE)} (or delete it to auto-generate), then run\n  ${pc.bold(
      "dyno analyze --server \"node ./build/index.js\"",
    )}`,
  );
}
