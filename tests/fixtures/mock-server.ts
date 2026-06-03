/**
 * Minimal MCP server used as a deterministic, offline test fixture.
 * Launch over stdio: `node_modules/.bin/tsx tests/fixtures/mock-server.ts`
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mock-server", version: "0.0.1" });

server.registerTool(
  "echo",
  {
    description: "Echo a message back to the caller.",
    inputSchema: { message: z.string().describe("the message to echo") },
  },
  async ({ message }) => ({ content: [{ type: "text", text: `echo: ${message}` }] }),
);

server.registerTool(
  "add",
  {
    description: "Add two numbers and return the sum.",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

server.registerTool(
  "boom",
  { description: "Always returns a tool error (for error-path testing)." },
  async () => ({ content: [{ type: "text", text: "intentional failure" }], isError: true }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
