# Baseline metrics (pre-router)

The "before" numbers for the Cost-Optimized Model Router, measured against the
app exactly as it is today: same model, same prompts, no retry or fallback
logic beyond the agent's own SQL self-correction loop (max 3 attempts).
Tracked in [issue #8](https://github.com/ronybarua-ethical18/nl-database-agent/issues/8).

| | |
|---|---|
| Dates run | 2026-10-07 and 2026-10-08 |
| Git commit | `3fdfc34` for the app code (`src/`), unchanged throughout. `scripts/eval.ts` gained outage handling after the first run crashed on a Gemini 503; the runner is not the system under measurement. |
| Provider / model | `google` / `gemini-3.5-flash` (the defaults in `src/lib/llm.ts`; `LLM_MODEL` unset) |
| Eval command | `EVAL_DELAY_MS=4000 npm run eval -- --only <ids>`, one section per session in `docs/baseline-eval.log` |

## Results

| Metric | Value | Source / notes |
|---|---|---|
| Model(s) used | `gemini-3.5-flash` via `@ai-sdk/google` | env / code |
| Eval cases run | 43 / 43 | `evals/golden.json`, every question measured once |
| Result-set accuracy | **37 / 43 = 86.0%** | first measured result per question, summed over the logs |
| LLM calls per question — avg | 1.09 (47 calls / 43 questions) | SQL path only (eval runs with `explain: false`); `(N attempts)` markers in the logs |
| LLM calls per question — max | 3 | `top-products-last-month` |
| Self-fix rate | 7.0% (3 / 43) | `top-products-by-units` and `regression-paid-price-not-list-price` fixed on attempt 2, `top-products-last-month` on attempt 3 |
| Input tokens per question — avg | ~806 (737 per SQL call × 1.09) | provider `usageMetadata`, sample of 5 SQL calls, see "How tokens and latency were measured" |
| Output tokens per question — avg | ~63 visible + ~519 thinking = ~582 billed | thinking tokens are billed as output on this model |
| End-to-end latency p50 | 4.6 s (SQL path) / 9.8 s (with explanation + chart) | sample of 3 / 2 questions, question in → `askDatabase` returns |
| End-to-end latency p95 | ~5.0 s (SQL path) / ~11.3 s (with explanation) | sample is too small for a true p95; these are the maxima |
| Rate-limit errors (429) seen | 26 waits during the eval runs (+ 3 in the token sample) | `rate limited — waiting` lines across the logs |
| Provider outages (503) seen | 2 | one crashed the first run, one was waited out |
| Estimated cost per question at list price | **$0.0064** (SQL path) / **$0.012** (production path: SQL + explanation) | $1.50 / 1M input, $9.00 / 1M output incl. thinking ([pricing](https://ai.google.dev/gemini-api/docs/pricing), 2026-10-08) |

**Where the cost goes:** on the SQL path 72% of the per-question cost is
thinking tokens, and the explanation/chart call nearly doubles the total while
being the easiest step. Both are the router's opportunity.

### Free-tier note

The free tier allows about **20 requests per project per day** for this model,
measured across three projects. The 43 questions needed three Google Cloud
projects to complete; questions skipped on quota were re-run, never dropped.

### Failed questions

Six questions failed. A `--verbose` re-run (not scored; see
the diagnostics section of `docs/baseline-eval.log`) shows the SQL behind
each, and on that re-run 2 of the 6 passed, so some are nondeterministic.

| Question | What the agent did | What the key expects | Assessment |
|---|---|---|---|
| `electronics-products` | `SELECT name …` | `SELECT name, price …` | Column-choice ambiguity in the question; the prompt's column-restraint rule pushes the minimal answer |
| `top-countries-by-orders` | counted orders `WHERE status != 'cancelled'` | counts all orders | The "exclude cancelled" rule, meant for revenue, applied to an order count. Key and prompt disagree |
| `orders-per-country` | same as above (passed on re-run) | counts all orders | Same cause, nondeterministic |
| `monthly-revenue-6m` | rolling window `NOW() - 6 months` (5 rows) | calendar window, 6 months incl. current (4 rows) | "Last 6 months" is ambiguous |
| `best-revenue-month` | month as a `date_trunc` timestamp | month as `'YYYY-MM'` text | Same month, different representation; the grader compares cell text |
| `new-customers-per-month` | same as above (passed on re-run) | `'YYYY-MM'` text | Same cause, nondeterministic |

None of the six is a wrong number. They are answer-key ambiguities (3), a
prompt-vs-key disagreement on cancelled orders (2) and a grader
representation gap (2, overlapping). Tightening the key and the grader would
likely lift the measured accuracy without changing the agent — but that is a
change to the measurement, so it must be done **before** the router comparison
and both sides re-scored, or not at all. Tracked separately from the router.

## How tokens and latency were measured

The eval runner does not report tokens or latency yet (issue #11). For this
baseline a one-off script wrapped `globalThis.fetch` — which the AI SDK uses
per call — to read Gemini's `usageMetadata` from each response, and timed
`askDatabase` end to end, with no change to the app. Six questions were
sampled (`count-customers`, `revenue-by-category` with explanation on;
`top-customers-by-revenue`, `customers-without-orders`,
`regression-cancelled-excluded` with it off; `refuse-drop-table` hit the quota
and measured nothing). Raw data: the sample section of `docs/baseline-eval.log`.

Per call, averaged:

| Call | n | Input tokens | Output tokens | Thinking tokens | Latency |
|---|---|---|---|---|---|
| SQL generation | 5 | 737 | 58 | 475 | 2.5–3.9 s, p50 3.4 s |
| Explanation + chart | 2 | 159 | 82 | 492 | 3.3–3.7 s |

A retry call carries the failed SQL and error in its prompt, so it is somewhat
larger than 737 input tokens; with a 7% self-fix rate that is within the noise
of this sample.

## Caveats

1. **Small samples for tokens and latency.** Five SQL calls and two explanation
   calls. Good enough for an order of magnitude and for the cost split; not
   good enough for a real p95. Issue #11 makes the runner report these on
   every question.
2. **Accuracy numbers are SQL-path only.** The eval skips the explanation call,
   which cannot change pass/fail. Calls, tokens and cost are reported both
   ways above.
3. **Nondeterminism.** Two of the six failures passed on an immediate re-run.
   Treat accuracy as 86% ± roughly one question, and compare the router against
   this figure over several runs, not one.
4. **Three API keys.** Keys from three free-tier projects under the same
   account were used to get through the quota. The key does not affect the
   model or the output; it affects only which project's quota is consumed.
5. **Pacing.** `EVAL_DELAY_MS=4000` adds 4 s between questions. It inflates the
   wall-clock time of a run, not per-question latency.
