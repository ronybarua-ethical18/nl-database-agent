/**
 * Milestone 2 — safety verification.
 *
 * Proves the three layers actually hold, against the live database, using the
 * same DATABASE_URL the app uses:
 *
 *   layer 1  the SQL guard            -> `npm test`
 *   layer 2  READ ONLY tx + timeout   -> checked here
 *   layer 3  a SELECT-only role       -> checked here
 *
 * Every probe is non-mutating by construction. Privileges are read from
 * catalog functions, and the write attempt inserts `where false` — so even if
 * every layer were broken, this script could not change a row.
 *
 * Run with: npm run check:safety
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: [".env.local", ".env"], quiet: true });

import { runReadOnlyQuery } from "../src/lib/db";
import { TABLES } from "../src/lib/schema";

const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;

let failures = 0;

function report(pass: boolean, label: string, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

  try {
    const [{ current_user: role }] = await sql`select current_user`;
    const [{ current_database: db }] = await sql`select current_database()`;
    console.log(`role: ${role}  database: ${db}\n`);

    // ---- layer 3: the role itself -------------------------------------
    console.log("layer 3 — database role privileges");

    const [owners] = await sql`
      select string_agg(distinct tableowner, ', ') as owners
      from pg_tables where schemaname = 'public'
    `;
    report(
      owners.owners !== null && !String(owners.owners).split(", ").includes(String(role)),
      "app role does not own the tables",
      `tables owned by ${owners.owners}`,
    );

    for (const table of TABLES) {
      const [priv] = await sql`
        select
          has_table_privilege(${table}, 'SELECT')   as can_select,
          has_table_privilege(${table}, 'INSERT')   as can_insert,
          has_table_privilege(${table}, 'UPDATE')   as can_update,
          has_table_privilege(${table}, 'DELETE')   as can_delete,
          has_table_privilege(${table}, 'TRUNCATE') as can_truncate
      `;
      const writable = WRITE_PRIVILEGES.filter(
        (p) => priv[`can_${p.toLowerCase()}` as keyof typeof priv],
      );
      report(priv.can_select === true, `${table}: SELECT granted`);
      report(
        writable.length === 0,
        `${table}: no write privileges`,
        writable.length ? `has ${writable.join(", ")}` : "",
      );
    }

    const [schema] = await sql`
      select
        has_schema_privilege('public', 'CREATE')     as create_in_public,
        has_database_privilege(current_database(), 'CREATE') as create_schema
    `;
    report(schema.create_in_public === false, "cannot CREATE in schema public");
    report(schema.create_schema === false, "cannot CREATE schemas");

    // ---- layer 2: transaction and timeout ------------------------------
    console.log("\nlayer 2 — READ ONLY transaction and statement timeout");

    // Must be read through runReadOnlyQuery: the timeout is applied with SET
    // LOCAL inside that transaction, so a separate client would report 0 and
    // tell us nothing about the path the app actually takes.
    const shown = await runReadOnlyQuery("show statement_timeout");
    const configured = String(shown.rows[0]?.statement_timeout ?? "");
    report(
      configured !== "0" && configured !== "",
      "statement_timeout applies inside the query transaction",
      configured,
    );

    // Inserts zero rows even if it were permitted to run.
    try {
      await runReadOnlyQuery(
        `insert into customers (name, email, country, created_at)
         select name, email, country, created_at from customers where false`,
      );
      report(false, "READ ONLY transaction rejects writes", "the INSERT was accepted");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report(
        /read-only transaction/i.test(message) || /permission denied/i.test(message),
        "READ ONLY transaction rejects writes",
        message.split("\n")[0],
      );
    }

    // Actually prove the timeout fires rather than trusting the setting.
    const startedAt = Date.now();
    try {
      await runReadOnlyQuery("select pg_sleep(30)");
      report(false, "statement timeout aborts long queries", "pg_sleep(30) completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const elapsed = Date.now() - startedAt;
      report(
        /statement timeout/i.test(message),
        "statement timeout aborts long queries",
        `aborted after ${(elapsed / 1000).toFixed(1)}s`,
      );
    }

    console.log(
      failures === 0
        ? "\nAll safety checks passed."
        : `\n${failures} safety check(s) FAILED.`,
    );
  } finally {
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("check:safety failed to run:", err.message ?? err);
  process.exit(1);
});
