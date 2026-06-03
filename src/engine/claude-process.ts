import { spawn } from "node:child_process";

export const DEFAULT_CLAUDE_TIMEOUT_MS = 180_000;

/**
 * Spawn `claude` with the given args, write `stdin`, and resolve its stdout.
 * Shared by the CLI driver and the CLI judge (both billed to the subscription,
 * not the Anthropic API).
 */
export function runClaude(
  args: string[],
  stdin: string,
  opts: { timeoutMs?: number; resultMarker?: string } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS;
  const marker = opts.resultMarker ?? '"type":"result"';
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn claude: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.includes(marker)) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/**
 * Drive a multi-turn `claude -p --input-format stream-json` session, sending each
 * user message only after the previous turn's `result` event arrives. This keeps
 * a single process (MCP server stays warm across turns) while guaranteeing the
 * CLI treats each message as its own turn (piping all at once can coalesce them).
 * Returns the full raw stdout for parsing.
 */
export function runClaudeTurns(
  args: string[],
  userTexts: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS;
  const messages = userTexts.map((text) =>
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }),
  );
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buffer = "";
    let sent = 0;
    let resultsSeen = 0;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const sendNext = () => {
      if (sent < messages.length) child.stdin.write(messages[sent++] + "\n");
      else child.stdin.end();
    };

    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          if ((JSON.parse(line) as { type?: string }).type === "result") {
            resultsSeen++;
            sendNext(); // next turn, or close stdin after the last
          }
        } catch {
          /* ignore non-JSON lines */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn claude: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && resultsSeen === 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout);
    });

    sendNext(); // kick off turn 1
  });
}
