# Baseline metrics (pre-router)

> **Status: IN PROGRESS — not a baseline until every row below is filled in.**
> Tracked in [issue #8](https://github.com/ronybarua-ethical18/nl-database-agent/issues/8).

The "before" numbers for the Cost-Optimized Model Router. Measured against the
app exactly as it was on the commit below: same model, same prompts, no retry or
fallback logic beyond the agent's own SQL self-correction loop (max 3 attempts).

| | |
|---|---|
| Date(s) run | _TODO (day 1 / day 2 / day 3)_ |
| Git commit | _TODO — `git rev-parse --short HEAD` on day 1, unchanged across all days_ |
| Provider / model | _TODO — `LLM_PROVIDER` / `LLM_MODEL` from `.env.local`, defaults in `src/lib/llm.ts`_ |
| Eval command | `npm run eval -- --only <batch>` with `EVAL_DELAY_MS=4000`, see `docs/baseline-runs/` |

## How it was run

The Gemini free tier allows roughly 20 questions a day, so the 43-question suite
was run as three disjoint batches on three consecutive days (15 + 14 + 14) with
no code changes between them. Raw output for each day is in
`docs/baseline-runs/day-N.log`. Questions skipped on quota were re-run the next
day; none were dropped. The exact batch commands are on issue #8.

## Results

| Metric | Value | Source / notes |
|---|---|---|
| Model(s) used | _TODO_ | env / code |
| Eval cases run | _TODO_ / 43 | sum of the three logs |
| Result-set accuracy | _TODO_ (passed / 43) | sum of `PASS` lines across logs |
| LLM calls per question — avg | _TODO_ | `(N attempts)` markers; no marker = 1 call |
| LLM calls per question — max | _TODO_ | |
| Self-fix rate | _TODO_ % | questions with `(N attempts)`, N > 1, ÷ 43 |
| Input tokens per question — avg | _TODO_ | provider usage metadata, see caveat 2 |
| Output tokens per question — avg | _TODO_ | |
| End-to-end latency p50 | _TODO_ s | see caveat 2 |
| End-to-end latency p95 | _TODO_ s | |
| Rate-limit errors (429) seen | _TODO_ | `rate limited — waiting` + `SKIP` lines across logs |
| Estimated cost per question at list price | _TODO_ | tokens × model's published paid price |

### Per-day summary

| Day | Date | Questions | Passed | Skipped on quota | 429 waits |
|---|---|---|---|---|---|
| 1 | _TODO_ | 15 | _TODO_ | _TODO_ | _TODO_ |
| 2 | _TODO_ | 14 | _TODO_ | _TODO_ | _TODO_ |
| 3 | _TODO_ | 14 | _TODO_ | _TODO_ | _TODO_ |

### Failed questions

_TODO — list each failing id with the reason from the log, so the router comparison can check whether the same questions fail._

## Caveats

1. **SQL path only.** The eval runs with `explain: false`, so the call counts,
   tokens and latency above exclude the explanation/chart call the app makes
   for every successful answer in production. _TODO: estimate that call from a
   handful of UI runs and note it here._
2. **Tokens and latency are not reported by the runner yet** (issue #11). The
   values above were taken from _TODO: describe how — e.g. N manual runs read
   from the provider's usage metadata_.
3. **Free-tier pacing.** `EVAL_DELAY_MS=4000` adds 4 s between questions. This
   inflates wall-clock time for the run but not per-question latency, which is
   measured inside each question.
