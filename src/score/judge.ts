import type { AuthMode, JudgeResult, Task, Verdict } from "../types.js";
import { taskTurns } from "../engine/driver.js";
import { completeText, extractJson } from "../engine/complete.js";

const JUDGE_SYSTEM =
  "You are a strict, impartial evaluator of an AI assistant's answer. " +
  "Given the user's task, a list of pass/fail criteria, and the assistant's final answer, " +
  "judge EACH criterion independently. Respond with ONLY a JSON object, no prose, no markdown:\n" +
  '{"verdicts":[{"criterion":"<verbatim criterion>","verdict":"PASS|PARTIAL|FAIL","reason":"<short>"}]}';

const VERDICT_SCORE: Record<Verdict, number> = { PASS: 1, PARTIAL: 0.5, FAIL: 0 };

export function buildJudgeUser(task: Task, finalAnswer: string, toolSummary?: string): string {
  const turns = taskTurns(task);
  const convo = turns.length === 1 ? turns[0] : turns.map((t, i) => `Turn ${i + 1}: ${t}`).join("\n");
  const criteria = task.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const parts = [`USER TASK:\n${convo}`, `CRITERIA:\n${criteria}`];
  if (toolSummary !== undefined) {
    parts.push(
      `ASSISTANT'S TOOL USAGE (evidence the answer is grounded in real data):\n${toolSummary || "(no tools were called)"}`,
    );
  }
  parts.push(`ASSISTANT'S FINAL ANSWER:\n${finalAnswer || "(no answer produced)"}`);
  return parts.join("\n\n");
}

function parseVerdicts(text: string, criteria: string[]): JudgeResult[] | null {
  const obj = extractJson(text) as { verdicts?: Array<{ criterion?: string; verdict?: string; reason?: string }> } | null;
  if (!obj || !Array.isArray(obj.verdicts)) return null;
  const valid: Verdict[] = ["PASS", "PARTIAL", "FAIL"];
  const results: JudgeResult[] = obj.verdicts
    .map((v, i) => {
      const verdict = (v.verdict ?? "").toUpperCase() as Verdict;
      return {
        criterion: v.criterion ?? criteria[i] ?? `criterion ${i + 1}`,
        verdict: valid.includes(verdict) ? verdict : "FAIL",
        reason: v.reason ?? "",
      };
    });
  return results.length ? results : null;
}

export function scoreFromVerdicts(verdicts: JudgeResult[]): number {
  if (!verdicts.length) return 0;
  return verdicts.reduce((s, v) => s + VERDICT_SCORE[v.verdict], 0) / verdicts.length;
}

export interface JudgeOutcome {
  verdicts: JudgeResult[];
  score: number | null;
}

/**
 * Grade one attempt's final answer against the task criteria. Uses the same auth
 * mode as the driver (CLI = $0 subscription). Returns score=null if the task has
 * no criteria or the judge output can't be parsed (honest "unjudged" rather than
 * a fabricated score).
 */
export async function judgeAttempt(
  task: Task,
  finalAnswer: string,
  opts: { model: string; auth: AuthMode; toolSummary?: string },
): Promise<JudgeOutcome> {
  if (!task.criteria.length) return { verdicts: [], score: null };
  const user = buildJudgeUser(task, finalAnswer, opts.toolSummary);
  const text = await completeText({ model: opts.model, auth: opts.auth, system: JUDGE_SYSTEM, user, maxTokens: 1024 });
  const verdicts = parseVerdicts(text, task.criteria);
  if (!verdicts) return { verdicts: [], score: null };
  return { verdicts, score: scoreFromVerdicts(verdicts) };
}
