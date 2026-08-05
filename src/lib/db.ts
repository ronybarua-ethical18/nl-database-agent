import postgres from "postgres";

const STATEMENT_TIMEOUT_MS = 8_000;
export const MAX_ROWS = 500;

let client: postgres.Sql | undefined;

export function getSql(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    }
    client = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return client;
}

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
};

/**
 * Run a (pre-validated) query inside a READ ONLY transaction, capped at
 * MAX_ROWS rows and bounded by a statement timeout. Postgres itself rejects
 * any write here even if one slipped past the static guard.
 *
 * The timeout is applied with SET LOCAL rather than as a connection parameter:
 * Neon's proxy silently drops `statement_timeout` from the startup packet
 * (measured — `show statement_timeout` returned 0 and a `pg_sleep(20)` ran to
 * completion). SET LOCAL is also the right choice for the pooled endpoint,
 * since it is released at COMMIT and so cannot leak to another session's
 * query on a shared connection. `npm run check:safety` verifies it still
 * fires.
 */
export async function runReadOnlyQuery(query: string): Promise<QueryResult> {
  const sql = getSql();
  const result = await sql.begin("read only", async (tx) => {
    // Interpolated from a module constant, never from user input.
    await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return await tx.unsafe(query);
  });

  const all = result as unknown as Record<string, unknown>[];
  const truncated = all.length > MAX_ROWS;
  const rows = truncated ? all.slice(0, MAX_ROWS) : all;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows, truncated };
}
