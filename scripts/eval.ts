/**
 * Milestone 5 — the eval runner.
 *
 * Sends every question in evals/golden.json through the agent and grades the
 * answer, then prints a scorecard.
 *
 * Grading is result-based, not text-based. Two very different queries can both
 * be correct, so comparing SQL strings would fail correct answers constantly.
 * Instead the agent's rows are compared against the rows the reference query
 * returns. Postgres decides who is right, deterministically and for free — no
 * LLM judge, and so no judge's blind spots baked into the score.
 *
 * Usage:
 *   npm run eval                            # everything
 *   npm run eval -- --only top-             # ids containing "top-"
 *   npm run eval -- --only count-,revenue-  # ids containing ANY of several
 *                                           # substrings; a term that is a full
 *                                           # id matches only that id
 *   npm run eval -- --tag refusal           # one tag
 *   npm run eval -- --tag regression,refusal  # any of several tags (the CI gate)
 *   npm run eval -- --verbose               # show the SQL and rows behind failures
 *
 * Every run ends with the metrics docs/baseline.md records (accuracy, LLM
 * calls and tokens per question, self-fix rate, latency, 429s; see
 * eval-metrics.ts) and writes them, per case and in total, to
 * eval-results.json. They come from the `llm_call` entries `callLlm` emits, so
 * pointing the app at another model (LLM_PROVIDER / LLM_MODEL, read by
 * src/lib/llm.ts) re-measures it with no change here.
 *
 * Env:
 *   EVAL_THRESHOLD   accuracy floor, 0..1, default 0.8 (a little under the
 *                    86% baseline). Below it the process exits 1, which is
 *                    what the CI gate hangs on. 0 turns the check off, for
 *                    small --only runs where one miss is a big percentage.
 *   EVAL_DELAY_MS    pause between questions. The Gemini free tier allows
 *                    roughly 20 requests a minute and one question can cost
 *                    up to three, so a full run needs pacing.
 *   EVAL_ALLOW_SKIPPED=1
 *                    quota outages warn instead of failing the run. CI sets
 *                    this so a provider outage cannot turn the gate red for a
 *                    reason unrelated to the change under review.
 *   LLM_PROVIDER     google (default) or groq. Note that a score is only
 *                    comparable against another score from the same provider:
 *                    the models differ in how faithfully they follow the rules
 *                    in SQL_SYSTEM_PROMPT, not just in accuracy.
 */
import { config } from "dotenv";

// Next.js loads `.env.local`, but plain `dotenv/config` reads only `.env`.
config({ path: [".env.local", ".env"], quiet: true });

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { askDatabase, type AgentResult } from "../src/lib/agent";
import { describeModel, onLlmCall, type LlmCallLog } from "../src/lib/llm";
import { formatSummary, parseThreshold, summarize, type CaseResult } from "./eval-metrics";
import { isDbTransient, isDbTransientMessage, isProviderOutage } from "./transient";

type Question = {
  id: string;
  question: string;
  tags?: string[];
  expected_sql?: string;
  expect?: "refuse" | "cannot_answer";
};

const RESULTS_FILE = "eval-results.json";
// Parsed before anything runs, so a bad value fails fast instead of after a
// run's worth of quota.
const THRESHOLD = parseThreshold(process.env.EVAL_THRESHOLD);
/** Waits before retrying a reference query the database did not answer. */
const DB_RETRY_DELAYS_MS = [5_000, 10_000];
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? "1500");
/** How many times to wait out a quota refusal before giving up on a question. */
const RATE_LIMIT_RETRIES = Number(process.env.EVAL_RATE_LIMIT_RETRIES ?? "3");
const RATE_LIMIT_BACKOFF_MS = Number(process.env.EVAL_BACKOFF_MS ?? "65000");
/**
 * Treat a quota outage as a warning rather than a build failure. CI sets this;
 * locally you want the opposite, because an incomplete run is worth noticing.
 */
const ALLOW_SKIPPED = process.env.EVAL_ALLOW_SKIPPED === "1";

// --- comparing result sets ------------------------------------------------

/**
 * Collapse a cell to a comparable string.
 *
 * Postgres returns numerics as strings and `sum()` widens the scale, so the
 * same amount can arrive as "483242.26" or "483242.2600". Numbers are compared
 * at fixed precision to absorb that, and timestamps as ISO strings.
 */
function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "\u0000null";
  if (value instanceof Date) return value.toISOString();
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
function sameRows(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): boolean {
  if (actual.length !== expected.length) return false;
  const a = actual.map(rowKey).sort();
  const b = expected.map(rowKey).sort();
  return a.every((key, i) => key === b[i]);
}

// --- grading one question -------------------------------------------------

function grade(
  q: Question,
  result: AgentResult,
  expectedRows: Record<string, unknown>[] | null,
): {
  pass: boolean;
  /** Fixed text and counts only: it is written to eval-results.json. */
  reason?: string;
  /**
   * The agent's own message, which can quote the model or a database error.
   * Printed to the console, never written to the results file.
   */
  detail?: string;
} {
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
  const expected = expectedRows ?? [];
  if (sameRows(actual, expected)) return { pass: true };

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

// --- runner ---------------------------------------------------------------

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One attempt at a question; a transient failure comes back as a reason, not
 * a throw. Rate limits, provider outages and database outages all measure
 * nothing about the agent, so the runner waits them out (see transient.ts).
 */
async function askOnce(question: string): Promise<AgentResult | { transient: string }> {
  let result: AgentResult;
  try {
    // explain: false — grading never reads the prose or the chart, and the
    // call it saves is a third of the run's quota.
    result = await askDatabase(question, { explain: false });
  } catch (err) {
    if (isDbTransient(err)) return { transient: "database unavailable" };
    if (isProviderOutage(err)) return { transient: "provider unavailable" };
    throw err;
  }
  if (result.rateLimited) return { transient: "rate limited" };
  // The agent treats any failed query as its own mistake and asks the model
  // for a fix. When the database was simply unreachable, that fix call, the
  // extra attempt and possibly a FAIL would be charged to the agent, so the
  // whole question is asked again instead. The app is unchanged: this only
  // decides what the eval counts.
  if (result.attempts.some((a) => a.error !== undefined && isDbTransientMessage(a.error))) {
    return { transient: "database unavailable" };
  }
  return result;
}

type Rows = Record<string, unknown>[];

/**
 * Runs a reference query. A real SQL error is a broken answer key; a
 * connection failure (Neon waking from idle, mostly) says nothing about the
 * key, so it is retried and then reported as unavailable instead.
 */
async function runReference(
  sql: postgres.Sql,
  query: string,
): Promise<{ rows: Rows } | { broken: string } | { unavailable: string }> {
  for (let retry = 0; ; retry++) {
    try {
      return { rows: (await sql.unsafe(query)) as unknown as Rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isDbTransient(err)) return { broken: message };
      if (retry >= DB_RETRY_DELAYS_MS.length) return { unavailable: message };
      const wait = DB_RETRY_DELAYS_MS[retry];
      console.log(
        `      database unavailable (${message}) — waiting ${wait / 1000}s ` +
          `(retry ${retry + 1}/${DB_RETRY_DELAYS_MS.length})`,
      );
      await sleep(wait);
    }
  }
}

/**
 * The commit under test, for eval-results.json; null when it cannot be told.
 * A local run with uncommitted changes to tracked files is marked "-dirty":
 * those numbers measured code that commit does not contain.
 */
function commitSha(): string | null {
  // CI passes the PR's head commit: on pull_request events GITHUB_SHA is a
  // temporary merge commit that exists on no branch.
  const fromEnv = process.env.EVAL_COMMIT || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const sha = git("rev-parse", "--short=7", "HEAD");
    return git("status", "--porcelain", "--untracked-files=no") === "" ? sha : `${sha}-dirty`;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // Every model call reports itself here. Questions run one at a time, so the
  // calls made between two resets all belong to the same ask.
  let calls: LlmCallLog[] = [];
  onLlmCall((entry) => calls.push(entry));

  /** askOnce, plus the calls it made and how long it took end to end. */
  async function ask(question: string) {
    calls = [];
    const start = performance.now();
    const outcome = await askOnce(question);
    return { outcome, calls, ms: Math.round(performance.now() - start) };
  }

  const file = JSON.parse(readFileSync("evals/golden.json", "utf8")) as {
    questions: Question[];
  };

  const list = (flag: string): string[] =>
    (arg(flag) ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  // Comma-separated, matching ANY of the terms. A term that is itself an id
  // in the suite matches that id exactly; anything else is a substring. The
  // exact form exists for the baseline run (docs/baseline.md): it does not fit
  // the free tier's daily quota, so it is split into disjoint batches over
  // several days, and substrings alone cannot carve the suite into disjoint
  // sets ("avg-order-value" also selects "highest-avg-order-value-country").
  const only = list("--only");
  const ids = new Set(file.questions.map((q) => q.id));
  const matchesOnly = (id: string) =>
    only.some((o) => (ids.has(o) ? id === o : id.includes(o)));
  // Comma-separated, matching ANY of the tags. CI selects two groups at once:
  // a full run does not fit the free tier's daily quota, so the gate covers
  // the questions that guard prompt rules rather than the whole suite.
  const tags = list("--tag");
  const verbose = process.argv.includes("--verbose");

  const questions = file.questions.filter(
    (q) =>
      (only.length === 0 || matchesOnly(q.id)) &&
      (tags.length === 0 || (q.tags ?? []).some((t) => tags.includes(t))),
  );

  if (questions.length === 0) {
    console.error("No questions matched the filter.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  const sql = postgres(url, { max: 3 });

  console.log(`Running ${questions.length} question(s)\n`);
  const cases: CaseResult[] = [];
  /** The agent's own failure messages, for the console only (see grade). */
  const details = new Map<string, string>();
  /**
   * An unexpected error from the agent ends the run, as before, but only
   * after the summary and the results file cover what did run: a crashed
   * gate is exactly when those details matter.
   */
  let crash: { error: unknown } | null = null;

  try {
    for (const q of questions) {
      const tagsOf = q.tags ?? [];

      // The reference query defines the correct answer, so a failure here is a
      // broken answer key, not a wrong agent. Say which it is.
      let expectedRows: Rows | null = null;
      if (q.expected_sql) {
        const ref = await runReference(sql, q.expected_sql);
        if ("unavailable" in ref) {
          console.log(`SKIP  ${q.id} — database unavailable, not measured`);
          cases.push({
            id: q.id,
            tags: tagsOf,
            status: "skipped",
            reason: "database unavailable after retries",
            attempts: 0,
            calls: [],
            discardedCalls: [],
          });
          continue;
        }
        if ("broken" in ref) {
          console.log(`BROKEN KEY  ${q.id}`);
          console.log(`            ${ref.broken}`);
          cases.push({
            id: q.id,
            tags: tagsOf,
            status: "fail",
            reason: "reference SQL failed to run — fix the golden file",
            attempts: 0,
            calls: [],
            discardedCalls: [],
          });
          continue;
        }
        expectedRows = ref.rows;
      }

      // Calls from tries that are thrown away still cost quota; they are kept
      // for the 429/503 counts but not for the per-question numbers.
      const discardedCalls: LlmCallLog[] = [];
      let run = await ask(q.question);

      // A quota refusal or a provider outage measures nothing about the agent,
      // so it must never be scored as a wrong answer. Wait and ask again.
      for (let retry = 0; "transient" in run.outcome && retry < RATE_LIMIT_RETRIES; retry++) {
        discardedCalls.push(...run.calls);
        const wait = RATE_LIMIT_BACKOFF_MS * (retry + 1);
        console.log(`      ${run.outcome.transient} — waiting ${Math.round(wait / 1000)}s (retry ${retry + 1}/${RATE_LIMIT_RETRIES})`);
        await sleep(wait);
        run = await ask(q.question);
      }

      if ("transient" in run.outcome) {
        // Still failing. Record it as unmeasured rather than failed: a score
        // computed over questions that never ran would be a fiction.
        discardedCalls.push(...run.calls);
        console.log(`SKIP  ${q.id} — ${run.outcome.transient}, not measured`);
        cases.push({
          id: q.id,
          tags: tagsOf,
          status: "skipped",
          reason: `${run.outcome.transient} after retries`,
          attempts: 0,
          calls: [],
          discardedCalls,
        });
        continue;
      }
      const result = run.outcome;

      const { pass, reason, detail } = grade(q, result, expectedRows);

      cases.push({
        id: q.id,
        tags: tagsOf,
        status: pass ? "pass" : "fail",
        reason,
        attempts: result.attempts.length,
        latencyMs: run.ms,
        calls: run.calls,
        discardedCalls,
      });

      const retries = result.attempts.length > 1 ? ` (${result.attempts.length} attempts)` : "";
      console.log(`${pass ? "PASS" : "FAIL"}  ${q.id}${retries}`);
      if (detail) details.set(q.id, detail);
      if (!pass) console.log(`      ${reason}${detail ? `: ${detail}` : ""}`);
      if (!pass && verbose) {
        console.log(`      Q: ${q.question}`);
        if (result.sql) console.log(`      agent: ${result.sql}`);
        if (q.expected_sql) console.log(`      ref:   ${q.expected_sql}`);
      }

      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  } catch (error) {
    crash = { error };
  } finally {
    await sql.end();
  }

  const summary = summarize(cases);
  const failures = cases.filter((c) => c.status === "fail");
  const skipped = cases.filter((c) => c.status === "skipped");

  console.log("\n" + "-".repeat(60));
  if (crash) {
    console.log(
      `ABORTED after ${cases.length} of ${questions.length} question(s); ` +
        "the numbers below cover only those. The error follows the summary.\n",
    );
  }
  if (failures.length > 0) {
    console.log("Failed:");
    for (const f of failures) {
      const detail = details.get(f.id);
      console.log(`  ${f.id} — ${f.reason}${detail ? `: ${detail}` : ""}`);
    }
    console.log("");
  }
  for (const line of formatSummary(summary)) console.log(line);

  const { provider, model } = describeModel();
  console.log(`model: ${provider} / ${model}`);

  // Metadata only, like the llm_call log: ids, verdicts, counts and timings,
  // never questions, SQL or rows.
  writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        commit: commitSha(),
        provider,
        model,
        filter: { only, tag: tags },
        threshold: THRESHOLD,
        // The error class that ended the run early, or null for a full run.
        aborted: crash ? (crash.error instanceof Error ? crash.error.name : typeof crash.error) : null,
        summary,
        // null rather than a missing key, so readers see every field.
        cases: cases.map((c) => ({
          ...c,
          reason: c.reason ?? null,
          latencyMs: c.latencyMs ?? null,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${RESULTS_FILE}`);

  if (skipped.length > 0) {
    console.log(
      `\n${skipped.length} of ${cases.length} question(s) never ran (quota or outage): ` +
        skipped.map((s) => s.id).join(", "),
    );
    if (ALLOW_SKIPPED) {
      // CI sets this. A quota outage is an infrastructure problem, and failing
      // the build for it would put the gate red for a reason unrelated to the
      // code under review — which is how a team learns to ignore a red gate.
      // Still printed as a warning, and GitHub renders it on the run summary,
      // so an incomplete gate is visible rather than silent.
      console.log(
        "::warning::Eval gate ran incompletely — " +
          `${skipped.length} question(s) skipped on quota or an outage. The score above ` +
          "covers only what executed.",
      );
    } else {
      console.log(
        "This run is incomplete. If waiting out the backoff did not help, " +
          "either the provider's daily quota is gone rather than the per-minute " +
          "one (wait for the day to roll over) or the database is unreachable " +
          "(the SKIP lines say which).",
      );
      process.exitCode = 1;
    }
  }

  // Nothing measured at all is a failure even in CI. Tolerating a partial run
  // is a judgement that some evidence beats none; zero evidence is not a pass
  // under any setting, or the gate would go green while testing nothing.
  if (summary.measured === 0) {
    console.log("Nothing was measured, so the gate proves nothing. Failing.");
    process.exitCode = 1;
  }

  // Skipped when nothing was measured: that already failed above, and
  // "NOT met" against no score would read as a real 0%.
  if (THRESHOLD > 0 && summary.measured > 0) {
    const ok = summary.accuracy >= THRESHOLD;
    console.log(`threshold ${(THRESHOLD * 100).toFixed(1)}% — ${ok ? "met" : "NOT met"}`);
    if (!ok) process.exitCode = 1;
  }

  // Rethrown last, so main().catch prints it and exits 1 as it always has.
  if (crash) throw crash.error;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
