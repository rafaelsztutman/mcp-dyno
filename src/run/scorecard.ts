import type { ServerSummary } from "./aggregate.js";

/**
 * A scorecard, deliberately NOT a single number. We grade only the pillars with a
 * meaningful absolute "good/bad" — correctness, reliability, server-ergonomics — and
 * report efficiency/cost/bloat as measured values (they're workload-dependent, so an
 * absolute letter grade would be misleading). The optional composite is the mean of
 * the graded pillars, labeled "design quality".
 */
export type Grade = "A" | "B" | "C" | "D" | "F";

const BANDS: Array<[number, Grade]> = [
  [90, "A"],
  [80, "B"],
  [70, "C"],
  [60, "D"],
  [0, "F"],
];

export function gradeOf(score0to100: number): Grade {
  for (const [min, g] of BANDS) if (score0to100 >= min) return g;
  return "F";
}

/** 0–100 reliability score: penalize hallucination, schema violations, tool errors, poor recovery. */
export function reliabilityScore(s: ServerSummary): number {
  const r = s.reliability;
  let score = 100;
  score -= 30 * Math.min(1, r.hallucinatedRate / 0.1); // any hallucination is serious
  score -= 20 * Math.min(1, r.schemaViolationRate / 0.2);
  score -= 20 * Math.min(1, r.toolErrorRate / 0.3);
  score -= 30 * (1 - r.recoveryRate);
  return Math.max(0, score);
}

/** 0–100 ergonomics score from first-call success, dinged by heavy/unclear tools. Null if no tools were used. */
export function ergonomicsScore(s: ServerSummary): number | null {
  const e = s.ergonomics;
  if (!e.perTool.length || e.firstCallSuccessRate == null) return null;
  let score = e.firstCallSuccessRate * 100;
  score -= Math.min(30, 10 * e.heavyPayloadTools.length);
  score -= Math.min(45, 15 * e.unclearTools.length);
  return Math.max(0, score);
}

export interface PillarGrade {
  pillar: string;
  grade: Grade;
  score: number;
  detail: string;
}

export interface Scorecard {
  graded: PillarGrade[];
  /** Mean of graded pillars → overall design-quality grade. Null if nothing could be graded. */
  composite: Grade | null;
  compositeScore: number | null;
  /** Measured-but-not-graded context (workload-dependent). */
  measured: Array<{ label: string; value: string }>;
  note: string;
}

function pct(v: number | null): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}

export function computeScorecard(s: ServerSummary): Scorecard {
  const graded: PillarGrade[] = [];

  if (s.correctness.judged && s.correctness.scoreMean != null) {
    const score = s.correctness.scoreMean * 100;
    graded.push({ pillar: "Correctness", grade: gradeOf(score), score, detail: `pass-rate ${pct(s.correctness.scoreMean)}` });
  }

  const rel = reliabilityScore(s);
  graded.push({
    pillar: "Reliability",
    grade: gradeOf(rel),
    score: rel,
    detail: `halluc ${s.reliability.hallucinatedRate.toFixed(2)}/task · errors ${s.reliability.toolErrorRate.toFixed(2)}/task · recovery ${pct(s.reliability.recoveryRate)}`,
  });

  const erg = ergonomicsScore(s);
  if (erg != null) {
    graded.push({
      pillar: "Server ergonomics",
      grade: gradeOf(erg),
      score: erg,
      detail: `first-call ${pct(s.ergonomics.firstCallSuccessRate)}${s.ergonomics.heavyPayloadTools.length ? ` · ${s.ergonomics.heavyPayloadTools.length} heavy` : ""}${s.ergonomics.unclearTools.length ? ` · ${s.ergonomics.unclearTools.length} unclear` : ""}`,
    });
  }

  const compositeScore = graded.length ? graded.reduce((a, g) => a + g.score, 0) / graded.length : null;
  const composite = compositeScore == null ? null : gradeOf(compositeScore);

  const measured = [
    { label: "tokens/task (median)", value: s.efficiency.tokensMedian.toLocaleString("en-US") },
    { label: "$/task", value: s.cost.perTaskMean == null ? "n/a" : `$${s.cost.perTaskMean.toFixed(4)}` },
    { label: "attributable", value: pct(s.bloat.attributableShareMean) },
  ];

  const note = s.correctness.judged
    ? "Composite = mean of graded pillars (design quality). Efficiency/cost are workload-dependent and reported, not graded."
    : "Correctness not graded (judge was off — run with --judge). Efficiency/cost are reported, not graded.";

  return { graded, composite, compositeScore, measured, note };
}

export function gradeColor(g: Grade): string {
  return { A: "brightgreen", B: "green", C: "yellowgreen", D: "orange", F: "red" }[g];
}

/** Shields.io endpoint-badge JSON. Commit it and point a badge at its raw URL. */
export function badgeEndpoint(card: Scorecard, label = "mcp-dyno"): Record<string, unknown> {
  const g = card.composite;
  return {
    schemaVersion: 1,
    label,
    message: g ? `${g} · design quality` : "not graded",
    color: g ? gradeColor(g) : "lightgrey",
  };
}
