import type { ServerSummary, TaskAggregate } from "./aggregate.js";
import { pairedCompare } from "../stats/paired.js";
import type { CompareRow } from "../report/terminal.js";

type MetricSpec = {
  metric: string;
  pick: (t: TaskAggregate) => number | null;
  lowerIsBetter: boolean;
};

const METRICS: MetricSpec[] = [
  { metric: "tokens/task", pick: (t) => t.tokensMean, lowerIsBetter: true },
  { metric: "tool calls", pick: (t) => t.toolCallsMean, lowerIsBetter: true },
  { metric: "discovery RT", pick: (t) => t.discoveryMean, lowerIsBetter: true },
  { metric: "refetch RT", pick: (t) => t.refetchMean, lowerIsBetter: true },
  { metric: "latency ms", pick: (t) => t.latencyMsMean, lowerIsBetter: true },
  { metric: "cost/task", pick: (t) => t.costMean, lowerIsBetter: true },
  { metric: "pass-rate", pick: (t) => t.scoreMean, lowerIsBetter: false },
];

/**
 * Build paired-comparison rows from two server summaries. Tasks are matched by
 * id (only those present in both), and each metric is compared via the paired
 * difference test (variance reduction via pairing).
 */
export function buildCompareRows(base: ServerSummary, head: ServerSummary): { rows: CompareRow[]; matched: string[]; skipped: string[] } {
  const baseById = new Map(base.perTask.map((t) => [t.taskId, t]));
  const headById = new Map(head.perTask.map((t) => [t.taskId, t]));
  const matched = [...baseById.keys()].filter((id) => headById.has(id)).sort();

  const rows: CompareRow[] = [];
  const skipped: string[] = [];

  for (const spec of METRICS) {
    const baseArr: number[] = [];
    const headArr: number[] = [];
    for (const id of matched) {
      const b = spec.pick(baseById.get(id)!);
      const h = spec.pick(headById.get(id)!);
      if (b === null || h === null) continue;
      baseArr.push(b);
      headArr.push(h);
    }
    if (baseArr.length < 2) {
      skipped.push(spec.metric);
      continue;
    }
    rows.push({
      metric: spec.metric,
      base: baseArr.reduce((a, b) => a + b, 0) / baseArr.length,
      head: headArr.reduce((a, b) => a + b, 0) / headArr.length,
      lowerIsBetter: spec.lowerIsBetter,
      result: pairedCompare(baseArr, headArr),
    });
  }
  return { rows, matched, skipped };
}
