import { describe, it, expect } from "vitest";
import { BYPASS_BUILTINS, CLAUDE_CODE_BUILTINS } from "../src/engine/claude-cli-driver.js";

/**
 * Locks the CLI-driver tool-isolation invariant discovered during end-to-end testing:
 *  - "bypass" built-ins (Bash, Read, …) are DISALLOWED so the model can't do the task
 *    outside the server under test;
 *  - ToolSearch is NOT disallowed — in current Claude Code, MCP tools surface through it,
 *    so blocking it would block all MCP access;
 *  - every Claude Code built-in (incl. ToolSearch) is FILTERED from the recorded transcript
 *    so SUT metrics reflect only the server's own tools.
 */
describe("CLI driver tool isolation", () => {
  it("disallows Bash and other bypass tools", () => {
    expect(BYPASS_BUILTINS).toContain("Bash");
    expect(BYPASS_BUILTINS).toContain("WebFetch");
  });

  it("does NOT disallow ToolSearch (MCP tools surface through it)", () => {
    expect(BYPASS_BUILTINS).not.toContain("ToolSearch");
  });

  it("filters ToolSearch and all bypass tools from SUT metrics", () => {
    expect(CLAUDE_CODE_BUILTINS.has("ToolSearch")).toBe(true);
    for (const t of BYPASS_BUILTINS) expect(CLAUDE_CODE_BUILTINS.has(t)).toBe(true);
  });
});
