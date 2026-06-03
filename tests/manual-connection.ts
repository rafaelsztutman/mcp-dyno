/** Manual integration check (run with tsx): connect to the mock server and exercise the API. */
import { resolve } from "node:path";
import { createConnection } from "../src/mcp/connection.js";

const root = resolve(import.meta.dirname, "..");
const tsx = resolve(root, "node_modules/.bin/tsx");
const mock = resolve(root, "tests/fixtures/mock-server.ts");

const conn = createConnection({
  target: `${tsx} ${mock}`,
  transport: "stdio",
  label: "mock",
});

await conn.connect();
const tools = await conn.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
console.log("echo schema:", JSON.stringify(tools.find((t) => t.name === "echo")?.inputSchema));

const echo = await conn.callTool("echo", { message: "hello dyno" });
console.log("echo ->", JSON.stringify(echo));

const add = await conn.callTool("add", { a: 2, b: 40 });
console.log("add ->", JSON.stringify(add));

const boom = await conn.callTool("boom", {});
console.log("boom ->", JSON.stringify(boom));

await conn.close();
console.log("OK");
process.exit(0);
