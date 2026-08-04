# Natural-language SQL Agent

Ask a Postgres database questions in plain English — the agent writes the SQL, runs it, fixes its own mistakes, and answers with an explanation, a table, and a chart.

> **Live demo:** [nl-database-agent.vercel.app](https://nl-database-agent.vercel.app) · **Eval accuracy:** _coming soon — see [Evals](#evals)_

<!-- TODO: GIF demo + eval scorecard screenshot here (milestone 7) -->

## What it does

- **Natural language → SQL** — schema-aware translation via an LLM (Gemini Flash or Groq through the Vercel AI SDK)
- **Live execution** on Postgres (Neon), results as a table and — when the shape suits it — a recharts chart
- **Self-correction** — failed or empty queries are fed back to the model with the error message and retried (bounded retry limit)
- **Safety by construction** — read-only role, destructive-SQL blocking, single-statement enforcement, query timeout
- **Result-based eval suite** — a golden dataset of questions graded by comparing result sets, with a CI gate that fails the build on regression

## Stack

Next.js (App Router, deployed on Vercel) · Postgres (Neon free tier) · Vercel AI SDK + Gemini Flash / Groq · recharts · TypeScript

## Architecture

```
Browser (question, example buttons)
        │
        ▼
POST /api/ask ──► agent loop (src/lib/agent.ts)
                    │ 1. LLM generates SQL from question + schema
                    │ 2. sql-guard validates (SELECT-only, no writes/DDL)
                    │ 3. executes in a READ ONLY tx with statement timeout
                    │ 4. on error/empty → error fed back to LLM, retry ≤ 3
                    │ 5. LLM writes explanation + picks chart spec
                    ▼
        { explanation, rows, chart, sql, attempts }
```

```
src/
  app/
    api/ask/route.ts    # the single API endpoint
    page.tsx            # UI: input, examples, answer, table, chart, "Show SQL"
  components/
    ResultTable.tsx     # raw result table
    ResultChart.tsx     # bar/line chart when the result suits one
  lib/
    agent.ts            # generate → validate → execute → self-correct loop
    sql-guard.ts        # static SQL validation (defense layer 1)
    db.ts               # read-only tx + timeout + row cap (defense layer 2)
    llm.ts              # provider/model selection
    schema.ts           # the schema description shown to the LLM
scripts/
  seed.ts               # seeds the demo e-commerce data (faker)
  eval.ts               # eval runner → accuracy scorecard
evals/
  golden.json           # golden dataset: question + reference SQL
.github/workflows/
  eval.yml              # CI gate: eval suite on every PR
```

## Getting started

1. **Database** — create a free Postgres database on [Neon](https://neon.tech). Create a **read-only role** for the app (the seed script uses the owner role).
2. **Env** — `cp .env.example .env` and fill in the connection strings and a free [Google AI Studio](https://aistudio.google.com/apikey) (or [Groq](https://console.groq.com/keys)) API key.
3. **Seed** — `npm run seed` fills the demo shop schema (`customers`, `products`, `orders`, `order_items`) with a few thousand realistic rows.
4. **Run** — `npm install && npm run dev` → http://localhost:3000

## Evals

`npm run eval` sends every question in `evals/golden.json` through the agent and grades it **by result set, not by SQL text**: the agent's query and the reference query both run against the seeded database, and their result sets are compared order-insensitively. The runner prints a scorecard (e.g. `37/40 = 92.5%`); CI fails any PR that drops accuracy below the threshold.

## Design decisions (ADR)

- **Result-based evals over an LLM judge** — two different SQL strings are often both correct; comparing executed result sets is deterministic, free, and doesn't inherit a judge model's blind spots.
- **Read-only at three layers** — static keyword guard, `READ ONLY` transaction, and a read-only DB role. Any single layer can fail (novel SQL, guard bypass); all three failing at once is unlikely.
- **A retry limit (3), not a loop-until-success** — most fixable errors resolve in one correction; unbounded retries burn tokens on questions the schema simply can't answer. Past the limit, the honest answer is "I couldn't."

## Roadmap status

- [ ] 0 — Skeleton live (Vercel deploy + seeded Neon DB)
- [ ] 1 — Basic text-to-SQL (happy path)
- [ ] 2 — Safety guardrails
- [ ] 3 — Self-correction loop
- [ ] 4 — Answer polish (explanation + chart + Show SQL + examples)
- [ ] 5 — Eval suite
- [ ] 6 — CI gate
- [ ] 7 — Portfolio polish
