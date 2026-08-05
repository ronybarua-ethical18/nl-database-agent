# Milestone 2 — Safety guardrails

**Estimate:** 1 day · **Roadmap:** milestone 2 of 7

> **Done when** — a "delete everything" style request is refused gracefully and the data is untouched.

Taken before milestones 1 and 3 because the app is already deployed publicly, and because it is the only remaining milestone whose work does not depend on `GOOGLE_GENERATIVE_AI_API_KEY`, which is still empty.

---

## 1. Three layers, and what each one is for

Nothing here trusts the model. Each layer assumes the one above it failed.

| # | Layer | Enforced by | Verified by |
| --- | --- | --- | --- |
| 1 | SQL guard — SELECT-only, single statement, no dangerous functions | `src/lib/sql-guard.ts` | `npm test` (20 cases) |
| 2 | `BEGIN READ ONLY` + statement timeout + 500-row cap | Postgres, via `src/lib/db.ts` | `npm run check:safety` |
| 3 | A role holding `SELECT` and nothing else | Postgres privileges | `npm run check:safety` |

Layer 1 is a denylist, and denylists leak. It exists to give the *agent* a fast, legible error it can correct from — not to be the last line of defence. Layers 2 and 3 are the actual security boundary, because Postgres enforces them regardless of what the model emits.

---

## 2. Two things were broken

Both looked correct in code review. Neither would have been caught without executing them.

### 2.1 The guard rejected valid queries (fixed)

The keyword denylist was matched against the entire query string, including string literals and quoted identifiers. So `where p.name = 'Set of 4 Mugs'` was rejected for containing `set`, and `where name = 'created'` for containing `create`.

This fails in the worst possible way: a guard rejection consumes one of the agent's three retry attempts, so the visible symptom is degraded eval accuracy, not an error anyone would trace back to here.

**Fix:** `stripNonCode()` replaces every string literal, dollar-quoted block, quoted identifier, and comment with whitespace *before* any keyword matching. Word boundaries are preserved, so matching stays accurate. Unterminated literals and comments are now a hard rejection — a validator that disagrees with Postgres about where a string ends is precisely how injection hides.

Two consequences worth noting:

- **Comments are now stripped rather than rejected.** The old guard refused any `--` or `/*`, but models emit explanatory comments routinely despite being told not to, and each refusal burned a retry. Once literals are parsed correctly, a comment cannot execute anything.
- **Semicolons inside literals no longer split the statement.** `where name = 'Robert; drop table students'` is one statement and is now correctly accepted.

The denylist is deliberately broader than strictly necessary. Most entries (`create`, `grant`, `vacuum`, …) can only *begin* a statement, and are therefore already unreachable given the start-anchor and no-semicolon rules. They are kept as defence in depth; the cost is a false positive only on an *unquoted* identifier matching a reserved word, which this schema has none of.

### 2.2 The query timeout never fired (fixed)

`db.ts` passed `connection: { statement_timeout: 8000 }`. postgres.js does forward that in the startup packet — but **Neon's proxy silently drops it**. Measured against the live database:

| Mechanism | `show statement_timeout` | `pg_sleep(20)` |
| --- | --- | --- |
| `connection: { statement_timeout: 8000 }` | `0` | completed after 24.4s |
| URL `?options=-c statement_timeout=8000` | `8s` | — |
| `SET LOCAL` inside the transaction | `8s` | aborted at 7.5s |

So the third bullet of this milestone — *"query timeout so heavy queries can't hang the server"* — was inert, while the code read as though it were solved. On a public endpoint with a 60s function limit, that is a free denial-of-service.

**Fix:** `SET LOCAL statement_timeout` inside the existing READ ONLY transaction. Chosen over the URL parameter because it lives in code rather than in an env var someone must remember to copy, and because `SET LOCAL` is released at `COMMIT` — so it cannot leak onto a neighbouring session's query once `DATABASE_URL` moves to Neon's **pooled** endpoint, where connections are shared.

---

## 3. Why `check:safety` cannot damage anything

Verifying "the role cannot write" by attempting a write is a script that deletes your data on the day it's needed most. Every probe here is non-mutating by construction:

- Privileges are read from `has_table_privilege` / `has_schema_privilege` / `has_database_privilege` — catalog lookups, no DML.
- The one write attempt is `insert into customers … select … where false`. If the layers hold, Postgres rejects it. If every layer were broken, it inserts zero rows.
- The timeout probe is `pg_sleep(30)`, which touches no data.

It exits non-zero on any failure, so it can gate CI in milestone 6.

---

## 4. Status

### Done and verified

| Item | Evidence |
| --- | --- |
| Guard rewritten to analyse code only | `src/lib/sql-guard.ts` |
| Guard test suite | `npm test` — 20/20 pass, no new dependencies (Node 22's runner via tsx) |
| Literal false-positive fixed | `'Set of 4 Mugs'`, `'Delete Me Lamp'`, `'Robert; drop table students'` all accepted |
| Write/DDL rejection | including data-modifying CTEs (`with x as (delete … returning id)`) and `select … into` |
| Server-side file/network functions blocked | `pg_read_file`, `pg_ls_dir`, `lo_import`, `dblink`, `pg_sleep`, `set_config` |
| Statement timeout now actually fires | `npm run check:safety` — applies at `8s`, aborts `pg_sleep(30)` after 9.1s |
| READ ONLY transaction rejects writes | `cannot execute INSERT in a read-only transaction` |
| `npm run check:safety` added | 16 checks; exits non-zero on failure |

### Blocked on you — layer 3 does not exist yet

`npm run check:safety` currently reports **7 failures**, all in layer 3: `DATABASE_URL` is `neondb_owner`, which owns the tables and holds `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on all four.

Run in the Neon SQL Editor as `neondb_owner`:

```sql
CREATE ROLE app_readonly WITH LOGIN PASSWORD '<generate-a-strong-one>';
GRANT CONNECT ON DATABASE neondb TO app_readonly;
GRANT USAGE  ON SCHEMA public  TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
```

Then set `DATABASE_URL` to the `app_readonly` **pooled** string, in both `.env.local` and Vercel:

```
postgres://app_readonly:<password>@ep-cold-glade-ayw2iwo3-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Redeploy, then `npm run check:safety` should report 16/16. Also still outstanding from milestone 0: rotate the `neondb_owner` password, and fill `DATABASE_URL_OWNER` so `npm run seed` works without a shell override.

---

## 5. Not yet provable

The milestone's stated "done when" — *a "delete everything" request is refused gracefully* — is only half testable right now. The refusal machinery exists and is unit-tested at every layer, but the **end-to-end path cannot run** because the agent has no API key, so no such request has ever reached the guard through `askDatabase`.

Note that `agent.ts` has a separate refusal route that bypasses the guard entirely: the system prompt instructs the model to emit `REFUSE: <reason>` for any write request, and that string is matched before validation. That path is model-dependent and therefore the least trustworthy of the four; the guard is what catches it when the model complies with the user instead. Confirm both once the key is set (milestone 0 §3 step 7).
