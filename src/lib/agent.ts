import { generateText, Output } from "ai";
import { z } from "zod";
import { runReadOnlyQuery, type QueryResult } from "./db";
import { getModel } from "./llm";
import { SCHEMA_DESCRIPTION } from "./schema";
import { validateSql } from "./sql-guard";

export const MAX_ATTEMPTS = 3;

export type Attempt = {
  sql: string;
  error?: string;
};

export type ChartSpec = {
  type: "bar" | "line" | "none";
  xKey?: string;
  yKey?: string;
};

export type AgentResult = {
  ok: boolean;
  question: string;
  /** Present when ok */
  sql?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  explanation?: string;
  /** Why the explanation/chart are missing, when the second LLM call failed. */
  explanationNote?: string;
  chart?: ChartSpec;
  /** Every SQL attempt, including failed ones — shown in the UI */
  attempts: Attempt[];
  /** Present when !ok */
  message?: string;
};

const SQL_SYSTEM_PROMPT = `You translate natural-language questions into a single Postgres SELECT query.

${SCHEMA_DESCRIPTION}

Rules:
- Output ONLY the SQL, no markdown fences, no commentary, no comments inside the SQL.
- Exactly one statement. SELECT (or WITH ... SELECT) only.
- Never write INSERT/UPDATE/DELETE/DDL. If the question asks to modify data or
  do anything other than read data, output exactly: REFUSE: <one short sentence why>
- If the schema genuinely cannot answer the question — the data needed is not in
  these tables — output exactly:
  CANNOT_ANSWER: <one short sentence naming what is missing>
  Never invent a column, and never substitute NULL, a constant, or a placeholder
  to make a query run. A table of NULLs looks like an answer and is worse than
  saying the data is not there.
  Only do this when the data is truly absent. If the question is vague but a
  reasonable interpretation exists in the schema, answer that interpretation.
- Add LIMIT 100 unless the query aggregates to few rows or the user asks for more.
- Prefer human-readable columns (names, not ids) and clear column aliases.
- When ranking with LIMIT, add a stable secondary sort key (usually the name)
  after the ranking column, so ties resolve identically on every run. Without
  one, Postgres may return a different row for "top 5" each time the same
  question is asked.
- Select only the columns the question asks about. Do not add identifying extras
  like email addresses unless they were requested.`;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function generateSqlOnce(
  question: string,
  attempts: Attempt[],
): Promise<string> {
  let prompt = `Question: ${question}`;
  if (attempts.length > 0) {
    const history = attempts
      .map(
        (a, i) =>
          `Attempt ${i + 1}:\n${a.sql}\nProblem: ${a.error ?? "unknown"}`,
      )
      .join("\n\n");
    prompt += `\n\nYour previous attempts failed. Fix the problem and return a corrected query.\n\n${history}`;
    if (attempts[attempts.length - 1]?.error === EMPTY_RESULT_ERROR) {
      prompt += `\n\nIf zero rows is genuinely the correct answer, return the same query again.`;
    }
  }

  const { text } = await generateText({
    model: getModel(),
    system: SQL_SYSTEM_PROMPT,
    prompt,
  });
  return stripFences(text);
}

const EMPTY_RESULT_ERROR =
  "The query ran but returned zero rows. Double-check joins, filters, and string values.";

/** Provider quota / rate-limit failures, which are transient rather than bugs. */
function isRateLimited(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /quota|rate limit|rate-limit|too many requests|\b429\b/i.test(message);
}

const answerSchema = z.object({
  explanation: z
    .string()
    .describe(
      "2-3 plain-language sentences answering the user's question from the data. Mention concrete numbers.",
    ),
  chart: z.object({
    type: z
      .enum(["bar", "line", "none"])
      .describe(
        "bar for categorical comparisons, line for values over time, none if a chart adds nothing (single number, wide text rows).",
      ),
    xKey: z.string().describe("Column to use for the x axis / categories."),
    yKey: z.string().describe("Numeric column to plot."),
  }),
});

async function explainResult(
  question: string,
  sql: string,
  result: QueryResult,
): Promise<{ explanation?: string; chart: ChartSpec; note?: string }> {
  const sample = result.rows.slice(0, 25);
  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({ schema: answerSchema }),
      prompt: `A user asked: "${question}"

This SQL answered it:
${sql}

Result columns: ${result.columns.join(", ")}
Result rows (first ${sample.length} of ${result.rows.length}):
${JSON.stringify(sample)}

Write the explanation and pick a chart.`,
    });
    const chart = output.chart;
    // Only chart what actually exists in the result set.
    const valid =
      chart.type !== "none" &&
      result.columns.includes(chart.xKey) &&
      result.columns.includes(chart.yKey) &&
      result.rows.length > 1;
    return {
      explanation: output.explanation,
      chart: valid ? chart : { type: "none" },
    };
  } catch (err) {
    // The rows are already in hand, so a failure here degrades the answer
    // rather than breaking it. Say so instead of substituting filler: the old
    // fallback ("The query returned 5 row(s).") read like a real explanation
    // and hid the fact that the chart had silently disappeared too.
    return {
      chart: { type: "none" },
      note: isRateLimited(err)
        ? "The plain-language summary and chart were skipped — the model is rate limited. The table below is the full result."
        : "The plain-language summary and chart were unavailable for this answer. The table below is the full result.",
    };
  }
}

/**
 * The core loop: generate SQL → validate → execute → on failure, feed the
 * error back to the model and retry (up to MAX_ATTEMPTS).
 */
export async function askDatabase(question: string): Promise<AgentResult> {
  const attempts: Attempt[] = [];

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let generated: string;
    try {
      generated = await generateSqlOnce(question, attempts);
    } catch (err) {
      // A quota error is transient and worth explaining. The Gemini free tier
      // allows ~20 requests/minute and each question costs up to 4, so a public
      // demo trips this easily — "Something went wrong" would be misleading.
      if (isRateLimited(err)) {
        return {
          ok: false,
          question,
          attempts,
          message:
            "The language model is rate limited right now — the free tier allows " +
            "only a few requests a minute. Wait about a minute and ask again.",
        };
      }
      throw err;
    }

    if (/^refuse:/i.test(generated)) {
      return {
        ok: false,
        question,
        attempts,
        message:
          "I can only read data, not change it. " +
          generated.replace(/^refuse:\s*/i, ""),
      };
    }

    // The schema cannot answer this. Return immediately — retrying will not
    // conjure a column that does not exist, and the alternative is the model
    // fabricating something like AVG(NULL::interval), which renders as a table
    // of nulls and reads as a real answer.
    if (/^cannot_answer:/i.test(generated)) {
      return {
        ok: false,
        question,
        attempts,
        message:
          "This database doesn't hold what that question needs. " +
          generated.replace(/^cannot_answer:\s*/i, ""),
      };
    }

    const guard = validateSql(generated);
    if (!guard.ok) {
      attempts.push({ sql: generated, error: `Rejected by safety guard: ${guard.reason}` });
      continue;
    }

    let result: QueryResult;
    try {
      result = await runReadOnlyQuery(guard.sql);
    } catch (err) {
      attempts.push({
        sql: guard.sql,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (result.rows.length === 0) {
      const previous = attempts[attempts.length - 1];
      const modelInsists =
        previous?.error === EMPTY_RESULT_ERROR && previous.sql === guard.sql;
      if (!modelInsists && i < MAX_ATTEMPTS - 1) {
        attempts.push({ sql: guard.sql, error: EMPTY_RESULT_ERROR });
        continue;
      }
    }

    attempts.push({ sql: guard.sql });
    const { explanation, chart, note } = await explainResult(
      question,
      guard.sql,
      result,
    );
    return {
      ok: true,
      question,
      sql: guard.sql,
      columns: result.columns,
      rows: result.rows,
      truncated: result.truncated,
      explanation,
      explanationNote: note,
      chart,
      attempts,
    };
  }

  return {
    ok: false,
    question,
    attempts,
    message:
      "I couldn't produce a working query for this question after " +
      `${MAX_ATTEMPTS} attempts. Try rephrasing it, or ask something closer to the schema.`,
  };
}
