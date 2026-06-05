import type {
  AttemptErgonomics,
  AttemptResult,
  ErgonomicsSummary,
  ToolDef,
  ToolErgonomics,
  Transcript,
} from "../types.js";
import { violatesSchema } from "../score/structural.js";
import { DEFAULT_HEAVY_PAYLOAD_TOKENS } from "../config.js";

/**
 * Server Ergonomics — the one pillar that grades the SERVER's design rather than the
 * model. Two v1 metrics, both properties of the interaction (no ground truth needed):
 *
 *  - Result-payload efficiency: how many tokens each tool returns per call. Heavy
 *    payloads are context tax the author controls (pagination / field-selection).
 *  - Affordance clarity (first-call): when the model first reaches for a tool, does it
 *    pick a real tool and fill its arguments correctly from the description/schema alone?
 *
 * Computed from the FULL transcript at attempt time (before the dashboard log is
 * truncated), so result-token sizes are accurate.
 */

function resultTokens(result: string | undefined, bytesPerToken: number): number {
  return Buffer.byteLength(result ?? "", "utf8") / bytesPerToken;
}

export function emptyErgonomics(): AttemptErgonomics {
  return { perTool: {}, firstCall: null, firstCallByTool: {} };
}

export function attemptErgonomics(
  transcript: Transcript,
  toolDefs: ToolDef[],
  bytesPerToken: number,
): AttemptErgonomics {
  const known = new Map(toolDefs.map((t) => [t.name, t]));
  const erg = emptyErgonomics();

  for (const turn of transcript.turns) {
    for (const call of turn.toolCalls) {
      const def = known.get(call.name);
      const errored = call.isError === true;
      // Unknown (hallucinated) tools count as an affordance failure, not a schema check.
      const schemaViolated = def ? violatesSchema(call.args, def.inputSchema) : true;

      const pt = erg.perTool[call.name] ?? { calls: 0, resultTokens: 0, resultTokensMax: 0 };
      const tok = resultTokens(call.result, bytesPerToken);
      pt.calls += 1;
      pt.resultTokens += tok;
      pt.resultTokensMax = Math.max(pt.resultTokensMax, tok);
      erg.perTool[call.name] = pt;

      if (erg.firstCall === null) erg.firstCall = { name: call.name, errored, schemaViolated };
      if (!(call.name in erg.firstCallByTool)) erg.firstCallByTool[call.name] = { errored, schemaViolated };
    }
  }
  return erg;
}

export function aggregateErgonomics(
  attempts: AttemptResult[],
  opts: { payloadThresholdTokens?: number; unclearRate?: number } = {},
): ErgonomicsSummary {
  const threshold = opts.payloadThresholdTokens ?? DEFAULT_HEAVY_PAYLOAD_TOKENS;
  const unclearRate = opts.unclearRate ?? 0.25;

  type Acc = { calls: number; resultTokens: number; resultTokensMax: number; firstCalls: number; firstSchemaErr: number; firstErr: number };
  const acc = new Map<string, Acc>();
  const get = (name: string): Acc => {
    let a = acc.get(name);
    if (!a) {
      a = { calls: 0, resultTokens: 0, resultTokensMax: 0, firstCalls: 0, firstSchemaErr: 0, firstErr: 0 };
      acc.set(name, a);
    }
    return a;
  };

  let firstCallTotal = 0;
  let firstCallSuccess = 0;

  for (const att of attempts) {
    if (att.failed) continue;
    const erg = att.ergonomics;
    if (!erg) continue; // pre-0.2 attempt without ergonomics
    for (const [name, pt] of Object.entries(erg.perTool)) {
      const a = get(name);
      a.calls += pt.calls;
      a.resultTokens += pt.resultTokens;
      a.resultTokensMax = Math.max(a.resultTokensMax, pt.resultTokensMax);
    }
    for (const [name, fc] of Object.entries(erg.firstCallByTool)) {
      const a = get(name);
      a.firstCalls += 1;
      if (fc.schemaViolated) a.firstSchemaErr += 1;
      if (fc.errored) a.firstErr += 1;
    }
    if (erg.firstCall) {
      firstCallTotal += 1;
      if (!erg.firstCall.errored && !erg.firstCall.schemaViolated) firstCallSuccess += 1;
    }
  }

  const totalResultTokens = [...acc.values()].reduce((s, a) => s + a.resultTokens, 0);
  const perTool: ToolErgonomics[] = [...acc.entries()]
    .map(([name, a]) => {
      const resultTokensMean = a.calls ? a.resultTokens / a.calls : 0;
      return {
        name,
        calls: a.calls,
        resultTokensMean,
        resultTokensMax: a.resultTokensMax,
        resultTokenShare: totalResultTokens ? a.resultTokens / totalResultTokens : 0,
        heavyPayload: resultTokensMean >= threshold,
        firstCalls: a.firstCalls,
        firstCallSchemaErrorRate: a.firstCalls ? a.firstSchemaErr / a.firstCalls : 0,
        firstCallErrorRate: a.firstCalls ? a.firstErr / a.firstCalls : 0,
      };
    })
    .sort((x, y) => y.resultTokenShare - x.resultTokenShare);

  // Worklist: require ≥2 first-uses before flagging a tool as unclear (avoid single-sample noise).
  const unclearTools = perTool
    .filter((t) => t.firstCalls >= 2 && (t.firstCallSchemaErrorRate >= unclearRate || t.firstCallErrorRate >= unclearRate))
    .map((t) => t.name);

  return {
    perTool,
    firstCallSuccessRate: firstCallTotal ? firstCallSuccess / firstCallTotal : null,
    heavyPayloadTools: perTool.filter((t) => t.heavyPayload).map((t) => t.name),
    unclearTools,
    payloadThresholdTokens: threshold,
  };
}
