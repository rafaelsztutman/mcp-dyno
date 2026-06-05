import type { StructuralFlags, ToolDef, Transcript } from "../types.js";

/**
 * Objective, ground-truth-free checks computed purely from the transcript.
 * These need no known-correct answer, so they work zero-config on any server.
 */

/** Shallow JSON-Schema check: required top-level props present, primitive types match. */
export function violatesSchema(args: unknown, schema: Record<string, unknown>): boolean {
  if (schema.type === "object" || schema.properties) {
    if (typeof args !== "object" || args === null || Array.isArray(args)) return true;
    const obj = args as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj)) return true;
    }
    const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
    for (const [key, val] of Object.entries(obj)) {
      const expected = props[key]?.type;
      if (!expected) continue;
      if (!matchesType(val, expected)) return true;
    }
  }
  return false;
}

function matchesType(val: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof val === "string";
    case "number":
    case "integer":
      return typeof val === "number";
    case "boolean":
      return typeof val === "boolean";
    case "array":
      return Array.isArray(val);
    case "object":
      return typeof val === "object" && val !== null && !Array.isArray(val);
    case "null":
      return val === null;
    default:
      return true;
  }
}

export function structuralFlags(transcript: Transcript, toolDefs: ToolDef[]): StructuralFlags {
  const known = new Map(toolDefs.map((t) => [t.name, t]));
  let hallucinatedToolCalls = 0;
  let schemaViolations = 0;
  let toolErrors = 0;

  for (const turn of transcript.turns) {
    for (const call of turn.toolCalls) {
      const def = known.get(call.name);
      if (!def) {
        hallucinatedToolCalls++;
        continue; // can't schema-check an unknown tool
      }
      if (violatesSchema(call.args, def.inputSchema)) schemaViolations++;
      if (call.isError) toolErrors++;
    }
  }

  // Recovered = hit at least one tool error but still produced a final answer.
  const producedAnswer = (transcript.finalText ?? "").trim().length > 0;
  const recoveredFromError = toolErrors > 0 && producedAnswer;

  return { hallucinatedToolCalls, schemaViolations, toolErrors, recoveredFromError };
}
