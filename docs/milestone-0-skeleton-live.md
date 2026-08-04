# Milestone 0 — Skeleton live

**Branch:** `milestone-0-skeleton-live` · **Estimate:** 1–2 days · **Roadmap:** milestone 0 of 7

> **Done when** — a `vercel.app` link opens, and Neon holds a seeded database.

---

## 1. Why this milestone is the blocker

The repo was built top-down. The hard parts are already written:

| Already implemented | File |
| --- | --- |
| Agent loop: generate SQL → validate → execute → feed error back → retry ≤3 | `src/lib/agent.ts` |
| Safety guard: SELECT-only, single statement, no comments, keyword denylist | `src/lib/sql-guard.ts` |
| `READ ONLY` transaction, 8s `statement_timeout`, 500-row cap | `src/lib/db.ts` |
| API endpoint with input validation | `src/app/api/ask/route.ts` |
| Schema shown to the LLM | `src/lib/schema.ts` |

**None of it has ever run.** There is no database, so there is no way to know whether any of the above works. Every downstream milestone — the UI, the eval suite, the CI gate — is measuring code that has never executed once.

Milestone 0 is therefore not "boring setup." It is the first execution of the entire system, and it is where the first real bugs will surface.

### What is missing

- `scripts/seed.ts` — a 3-line stub that prints `"seed: not implemented yet"`
- No Neon project, no tables, no rows
- No `.env` (only `.env.example`)
- No read-only database role — the outer layer of the safety story
- `src/app/page.tsx` — still `create-next-app` boilerplate
- `src/app/layout.tsx` — `metadata.title` is still `"Create Next App"`
- Not deployed anywhere

---

## 2. Design decisions

### 2.1 One DDL, two consumers

`SCHEMA_DESCRIPTION` in `src/lib/schema.ts` is the text the LLM sees. If the real tables ever drift from that string, the agent writes SQL against a schema that does not exist — and this fails as *quietly degraded accuracy*, not as a loud error. It is the single most dangerous form of rot in this project.

Rather than defend against drift with discipline or a checker script, remove the possibility: the `CREATE TABLE` statements become one exported constant that **both** the seed script and the LLM prompt consume.

```
src/lib/schema.ts
  ├── SCHEMA_DDL          ← executable Postgres; the only copy of the DDL
  └── SCHEMA_DESCRIPTION  ← SCHEMA_DDL + prose notes, built at module load
                             (used by src/lib/agent.ts)

scripts/seed.ts           ← imports SCHEMA_DDL and executes it
```

This works because the DDL already inside `SCHEMA_DESCRIPTION` is valid Postgres — the inline `--` column notes are real SQL comments. It only needs splitting from the surrounding prose. Zero new tooling, and drift becomes structurally impossible.

### 2.2 Two database roles, not one

The roadmap asks for a read-only connection in milestone 2, but the role must exist before anything connects, so it belongs here.

| Env var | Role | Used by | Privileges |
| --- | --- | --- | --- |
| `DATABASE_URL` | `app_readonly` | the Next.js app, evals | `CONNECT`, `USAGE`, `SELECT` |
| `DATABASE_URL_OWNER` | Neon owner | `npm run seed` only | full |

`DATABASE_URL_OWNER` is **never** added to Vercel. The deployed app has no credential capable of writing, so `sql-guard.ts` stops being the only thing between a prompt injection and the data. The `.env.example` note offering to reuse one URL for both should be removed once the roles exist — it quietly undoes the guarantee.

This also means `scripts/seed.ts` **must not** import `src/lib/db.ts`. That module reads `DATABASE_URL` and wraps every query in `BEGIN READ ONLY`; seeding needs the opposite. The seed script creates its own `postgres()` client from `DATABASE_URL_OWNER`.

### 2.3 Seed data shaped for the questions we intend to ask

Random rows produce a demo where every interesting question returns nothing. The data has to be shaped by the questions in `evals/golden.json` and the example buttons on the landing page.

**Volumes** (~11k rows total — trivial against Neon's 0.5 GB free tier):

| Table | Rows | Notes |
| --- | --- | --- |
| `customers` | 400 | across ~12 countries, so "revenue by country" has a real distribution |
| `products` | 80 | across 6 fixed categories |
| `orders` | 3,000 | spread over the last 18 months |
| `order_items` | ~7,500 | 1–4 per order |

**Dates are anchored to `now()` at seed time, never hardcoded.** The flagship demo question is *"top 5 products sold last month"* — so the seeder must guarantee that the previous calendar month and the current month both contain orders. A seed that happens to leave last month empty turns the headline demo into "no results found."

**Deliberate analytical texture:**

- `order_items.unit_price` usually equals `products.price`, but ~20% of the time it is discounted. This is *why* the column exists, and it makes `revenue = quantity * unit_price` a real calculation rather than a redundant one.
- `orders.status` is weighted by age: old orders are mostly `delivered`, recent ones `pending`/`shipped`, with ~5% `cancelled` throughout. This makes status filters meaningful — and creates a genuine ambiguity (do cancelled orders count toward revenue?) that is useful material for the eval suite later.
- A mild upward trend in order volume over the 18 months, so time-series charts have a shape instead of noise.

`faker.seed(42)` is set for reproducibility. Note this does *not* make eval results stable on its own — the `now()` anchor moves — but it makes "reseed and reproduce the bug" work.

### 2.4 Reseeding is idempotent

`scripts/seed.ts` drops and recreates the four tables on every run. During a project where the schema is still moving, "reseed from scratch" is the operation you actually want, and it keeps the script honest about `SCHEMA_DDL` being executable.

The consequence: table-level grants are destroyed on every reseed. Solved once, with `ALTER DEFAULT PRIVILEGES` (§3.2) — which applies `SELECT` automatically to every table the owner creates from then on, so the grant survives all future reseeds without the seed script knowing anything about roles.

### 2.5 The landing page proves the pipeline

The roadmap allows a `"hello"` page. A slightly better use of the same effort: a server component that queries `select count(*)` from each of the four tables and renders the numbers.

That page renders correctly on the `vercel.app` URL **only if** the deploy succeeded, the env vars are set, Vercel can reach Neon, and the read-only role can actually read. It converts milestone 0's "done when" from *a link opens* into *the whole chain works* — and it is the fastest possible diagnosis when something in that chain breaks later.

---

## 3. Implementation plan

### Step 1 — Neon project and schema wiring

1. Create a Neon project (free tier); note the database name and owner role. **Done** — `neondb` on PostgreSQL 18.4, owner role `neondb_owner`.
2. Fill `DATABASE_URL_OWNER` in `.env.local` with the owner connection string.

> **Env file naming:** this project uses `.env.local`, which Next.js loads automatically. Plain `import "dotenv/config"` reads only `.env`, so `scripts/seed.ts` calls `config({ path: [".env.local", ".env"] })` explicitly. Any future script under `scripts/` (notably milestone 5's eval runner) must do the same or it will see no database URL at all.
3. Refactor `src/lib/schema.ts`: extract the `CREATE TABLE` block into an exported `SCHEMA_DDL`, and rebuild `SCHEMA_DESCRIPTION` from it plus the existing prose header and `Notes:` footer. `src/lib/agent.ts` imports `SCHEMA_DESCRIPTION` and must keep working untouched.

> Use Neon's **pooled** connection string (the `-pooler` host) for `DATABASE_URL`. The app runs serverless, where each invocation may open its own connection; `db.ts` caps the pool at `max: 5`, which behaves well behind the pooler and poorly without it. The seed script is a single long-lived process, so either host works for `DATABASE_URL_OWNER`.

### Step 2 — Read-only role

Run once against the Neon database **as the owner** (Neon SQL Editor or `psql`):

```sql
-- 1. the role the app will use
CREATE ROLE app_readonly WITH LOGIN PASSWORD '<generate-a-strong-one>';
GRANT CONNECT ON DATABASE neondb TO app_readonly;
GRANT USAGE  ON SCHEMA public  TO app_readonly;

-- 2. read access to every table neondb_owner creates from now on.
--    This is what survives `npm run seed` dropping and recreating tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

-- 3. belt and braces, for the tables that already exist
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
```

Then repoint `DATABASE_URL` in `.env.local` to the `app_readonly` **pooled** connection string:

```
postgres://app_readonly:<password>@ep-cold-glade-ayw2iwo3-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require
```

> **Currently `DATABASE_URL` points at `neondb_owner` on the unpooled host** — the deployed app would hold write privileges, making the README's read-only claim false. This step is what makes it true.

Notes:
- `ALTER DEFAULT PRIVILEGES` only affects tables created by the role that ran it — so it must be the same owner role that `npm run seed` connects as.
- Postgres 15+ (which Neon runs) already revokes `CREATE` on `public` from `PUBLIC`, so no extra hardening is needed there.
- Verify the role is genuinely read-only before trusting it (§4, check 2). An `app_readonly` that silently has write access is worse than no role at all, because the safety claim in the README becomes false.

### Step 3 — `scripts/seed.ts`

Replace the stub. Structure:

```
import "dotenv/config"            // already a devDependency
import postgres from "postgres"   // own client from DATABASE_URL_OWNER — NOT src/lib/db.ts
import { faker } from "@faker-js/faker"
import { SCHEMA_DDL } from "../src/lib/schema"

1. fail fast if DATABASE_URL_OWNER is unset
2. faker.seed(42)
3. drop the four tables (reverse FK order, or CASCADE), then execute SCHEMA_DDL
4. generate + bulk-insert: customers → products → orders → order_items
   (FK order matters; capture returned ids to build the children)
5. print a row-count summary per table
6. close the connection so the process exits
```

Implementation notes:

- `sql.unsafe()` executes multi-statement SQL when no parameters are passed — that is how `SCHEMA_DDL` goes in as one call.
- Use postgres.js's bulk-insert helper — `` sql`insert into customers ${sql(rows, "name", "email", "country", "created_at")}` `` — and chunk to ~1,000 rows per statement rather than one row per round trip. Over a network connection to Neon, 11k individual inserts is the difference between a few seconds and several minutes.
- `faker.internet.email()` does not guarantee uniqueness and `customers.email` is `UNIQUE`. Suffix with the row index.
- Confirm the exact faker call signatures against the installed `@faker-js/faker@10.5.0` while implementing — this plan names methods from the v8+ API surface (`person.fullName`, `location.country`, `commerce.productName`, `date.between`, `helpers.weightedArrayElement`, `number.int`) but they were not executed against the installed version.

### Step 4 — Landing page and metadata

1. Replace `src/app/page.tsx` with the row-count health page (§2.5). Keep it plain — the real UI is milestone 1/4, and `docs/reference/SqlAgentDashboard.jsx` is the visual target for that work, not this one.
2. Fix `src/app/layout.tsx`: `metadata.title` / `description` currently say `"Create Next App"`. This is the browser tab title on the live link.
3. The page must render at request time, not build time. An async server component doing non-`fetch` I/O is not automatically dynamic, so the counts would otherwise be frozen at whatever they were during `next build`. Check `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` and `09-revalidating.md` for this version's opt-out — `export const dynamic = "force-dynamic"` and `await connection()` from `next/server` are the candidates. **This version of Next has breaking changes from prior releases (see `AGENTS.md`); confirm rather than assume.**
4. Handle the unset-env and connection-failure cases with a readable message. This page is the deploy's diagnostic surface — it should say *what* broke.

### Step 5 — Move the reference files out of `public/`

`public/sql-agent-roadmap.pdf` and `public/SqlAgentDashboard.jsx` are currently untracked, and everything in `public/` is served publicly by Next. Committing them there publishes the build roadmap and design mock at `https://<app>.vercel.app/sql-agent-roadmap.pdf`.

Move both to `docs/reference/` before the first commit.

### Step 6 — Deploy

1. Push the branch; import the repo into Vercel (framework auto-detects).
2. Environment variables in the Vercel project:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `app_readonly` **pooled** connection string |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | free key from `aistudio.google.com/apikey` |
   | `LLM_PROVIDER` | `google` |

   Do **not** set `DATABASE_URL_OWNER`.
3. Confirm the live URL renders the row counts from Neon.
4. Put the live link in the README, replacing `_coming soon (Vercel)_`.

### Step 7 — First real run of the agent (the actual payoff)

Milestone 0 technically ends at step 6, but the reason to do it is to finally exercise `agent.ts`. Before opening milestone 1:

```bash
curl -s localhost:3000/api/ask -H 'content-type: application/json' \
  -d '{"question":"Show the top 5 products sold last month"}' | jq
```

Then a write attempt (`"delete all customers"`) and a nonsense question. Record what happens in the milestone 1 notes — the `attempts[]` array in the response is a full trace of the retry loop.

---

## 4. Acceptance checklist

1. **Seed runs clean.** `npm run seed` prints a per-table row-count summary and exits 0. Running it twice in a row succeeds both times.
2. **The read-only role is actually read-only.** Connected as `app_readonly`:
   ```sql
   SELECT count(*) FROM customers;                        -- succeeds
   DELETE FROM customers WHERE id = 1;                    -- must fail: permission denied
   CREATE TABLE t (x int);                                -- must fail
   ```
   Re-run this check *after* a reseed, to confirm `ALTER DEFAULT PRIVILEGES` did its job.
3. **Last month has data.** `select count(*) from orders where created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now())` returns a healthy number, not 0.
4. **Schema matches the prompt.** The live `information_schema.columns` for the four tables agrees with `SCHEMA_DESCRIPTION` on every column name and type.
5. **Local page works.** `npm run dev` → `localhost:3000` shows four non-zero counts.
6. **Live page works.** The `vercel.app` URL shows the same counts.
7. **Counts are live, not baked.** Reseed with different volumes, reload the deployed page (no redeploy), and confirm the numbers change.
8. **`npm run build` and `npm run lint` pass.**
9. **No secrets or reference docs committed.** `git status` clean; `public/` contains only the Next.js SVGs.

---

## 5. Known risks

**`sql-guard.ts` matches its keyword denylist against string literals too.** A legitimate `where p.name = 'Set of 4 Mugs'` would be rejected on `set`; `into`, `call`, `comment`, and `do` carry the same exposure.

Measured against the seeded data, this is **narrower than first assumed**: zero of the 80 generated product names contain a denylist word, because `faker.commerce.productName()` draws from a fixed adjective/material/product vocabulary that excludes them. The residual exposure is a user question that pushes one of those words into a string literal, which is uncommon. Still worth fixing in milestone 2, because a guard rejection silently consumes one of three retry attempts — the symptom is unexplained accuracy loss in the eval suite, not a visible error. The cheapest fix, given the read-only role (§2.2) and the `READ ONLY` transaction already in `db.ts`, is to narrow the denylist to what those two layers do not already cover.

**`gemini-3.5-flash` is hardcoded as the default** in `src/lib/llm.ts`, and the model ID is **still unverified**. The first agent run returned `403 PERMISSION_DENIED` ("unregistered callers") because `GOOGLE_GENERATIVE_AI_API_KEY` is empty — and a missing-auth 403 is returned *before* the model name is resolved, so a bad model ID would still be hiding behind it. Re-check once the key is set.

**Neon free tier suspends idle compute.** The first request after a quiet period pays a cold-start reconnect. `db.ts` sets `connect_timeout: 10`, which should absorb it, but a first-load timeout on the deployed page is this, not a bug.

**Vercel function duration.** `src/app/api/ask/route.ts` declares `maxDuration = 60`. A worst-case run is up to 4 LLM calls (3 SQL attempts + 1 explanation) plus query time. Confirm the deployed plan actually permits 60s once milestone 1's UI starts exercising the retry path.

---

## 6. Status

### Done and verified

| Item | Evidence |
| --- | --- |
| `SCHEMA_DDL` / `SCHEMA_DESCRIPTION` split (§2.1) | `src/lib/schema.ts`; `tsc --noEmit` and `next build` clean |
| `scripts/seed.ts` implemented | run against `neondb`: 400 customers, 80 products, 3,000 orders, 5,716 order items |
| Date buckets correct across edge cases | 19 buckets, sum exactly 3,000, verified for year-underflow, leap day, and first-of-month |
| Every month populated | 19 months `2025-02`…`2026-08`, **0 empty months** |
| Last month has data (check 3) | 419 order lines, 629 units — top-5 has a clear winner at 98 vs 63 units, so the answer is stable |
| Referential/time integrity | **0** orders predating their customer's signup; no non-positive quantities or prices |
| Data texture as designed | 5 statuses, 12 countries, 6 categories, 19.7% of lines discounted (target 20%) |
| Landing page renders live data (checks 5, 7) | served at `localhost:3000` showing 400 / 80 / 3,000 / 5,716 / 629 |
| Counts are dynamic, not baked | `next build` reports `/` as `ƒ (Dynamic)`; `force-dynamic` confirmed correct for this Next version (`cacheComponents` is not enabled) |
| Build and lint (check 8) | `next build` and `eslint` both clean |
| Reference files out of `public/` (§3 step 5) | moved to `docs/reference/`; `public/` holds only the Next.js SVGs |
| Metadata fixed | was `"Create Next App"` |
| faker API confirmed against 10.5.0 | method signatures read from the installed `.d.ts`, not assumed |

`order_items` came in at 5,716 rather than the estimated ~7,500: duplicate-product lines within an order are skipped rather than resampled, and the Zipf popularity curve makes collisions common. This is expected behaviour, not a defect.

### Blocked on you

1. **`GOOGLE_GENERATIVE_AI_API_KEY` is empty** in `.env.local` — the agent cannot run at all. Free key: `aistudio.google.com/apikey`. This blocks §3 step 7 and everything in milestone 1.
2. **`DATABASE_URL_OWNER` is still the `.env.example` placeholder** (`owner@host/dbname`). The seed above ran via a one-off shell override; `npm run seed` will fail with `EAI_AGAIN host` until this holds the real `neondb_owner` string.
3. **The read-only role does not exist** (§3 step 2). Only `neondb_owner` and Neon's built-in roles are present, and `DATABASE_URL` currently uses `neondb_owner`. Acceptance check 2 cannot pass yet.
4. **Not deployed** (§3 step 6). No Vercel project, so the "done when" is unmet and the README's live-demo line still says *coming soon*.

## 7. Out of scope

The ask UI and result table (milestone 1), explanation/chart rendering (milestone 4), the golden dataset and eval runner (milestone 5), the CI gate (milestone 6), README GIF and ADR (milestone 7). Fixing the `sql-guard.ts` denylist belongs to milestone 2.
