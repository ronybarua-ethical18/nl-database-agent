/**
 * The numbers the eval runner reports, computed from graded cases and the
 * `llm_call` entries `callLlm` emitted while each case ran.
 *
 * Pure, so it is unit-tested (eval-metrics.test.ts) without a model or a
 * database. The definitions match docs/baseline.md, so a run of
 * `npm run eval` is directly comparable against it.
 */
import type { LlmCallLog, LlmStep } from "../src/lib/llm";

export type CaseResult = {
  id: string;
  tags: string[];
  /** "skipped" means the question never produced a gradable answer (quota, outage). */
  status: "pass" | "fail" | "skipped";
  reason?: string;
  /** SQL attempts the agent made for the graded answer (1 = no self-fix). */
  attempts: number;
  /** Question in → `askDatabase` returns, for the graded answer. */
  latencyMs?: number;
  /** The calls behind the graded answer. */
  calls: LlmCallLog[];
  /**
   * Calls from earlier tries the runner threw away (rate limited, provider
   * down). They cost quota and count towards the 429/503 totals, but not
   * towards the per-question numbers.
   */
  discardedCalls: LlmCallLog[];
};

export type StepStats = {
  calls: number;
  failed: number;
  /** Averages over the step's successful calls. */
  avgIn: number;
  avgOut: number;
  avgReasoning: number;
  p50Ms: number | null;
};

export type EvalSummary = {
  cases: number;
  measured: number;
  passed: number;
  skipped: number;
  /** passed / measured; 0 when nothing was measured. */
  accuracy: number;
  callsPerQuestion: { avg: number; max: number };
  /** Measured cases that passed after more than one SQL attempt. */
  selfFixRate: number;
  /**
   * Averages per measured question over successful calls. `out` is every
   * billed output token, thinking included; `reasoning` is the thinking share
   * of it, never to be added on top.
   */
  tokensPerQuestion: { in: number; out: number; reasoning: number };
  latencyMs: { p50: number | null; p95: number | null };
  /** Failed calls whose provider status was 429 / 503, over the whole run. */
  rateLimited429: number;
  unavailable503: number;
  byStep: Partial<Record<LlmStep, StepStats>>;
};

/** Nearest-rank percentile; null for no values (null, not undefined, so it survives JSON). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const avg = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length);

type OkCall = Extract<LlmCallLog, { ok: true }>;
const succeeded = (calls: LlmCallLog[]): OkCall[] =>
  calls.filter((c): c is OkCall => c.ok);

export function summarize(cases: CaseResult[]): EvalSummary {
  const measured = cases.filter((c) => c.status !== "skipped");
  const passed = measured.filter((c) => c.status === "pass").length;

  // Per-question costs average over the cases where the agent was actually
  // asked. A broken answer key is a measured failure, but it made no calls,
  // and averaging its zeros in would understate the cost per question.
  const asked = measured.filter((c) => c.latencyMs !== undefined);
  const perQuestion = (field: "in" | "out" | "reasoning") =>
    avg(asked.map((c) => sum(succeeded(c.calls).map((call) => call[field]))));

  // Failed calls by provider status, over the whole run. This counts calls
  // that ended in a 429, not the runner's waits; a question finally skipped
  // on quota adds one more than the baseline's count of "waiting" lines.
  const allCalls = cases.flatMap((c) => [...c.calls, ...c.discardedCalls]);
  const withStatus = (status: number) =>
    allCalls.filter((c) => !c.ok && c.status === status).length;

  const latencies = asked.map((c) => c.latencyMs as number);

  const measuredCalls = measured.flatMap((c) => c.calls);
  const byStep: Partial<Record<LlmStep, StepStats>> = {};
  // In order of first appearance, which is pipeline order.
  for (const step of new Set(measuredCalls.map((c) => c.step))) {
    const calls = measuredCalls.filter((c) => c.step === step);
    const okCalls = succeeded(calls);
    byStep[step] = {
      calls: calls.length,
      failed: calls.length - okCalls.length,
      avgIn: avg(okCalls.map((c) => c.in)),
      avgOut: avg(okCalls.map((c) => c.out)),
      avgReasoning: avg(okCalls.map((c) => c.reasoning)),
      p50Ms: percentile(okCalls.map((c) => c.ms), 50),
    };
  }

  return {
    cases: cases.length,
    measured: measured.length,
    passed,
    skipped: cases.length - measured.length,
    accuracy: measured.length === 0 ? 0 : passed / measured.length,
    callsPerQuestion: {
      avg: avg(asked.map((c) => c.calls.length)),
      max: Math.max(0, ...asked.map((c) => c.calls.length)),
    },
    selfFixRate:
      measured.length === 0
        ? 0
        : measured.filter((c) => c.status === "pass" && c.attempts > 1).length / measured.length,
    tokensPerQuestion: {
      in: perQuestion("in"),
      out: perQuestion("out"),
      reasoning: perQuestion("reasoning"),
    },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    rateLimited429: withStatus(429),
    unavailable503: withStatus(503),
    byStep,
  };
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
const tokens = (i: number, o: number, r: number) => `${int(i)} in / ${int(o)} out (${int(r)} thinking)`;

/** The printed scorecard: the same metrics as docs/baseline.md. */
export function formatSummary(s: EvalSummary): string[] {
  const lines = [
    `cases: ${s.cases}   measured: ${s.measured}   passed: ${s.passed}   accuracy: ${pct(s.accuracy)}`,
    `llm calls/question: ${s.callsPerQuestion.avg.toFixed(2)} avg, ${s.callsPerQuestion.max} max   self-fix rate: ${pct(s.selfFixRate)}`,
    `tokens/question: ${tokens(s.tokensPerQuestion.in, s.tokensPerQuestion.out, s.tokensPerQuestion.reasoning)}`,
    s.latencyMs.p50 === null
      ? "latency/question: n/a"
      : `latency/question: p50 ${secs(s.latencyMs.p50)}   p95 ${secs(s.latencyMs.p95)}`,
    `429s: ${s.rateLimited429}   503s: ${s.unavailable503}   skipped: ${s.skipped}`,
  ];
  const steps = Object.entries(s.byStep) as [LlmStep, StepStats][];
  if (steps.length > 0) {
    lines.push("by step:");
    for (const [step, st] of steps) {
      lines.push(
        `  ${step.padEnd(16)}${st.calls} ${st.calls === 1 ? "call, " : "calls,"} ${st.failed} failed   ` +
          `${tokens(st.avgIn, st.avgOut, st.avgReasoning)}   p50 ${secs(st.p50Ms)}`,
      );
    }
  }
  return lines;
}

/** A little under the 86% baseline in docs/baseline.md. */
export const DEFAULT_THRESHOLD = 0.8;

/**
 * EVAL_THRESHOLD as a fraction. Unset or blank means the default — an empty
 * CI variable must not quietly switch the gate off. Anything else that is
 * not a number in [0, 1] (say "85", meant as a percentage) is an error for
 * the same reason. "0" is the one way to turn the check off.
 */
export function parseThreshold(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_THRESHOLD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`EVAL_THRESHOLD must be a fraction between 0 and 1, got "${raw}".`);
  }
  return value;
}

/**
 * Codes postgres.js and Node put on `err.code` when the database could not be
 * reached or dropped the connection — Neon waking from idle, mostly. A
 * reference query that fails this way says nothing about the answer key.
 */
const DB_TRANSIENT_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN", // DNS lookup failed for now
  "57P01", // admin_shutdown: the compute is being suspended
  "57P03", // cannot_connect_now: the compute is still starting
]);

export function isDbTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = String((err as Error & { code?: unknown }).code);
  // SQLSTATE class 08: connection exceptions.
  return DB_TRANSIENT_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code);
}
