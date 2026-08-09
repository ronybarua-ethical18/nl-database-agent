# Natural-language SQL Agent

Ask a Postgres database questions in plain English — the agent writes the SQL, runs it read-only, fixes its own mistakes, and answers with an explanation, a table, and a chart.

> **Live demo:** [nl-database-agent.vercel.app](https://nl-database-agent.vercel.app) · **Eval accuracy:** _not yet measured — see [Evals](#evals)_

<!-- TODO: GIF demo + eval scorecard screenshot here (milestone 7) -->

## What it does

- **Natural language → SQL** — schema-aware translation via an LLM (Gemini Flash by default, Groq/Llama as an alternative, both through the Vercel AI SDK)
- **Live execution** against Postgres (Neon), with results as stat tiles, a table, and — when the shape suits it — a bar or line chart
- **Self-correction** — a query that fails validation, errors, or returns zero rows is fed back to the model along with the error, and retried up to three times. Every attempt is shown, not just the one that worked
- **It says no** — requests to modify data are refused, and questions the schema genuinely cannot answer return "this database doesn't hold that" rather than a fabricated column or a table of NULLs
- **Safety by construction** — three independent layers, described in [Safety](#safety)
- **History and saved questions** — kept in the browser, so re-running a question is instant and costs no LLM call

## Stack

Next.js 16 (App Router, deployed on Vercel) · Postgres (Neon free tier) · Vercel AI SDK v7 + Gemini Flash / Groq · recharts · zod · TypeScript · Node's built-in test runner

## Architecture

```
Browser (question, examples, history)
        │
        ▼
POST /api/ask ──► agent loop (src/lib/agent.ts)
                    │ 1. LLM generates SQL from question + schema
                    │    ├─ REFUSE:        asked to modify data → stop
                    │    └─ CANNOT_ANSWER: schema lacks the data → stop
                    │ 2. sql-guard validates (SELECT-only, single statement)
                    │ 3. executes in a READ ONLY tx, statement timeout, row cap
                    │ 4. on error/empty → error fed back to the LLM, retry ≤ 3
                    │ 5. LLM writes the explanation and picks a chart spec
                    ▼
        { explanation, rows, columns, chart, sql, attempts }
```

```
src/
  app/
    api/ask/route.ts       # the single API endpoint
    page.tsx               # server component: reads live DB role + privileges
    layout.tsx, globals.css
  components/
    Dashboard.tsx          # app shell: fixed sidebar + scrolling results pane
    AskView.tsx            # question input, examples, answer orchestration
    AnswerCard.tsx         # explanation, Show SQL, copy
    AgentTrace.tsx         # per-attempt trace, including the failed ones
    StatTiles.tsx          # rows, attempts, timing
    ResultTable.tsx        # raw result table
    ResultChart.tsx        # bar/line chart when the result suits one
    HistoryPanel.tsx  SavedPanel.tsx  SettingsPanel.tsx  Icon.tsx
  lib/
    agent.ts               # generate → validate → execute → self-correct loop
    sql-guard.ts           # static SQL validation (defence layer 1)
    sql-guard.test.ts      # its test suite — run with `npm test`
    db.ts                  # read-only tx + timeout + row cap (defence layer 2)
    schema.ts              # single source of truth: DDL + the prose the LLM sees
    llm.ts                 # provider/model selection
    history.ts             # localStorage store for history and saved questions
    use-browser-state.ts   # useSyncExternalStore hooks over that store
    theme.ts  format.ts
scripts/
  seed.ts                  # seeds the demo shop data (faker, deterministic seed)
  check-safety.ts          # asserts the read-only role really is read-only
  eval.ts                  # eval runner → accuracy scorecard
  verify-golden.ts         # executes the answer key so it can be audited
evals/
  golden.json              # golden dataset: 43 questions + reference SQL
.github/workflows/
  eval.yml                 # CI gate: the 9-question subset on every PR
```

## Getting started

1. **Database** — create a free Postgres database on [Neon](https://neon.tech). You need **two roles**: the owner (for seeding) and a SELECT-only role for the app. See [`docs/milestone-2-safety-guardrails.md`](docs/milestone-2-safety-guardrails.md) for the exact grants.
2. **Env** — `cp .env.example .env.local` and fill in both connection strings plus a free [Google AI Studio](https://aistudio.google.com/apikey) (or [Groq](https://console.groq.com/keys)) API key.
3. **Install and seed** — `npm install && npm run seed` fills the demo shop schema (`customers`, `products`, `orders`, `order_items`) with a few thousand realistic rows.
4. **Verify safety** — `npm run check:safety` proves the app's role can read and cannot write.
5. **Run** — `npm run dev` → http://localhost:3000

```bash
npm run dev            # dev server
npm test               # SQL guard unit tests (Node test runner, no deps)
npm run lint           # eslint
npm run check:safety   # live privilege audit against the configured database
npm run seed           # re-seed the demo data
npm run eval           # grade the agent against the golden dataset
npm run verify:golden  # execute the answer key and print what it returns
```

`DATABASE_URL_OWNER` is used **only** by `npm run seed` and must never be set in the deployment environment — the deployed app should hold no credential capable of writing, so that the SQL guard is not the only thing standing between a prompt injection and your data.

## Safety

Three layers, each of which would have to fail independently:

1. **Static guard** (`src/lib/sql-guard.ts`) — strips string literals, dollar-quoted blocks, quoted identifiers and comments before matching keywords, so `'Set of 4 Mugs'` is not mistaken for a `SET` statement. Enforces a single statement, SELECT/WITH only, and rejects a denylist of functions (`pg_read_file`, `dblink`, `pg_sleep`, `set_config`, …).
2. **Read-only transaction** (`src/lib/db.ts`) — every query runs inside `BEGIN READ ONLY` with a statement timeout and a 500-row cap. Postgres rejects a write here even if one slipped past the guard.
3. **Read-only role** — the app connects as a role holding `SELECT` and nothing else. `npm run check:safety` verifies this against the live database: SELECT works on every table, INSERT/UPDATE/DELETE/DDL are all rejected, and the statement timeout actually fires.

## Evals

`npm run eval` sends every question in `evals/golden.json` through the agent and grades it **by result set, not by SQL text**. The agent's query and the reference query both run against the seeded database, and their rows are compared as value tuples — column names are ignored, so aliasing `revenue` as `total_sales` is not a failure. Two very different queries are often both correct, and Postgres decides which is right for free, without an LLM judge and so without a judge's blind spots.

The dataset is 43 questions: aggregates, filters, joins, multi-table rankings, time series, and 5 questions the agent should decline (2 write requests it must refuse, 3 the schema genuinely cannot answer).

```bash
npm run eval                              # all 43
npm run eval -- --tag regression,refusal  # the 9 the CI gate runs
npm run eval -- --only top- --verbose     # iterate on a few, show the SQL
npm run verify:golden                     # execute the answer key, print what it returns
```

`npm run verify:golden` exists because a wrong reference query silently becomes the definition of "correct", and every score built on it would be meaningless. It executes all 38 reference queries and prints their rows so the key can be audited rather than trusted.

**Accuracy is not yet published.** The full suite costs 45–130 model calls and Gemini's free tier runs dry after roughly 20 questions a day, so no complete run has been recorded. The runner reports questions it could not measure as SKIPPED and excludes them from the denominator rather than scoring them as wrong — a partial run must not be mistaken for a good one.

## CI gate

`.github/workflows/eval.yml` runs on every pull request: SQL guard tests, then `verify:golden`, then the eval gate. Cheapest first — there is no point spending quota on the agent if the guard is already broken.

The gate runs **9 questions, not 43**. That is a deliberate consequence of the free tier: a full-suite gate would go red on quota rather than on quality, and a red build that everyone learns to ignore is worse than no gate. The 9 are the `regression` and `refusal` questions — the ones guarding the rules in `SQL_SYSTEM_PROMPT`, which is where a prompt edit does its damage. Run the full suite manually before a release.

Requires two repository secrets: `DATABASE_URL` (the `app_readonly` string — CI has no reason to hold a credential that can write) and `GOOGLE_GENERATIVE_AI_API_KEY`.

The gate deliberately runs the **same provider as the app**. It was built against Groq first, to spare Gemini's quota, on the theory that a rule broken by a prompt edit would break on any model. That was measured and proved false: the same 5 refusal questions score 5/5 on Gemini and 2/5 on Groq, because Llama 3.3 ignores the `CANNOT_ANSWER` and column-restraint rules even when they are present and unmodified. A model capability difference is not a regression, and it left the gate with a permanent floor of 4 failures — a red build that means nothing. At ~12 calls a run the gate costs far less than the full suite, and `EVAL_ALLOW_SKIPPED` covers the outage case.

## Design decisions (ADR)

- **Result-based evals over an LLM judge** — two different SQL strings are often both correct; comparing executed result sets is deterministic, free, and doesn't inherit a judge model's blind spots.
- **An unmeasured question is not a failed one** — the runner marks questions it could not run (provider quota) as SKIPPED and drops them from the denominator. Scoring them as wrong would let an infrastructure outage masquerade as a quality regression, which is the fastest way to make an eval score untrustworthy.
- **A subset in CI, the full suite by hand** — gating on all 43 questions would exceed a free-tier day, so the gate would fail for reasons unrelated to the diff. The 9 questions that guard prompt rules catch the regression that matters at a tenth of the cost. The CI number is a regression signal, not the accuracy figure.
- **The gate runs the same model as the app** — swapping CI to a cheaper provider looked free, since a broken rule "should" break on any model. It isn't: Llama 3.3 ignores `CANNOT_ANSWER` and the column-restraint rule outright, scoring 2/5 on refusals where Gemini scores 5/5. An eval score is only meaningful against another score from the same provider.
- **Read-only at three layers** — any single layer can fail (novel SQL, a guard bypass, a misconfigured grant); all three failing at once is unlikely. The role is the load-bearing one, because it holds even if the application code is wrong.
- **A retry limit (3), not loop-until-success** — most fixable errors resolve in one correction; unbounded retries burn tokens on questions the schema simply can't answer. Past the limit, the honest answer is "I couldn't."
- **Refuse rather than fabricate** — asked for something the schema doesn't hold, an unconstrained model will invent a plausible query like `AVG(NULL::interval)`, which renders as a table of nulls and reads as a real answer. An explicit `CANNOT_ANSWER` path is cheaper and more honest than a wrong answer that looks right.
- **`SET LOCAL statement_timeout`, not a connection parameter** — Neon's proxy silently drops `statement_timeout` from the startup packet. This was measured, not assumed: `show statement_timeout` returned 0 and a `pg_sleep(20)` ran to completion. `SET LOCAL` is also correct for a pooled endpoint, since it is released at `COMMIT` and cannot leak into another session's query.
- **One schema definition** (`src/lib/schema.ts`) — the DDL the seeder executes and the description the LLM reads are built from the same constant, so the prompt cannot drift away from the database.
- **History in localStorage, not a table** — the app's role has no INSERT privilege, so there is nowhere server-side to write. That constraint suits a public demo: each visitor sees only their own questions, and no history endpoint exists to leak them.

## Roadmap status

- [x] 0 — Skeleton live (Vercel deploy + seeded Neon DB)
- [x] 1 — Basic text-to-SQL (happy path)
- [x] 2 — Safety guardrails
- [x] 3 — Self-correction loop
- [x] 4 — Answer polish (explanation + chart + Show SQL + examples)
- [x] 5 — Eval suite
- [x] 6 — CI gate _(written; the done-when — breaking a prompt turns CI red — is unproven until the repository secrets exist)_
- [ ] 7 — Portfolio polish
