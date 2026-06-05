import type { JudgeResult, TaskExpectations, Transcript } from "../types.js";

/**
 * Deterministic, ground-truth correctness checks computed from the transcript — no
 * LLM judge, no self-judging loop. When a task declares expectations, these replace
 * the judge for that task, giving a sharper, reproducible correctness signal.
 *
 * Results are returned as JudgeResult[] (PASS/FAIL) so they render through the same
 * dashboard/verdict path as judge output.
 */
export function hasExpectations(exp: TaskExpectations | undefined): exp is TaskExpectations {
  return (
    !!exp &&
    ((exp.toolsCalled?.length ?? 0) > 0 || (exp.answerContains?.length ?? 0) > 0 || (exp.answerMatches?.length ?? 0) > 0)
  );
}

export function checkExpectations(transcript: Transcript, exp: TaskExpectations): { verdicts: JudgeResult[]; score: number } {
  const verdicts: JudgeResult[] = [];
  const called = new Set(transcript.turns.flatMap((t) => t.toolCalls.map((c) => c.name)));
  const answer = transcript.finalText ?? "";
  const lower = answer.toLowerCase();

  for (const tool of exp.toolsCalled ?? []) {
    const pass = called.has(tool);
    verdicts.push({ criterion: `calls tool \`${tool}\``, verdict: pass ? "PASS" : "FAIL", reason: pass ? "called" : "never called" });
  }
  for (const sub of exp.answerContains ?? []) {
    const pass = lower.includes(sub.toLowerCase());
    verdicts.push({ criterion: `answer contains "${sub}"`, verdict: pass ? "PASS" : "FAIL", reason: pass ? "found" : "not found" });
  }
  for (const pat of exp.answerMatches ?? []) {
    let pass = false;
    let reason = "";
    try {
      pass = new RegExp(pat, "i").test(answer);
      reason = pass ? "matched" : "no match";
    } catch {
      reason = "invalid regex";
    }
    verdicts.push({ criterion: `answer matches /${pat}/i`, verdict: pass ? "PASS" : "FAIL", reason });
  }

  const score = verdicts.length ? verdicts.filter((v) => v.verdict === "PASS").length / verdicts.length : 0;
  return { verdicts, score };
}
