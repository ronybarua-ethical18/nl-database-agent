# Roadmap status

Build progress against [`reference/sql-agent-roadmap.pdf`](reference/sql-agent-roadmap.pdf).
This is a working note, not part of the project's public face — the README
describes what the app *is*, this file tracks what is *left*.

- [x] **0 — Skeleton live** — Vercel deploy + seeded Neon database
- [x] **1 — Basic text-to-SQL** — happy path, question → SQL → table
- [x] **2 — Safety guardrails** — static guard, read-only transaction, read-only role
- [x] **3 — Self-correction loop** — retry ≤ 3, every attempt surfaced, honest refusals
- [x] **4 — Answer polish** — explanation, chart, Show SQL, example questions
- [x] **5 — Eval suite** — 43 questions, result-based grading
- [x] **6 — CI gate** — green on the last PR run, with both repository secrets in place
- [ ] **7 — Portfolio polish**

## What milestone 7 still owes

- `docs/media/demo.gif` — 10–15s recording: click an example question, the
  explanation, table and chart land, open "Show SQL". The README has the
  `![...]` line written and commented out, ready to uncomment.
- `docs/media/eval-score.png` — terminal shot of `npm run eval` finishing its
  scorecard. Falls out of the item below.
- **A measured full-suite accuracy figure.** The headline number, and the only
  substantive gap. A complete 43-question run costs 45–130 model calls and the
  Gemini free tier runs dry after roughly 20 questions a day, so it needs
  either a paid key or a run spread across days. Until one exists the README
  says "not yet measured", which is the honest thing for it to say.
- **Pin the repo** on the GitHub profile.

Done already, from the roadmap's milestone 7 list: clean README with a one-line
pitch and live link, the architecture explanation, the ADR, and the repository
description and topics.
