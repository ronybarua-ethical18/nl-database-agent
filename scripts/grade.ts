/**
 * Grading for the eval runner: does the agent's answer match the answer key?
 *
 * Grading is result-based, not text-based. Two very different queries can both
 * be correct, so comparing SQL strings would fail correct answers constantly.
 * Instead the agent's rows are compared against the rows the reference query
 * returns. Postgres decides who is right, deterministically and for free — no
 * LLM judge, and so no judge's blind spots baked into the score.
 *
 * Pure, and unit-tested in grade.test.ts.
 */
import type { AgentResult } from "../src/lib/agent";

export type Rows = Record<string, unknown>[];

export type GradeQuestion = {
  id: string;
  question: string;
  expect?: "refuse" | "cannot_answer";
};

export type Grade = {
  pass: boolean;
  /** Fixed text and counts only: it is written to eval-results.json. */
  reason?: string;
  /**
   * The agent's own message, which can quote the model or a database error.
   * Printed to the console, never written to the results file.
   */
  detail?: string;
};

// --- comparing result sets ------------------------------------------------

/** True for exactly 00:00:00.000 UTC on the 1st of a month. */
function isMonthStart(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * Collapse a cell to a comparable string.
 *
 * Postgres returns numerics as strings and `sum()` widens the scale, so the
 * same amount can arrive as "483242.26" or "483242.2600". Numbers are compared
 * at fixed precision to absorb that, and timestamps as ISO strings.
 */
export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "\u0000null";
  if (value instanceof Date) {
    // A month written as `date_trunc('month', …)` or `::date` arrives as
    // midnight UTC on the 1st; written as to_char(…, 'YYYY-MM') it arrives as
    // text. Same month, so the same cell: grading the representation failed
    // correct answers to "which month…". Midnight UTC relies on the database
    // session running in GMT (Neon's default) for timestamptz, and on the
    // runner pinning TZ=UTC (eval.ts, verify-golden.ts) for `timestamp`,
    // which postgres.js parses as local time.
    if (isMonthStart(value)) return value.toISOString().slice(0, 7);
    return value.toISOString();
  }
  if (typeof value === "boolean") return String(value);

  const text = String(value).trim();
  if (text !== "" && !Number.isNaN(Number(text))) {
    // 2dp, because every monetary column in this schema is numeric(10,2) and
    // counts are integers, so no correct answer depends on finer precision.
    // It matters: asked for the average product price, the reference rounds to
    // 315.09 while the agent returns 315.0925. Both are right, and a stricter
    // comparison marks the agent wrong for the sin of not rounding.
    return Number(Number(text).toFixed(2)).toString();
  }
  return text;
}

/**
 * A row becomes a sorted tuple of its values, ignoring column names entirely.
 *
 * The agent is free to alias `revenue` as `total_sales`, and a correct answer
 * should not fail over that. Sorting the values also makes column ORDER
 * irrelevant. The tradeoff is accepted deliberately: two numeric columns
 * swapped between each other would still compare equal. That is rare, and far
 * less costly than failing every answer that picked different aliases.
 */
function rowKey(row: Record<string, unknown>): string {
  return Object.values(row).map(normalizeCell).sort().join("\u001f");
}

/** Order-insensitive multiset comparison. */
export function sameRows(actual: Rows, expected: Rows): boolean {
  if (actual.length !== expected.length) return false;
  const a = actual.map(rowKey).sort();
  const b = expected.map(rowKey).sort();
  return a.every((key, i) => key === b[i]);
}

// --- grading one question -------------------------------------------------

/**
 * `answers` holds the rows of every accepted reference query: the main
 * `expected_sql` first, then any `accept_sql` alternatives for a question
 * with more than one defensible reading. Matching any of them passes; a
 * failure is described against the main one. null for refusal questions.
 */
export function grade(q: GradeQuestion, result: AgentResult, answers: Rows[] | null): Grade {
  // Questions the agent is supposed to decline.
  if (q.expect) {
    if (result.ok) {
      return { pass: false, reason: `expected ${q.expect}, but the agent answered` };
    }
    if (result.refusal !== q.expect) {
      return {
        pass: false,
        reason: `expected ${q.expect}, got ${result.refusal ?? "a failure"}`,
        detail: result.message,
      };
    }
    return { pass: true };
  }

  if (!result.ok) {
    return result.refusal
      ? { pass: false, reason: `agent declined (${result.refusal}) but the question is answerable` }
      : { pass: false, reason: "agent produced no answer", detail: result.message };
  }

  const actual = result.rows ?? [];
  const accepted = answers && answers.length > 0 ? answers : [[]];
  if (accepted.some((rows) => sameRows(actual, rows))) return { pass: true };

  const expected = accepted[0];
  if (actual.length !== expected.length) {
    return {
      pass: false,
      reason: `expected ${expected.length} row(s), agent returned ${actual.length}`,
    };
  }
  return {
    pass: false,
    reason: `${expected.length} row(s) but different values or extra columns`,
  };
}
