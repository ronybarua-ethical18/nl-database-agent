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
      connection: {
        statement_timeout: STATEMENT_TIMEOUT_MS,
      },
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
 * MAX_ROWS rows. Postgres itself rejects any write here even if one slipped
 * past the static guard.
 */
export async function runReadOnlyQuery(query: string): Promise<QueryResult> {
  const sql = getSql();
  const result = await sql.begin("read only", async (tx) => {
    return await tx.unsafe(query);
  });

  const all = result as unknown as Record<string, unknown>[];
  const truncated = all.length > MAX_ROWS;
  const rows = truncated ? all.slice(0, MAX_ROWS) : all;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows, truncated };
}
