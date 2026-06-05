import type { AttemptResult, Channel, ErgonomicsSummary } from "../types.js";
import { mean, median, p90, iqr, percentile } from "../measure/metrics.js";
import { aggregateErgonomics } from "../measure/ergonomics.js";

export interface TaskAggregate {
  taskId: string;
  n: number;
  failures: number;
  tokensMean: number;
  toolCallsMean: number;
  discoveryMean: number;
  refetchMean: number;
  latencyMsMean: number;
  costMean: number | null;
  scoreMean: number | null;
}

export interface ServerSummary {
  label: string;
  epochs: number;
  taskCount: number;
  attempts: number;
  failures: number;
  estimated: boolean;
  efficiency: {
    tokensMedian: number;
    tokensP90: number;
    tokensIqr: number;
    toolCallsMedian: number;
    discoveryMean: number;
    refetchMean: number;
    latencyP50: number;
    latencyP95: number;
  };
  cost: { perTaskMean: number | null; source: "reported" | "priced" | "none" };
  bloat: {
    shares: Record<Channel, number>;
    toolDefTokensMean: number;
    attributableShareMean: number;
    floorTokensMean: number;
  };
  reliability: {
    hallucinatedRate: number; // per attempt
    schemaViolationRate: number;
    toolErrorRate: number;
    recoveryRate: number; // among attempts that hit an error
  };
  correctness: { scoreMean: number | null; judged: boolean };
  ergonomics: ErgonomicsSummary;
  perTask: TaskAggregate[];
}

function ok(attempts: AttemptResult[]): AttemptResult[] {
  return attempts.filter((a) => !a.failed);
}

export function aggregateServer(label: string, epochs: number, attempts: AttemptResult[]): ServerSummary {
  const good = ok(attempts);
  const taskIds = [...new Set(attempts.map((a) => a.taskId))];

  const tokens = good.map((a) => a.signals.totalTokens);
  const toolCalls = good.map((a) => a.signals.toolCalls);
  const latencies = good.map((a) => a.signals.durationMs);

  const costs = good.map((a) => a.costUsd).filter((c): c is number => typeof c === "number");
  const anyReported = good.some((a) => typeof a.costUsd === "number");

  const channels: Channel[] = ["toolDef", "toolArg", "toolResult", "reasoning"];
  const shares = Object.fromEntries(
    channels.map((c) => [c, mean(good.map((a) => a.decomposition.shares[c]))]),
  ) as Record<Channel, number>;

  const withError = good.filter((a) => a.structural.toolErrors > 0);
  const recovered = withError.filter((a) => a.structural.recoveredFromError);

  const scored = good.filter((a) => a.score !== null);

  const perTask: TaskAggregate[] = taskIds.map((id) => {
    const all = attempts.filter((a) => a.taskId === id);
    const g = ok(all);
    const tCosts = g.map((a) => a.costUsd).filter((c): c is number => typeof c === "number");
    const tScores = g.map((a) => a.score).filter((s): s is number => s !== null);
    return {
      taskId: id,
      n: g.length,
      failures: all.length - g.length,
      tokensMean: mean(g.map((a) => a.signals.totalTokens)),
      toolCallsMean: mean(g.map((a) => a.signals.toolCalls)),
      discoveryMean: mean(g.map((a) => a.signals.discoveryRoundtrips)),
      refetchMean: mean(g.map((a) => a.signals.refetchRoundtrips)),
      latencyMsMean: mean(g.map((a) => a.signals.durationMs)),
      costMean: tCosts.length ? mean(tCosts) : null,
      scoreMean: tScores.length ? mean(tScores) : null,
    };
  });

  return {
    label,
    epochs,
    taskCount: taskIds.length,
    attempts: attempts.length,
    failures: attempts.length - good.length,
    estimated: good.some((a) => a.decomposition.estimated),
    efficiency: {
      tokensMedian: median(tokens),
      tokensP90: p90(tokens),
      tokensIqr: iqr(tokens),
      toolCallsMedian: median(toolCalls),
      discoveryMean: mean(good.map((a) => a.signals.discoveryRoundtrips)),
      refetchMean: mean(good.map((a) => a.signals.refetchRoundtrips)),
      latencyP50: percentile(latencies, 50),
      latencyP95: percentile(latencies, 95),
    },
    cost: {
      perTaskMean: costs.length ? mean(costs) : null,
      source: costs.length ? (anyReported ? "reported" : "priced") : "none",
    },
    bloat: {
      shares,
      toolDefTokensMean: mean(good.map((a) => a.decomposition.tokensEst.toolDef)),
      attributableShareMean: mean(good.map((a) => a.decomposition.usage.attributableShare)),
      floorTokensMean: mean(good.map((a) => a.decomposition.usage.floorTokens)),
    },
    reliability: {
      hallucinatedRate: mean(good.map((a) => a.structural.hallucinatedToolCalls)),
      schemaViolationRate: mean(good.map((a) => a.structural.schemaViolations)),
      toolErrorRate: mean(good.map((a) => a.structural.toolErrors)),
      recoveryRate: withError.length ? recovered.length / withError.length : 1,
    },
    correctness: {
      scoreMean: scored.length ? mean(scored.map((a) => a.score as number)) : null,
      judged: scored.length > 0,
    },
    ergonomics: aggregateErgonomics(attempts),
    perTask,
  };
}
