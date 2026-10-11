import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmCallLog, LlmStep } from "../src/lib/llm";
import {
  formatSummary,
  isDbTransient,
  parseThreshold,
  percentile,
  summarize,
  type CaseResult,
} from "./eval-metrics";

function ok(
  step: LlmStep,
  tokens: { in: number; out: number; reasoning: number },
  ms = 1000,
): LlmCallLog {
  return { evt: "llm_call", step, ok: true, model: "m", ms, finish: "stop", ...tokens };
}

function failed(step: LlmStep, status?: number, ms = 500): LlmCallLog {
  return {
    evt: "llm_call",
    step,
    ok: false,
    model: "m",
    ms,
    error: "AI_RetryError",
    ...(status !== undefined && { status }),
  };
}

/** A case the agent was asked (it has a latency) unless it was skipped. */
function kase(over: Partial<CaseResult> & Pick<CaseResult, "status">): CaseResult {
  const asked = over.status !== "skipped";
  return {
    id: "q",
    tags: [],
    attempts: 1,
    calls: [],
    discardedCalls: [],
    ...(asked && { latencyMs: 1000 }),
    ...over,
  };
}

const SQL = { in: 700, out: 500, reasoning: 450 };

test("accuracy counts measured cases only; skipped ones are left out", () => {
  const s = summarize([
    kase({ status: "pass" }),
    kase({ status: "pass" }),
    kase({ status: "fail" }),
    kase({ status: "skipped" }),
  ]);
  assert.equal(s.cases, 4);
  assert.equal(s.measured, 3);
  assert.equal(s.passed, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.accuracy, 2 / 3);
});

test("nothing measured gives zeros, not NaN", () => {
  const s = summarize([kase({ status: "skipped" })]);
  assert.equal(s.accuracy, 0);
  assert.deepEqual(s.callsPerQuestion, { avg: 0, max: 0 });
  assert.equal(s.selfFixRate, 0);
  assert.deepEqual(s.tokensPerQuestion, { in: 0, out: 0, reasoning: 0 });
  assert.deepEqual(s.latencyMs, { p50: null, p95: null });
});

test("llm calls per question: average and max over measured cases", () => {
  const s = summarize([
    kase({ status: "pass", calls: [ok("sql_generation", SQL)] }),
    kase({
      status: "pass",
      attempts: 3,
      calls: [ok("sql_generation", SQL), ok("sql_fix", SQL), ok("sql_fix", SQL)],
    }),
    // A skipped case's calls never count towards the per-question numbers.
    kase({ status: "skipped", calls: [failed("sql_generation", 429)] }),
  ]);
  assert.deepEqual(s.callsPerQuestion, { avg: 2, max: 3 });
});

test("self-fix rate: passed after more than one attempt, over measured cases", () => {
  const s = summarize([
    kase({ status: "pass", attempts: 2 }),
    kase({ status: "fail", attempts: 3 }), // retried, but never fixed
    kase({ status: "pass", attempts: 1 }),
    kase({ status: "pass", attempts: 1 }),
  ]);
  assert.equal(s.selfFixRate, 1 / 4);
});

test("tokens per question sum successful calls; thinking is never added to out", () => {
  const s = summarize([
    kase({
      status: "pass",
      calls: [ok("sql_generation", SQL), failed("sql_fix", 503), ok("sql_fix", SQL)],
    }),
    kase({ status: "fail", calls: [ok("sql_generation", { in: 600, out: 100, reasoning: 50 })] }),
  ]);
  assert.deepEqual(s.tokensPerQuestion, {
    in: (1400 + 600) / 2,
    out: (1000 + 100) / 2,
    reasoning: (900 + 50) / 2,
  });
});

test("percentile is nearest-rank", () => {
  const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6]; // unsorted on purpose
  assert.equal(percentile(values, 50), 5);
  assert.equal(percentile(values, 95), 10);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 50), null);
});

test("latency percentiles are per question, end to end", () => {
  const s = summarize([
    kase({ status: "pass", latencyMs: 4000 }),
    kase({ status: "fail", latencyMs: 6000 }),
    kase({ status: "pass", latencyMs: 5000 }),
    kase({ status: "skipped" }),
  ]);
  assert.deepEqual(s.latencyMs, { p50: 5000, p95: 6000 });
});

test("429s and 503s are counted across measured and discarded calls", () => {
  const s = summarize([
    kase({
      status: "pass",
      calls: [ok("sql_generation", SQL)],
      // Two earlier tries were rate limited and waited out by the runner.
      discardedCalls: [failed("sql_generation", 429), failed("sql_generation", 429)],
    }),
    kase({ status: "skipped", discardedCalls: [failed("sql_generation", 503)] }),
    kase({ status: "fail", calls: [failed("sql_generation")] }), // no status
  ]);
  assert.equal(s.rateLimited429, 2);
  assert.equal(s.unavailable503, 1);
});

test("by step: calls, failures, averages and p50 per step", () => {
  const s = summarize([
    kase({
      status: "pass",
      calls: [
        ok("sql_generation", { in: 700, out: 500, reasoning: 400 }, 3000),
        failed("sql_fix"),
        ok("sql_fix", { in: 900, out: 300, reasoning: 200 }, 2000),
      ],
    }),
    kase({ status: "pass", calls: [ok("sql_generation", { in: 800, out: 300, reasoning: 200 }, 4000)] }),
  ]);
  assert.deepEqual(s.byStep, {
    sql_generation: { calls: 2, failed: 0, avgIn: 750, avgOut: 400, avgReasoning: 300, p50Ms: 3000 },
    sql_fix: { calls: 2, failed: 1, avgIn: 900, avgOut: 300, avgReasoning: 200, p50Ms: 2000 },
  });
});

test("formatSummary prints the baseline metrics", () => {
  const s = summarize([
    kase({ status: "pass", latencyMs: 4600, calls: [ok("sql_generation", SQL, 3400)] }),
    kase({
      status: "fail",
      attempts: 2,
      latencyMs: 5000,
      calls: [ok("sql_generation", SQL, 3000), ok("sql_fix", SQL, 2000)],
      discardedCalls: [failed("sql_generation", 429)],
    }),
  ]);
  assert.deepEqual(formatSummary(s), [
    "cases: 2   measured: 2   passed: 1   accuracy: 50.0%",
    "llm calls/question: 1.50 avg, 2 max   self-fix rate: 0.0%",
    "tokens/question: 1,050 in / 750 out (675 thinking)",
    "latency/question: p50 4.6s   p95 5.0s",
    "429s: 1   503s: 0   skipped: 0",
    "by step:",
    "  sql_generation  2 calls, 0 failed   700 in / 500 out (450 thinking)   p50 3.0s",
    "  sql_fix         1 call,  0 failed   700 in / 500 out (450 thinking)   p50 2.0s",
  ]);
});

test("formatSummary says n/a for latency when nothing was measured", () => {
  const lines = formatSummary(summarize([kase({ status: "skipped" })]));
  assert.ok(lines.includes("latency/question: n/a"));
});

test("database connection failures are transient; SQL errors are not", () => {
  // postgres.js puts the reason on err.code.
  const timeout = Object.assign(new Error("write CONNECT_TIMEOUT host:5432"), {
    code: "CONNECT_TIMEOUT",
  });
  const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const syntax = Object.assign(new Error('syntax error at or near "SELEC"'), { code: "42601" });
  assert.equal(isDbTransient(timeout), true);
  assert.equal(isDbTransient(reset), true);
  assert.equal(isDbTransient(syntax), false);
  assert.equal(isDbTransient("CONNECT_TIMEOUT"), false); // not an error object
});

test("threshold: unset or blank means the default; 0 turns the check off", () => {
  assert.equal(parseThreshold(undefined), 0.8);
  assert.equal(parseThreshold(""), 0.8);
  assert.equal(parseThreshold("  "), 0.8);
  assert.equal(parseThreshold("0"), 0);
  assert.equal(parseThreshold("0.85"), 0.85);
  assert.equal(parseThreshold("1"), 1);
});

test("threshold: anything that is not a number in [0, 1] is an error, not 'off'", () => {
  for (const raw of ["abc", "85", "-0.1", "1.5", "NaN", "Infinity"]) {
    assert.throws(() => parseThreshold(raw), /EVAL_THRESHOLD/, raw);
  }
});

test("Postgres connection-class errors and DNS hiccups are transient too", () => {
  const withCode = (code: string) => Object.assign(new Error(code), { code });
  // 08xxx: connection exceptions; 57P01/57P03: server shutting down / not
  // yet accepting connections (a Neon compute waking up); EAI_AGAIN: DNS.
  for (const code of ["08006", "08001", "57P01", "57P03", "EAI_AGAIN"]) {
    assert.equal(isDbTransient(withCode(code)), true, code);
  }
  // Other class 57 errors are not about reachability: 57014 is a statement
  // timeout, which a broken reference query can cause.
  assert.equal(isDbTransient(withCode("57014")), false);
});

test("a broken answer key fails accuracy but not the per-question averages", () => {
  // BROKEN KEY: graded as a failure, but the agent was never asked, so it
  // has no calls and no latency to average.
  const s = summarize([
    kase({ status: "pass", latencyMs: 4000, calls: [ok("sql_generation", SQL)] }),
    kase({ status: "fail", attempts: 0, latencyMs: undefined }),
  ]);
  assert.equal(s.accuracy, 1 / 2);
  assert.deepEqual(s.callsPerQuestion, { avg: 1, max: 1 });
  assert.deepEqual(s.tokensPerQuestion, SQL);
});

test("a step whose calls all failed has a null p50, which survives JSON", () => {
  const s = summarize([kase({ status: "fail", latencyMs: 100, calls: [failed("sql_generation")] })]);
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.byStep.sql_generation.p50Ms, null);
  assert.equal(round.latencyMs.p95, 100);
});
