import AskPanel from "@/components/AskPanel";
import { runReadOnlyQuery } from "@/lib/db";

/**
 * Milestone 1 — the ask page.
 *
 * The dataset summary is a deliberate carry-over from the milestone 0 skeleton:
 * it renders only if the deploy can actually reach Neon with the read-only
 * credential, which makes this page its own diagnostic when something in that
 * chain breaks.
 */

// `cacheComponents` is not enabled, so a page with no dynamic APIs would be
// prerendered at build time and these counts would be frozen at build values.
export const dynamic = "force-dynamic";

type Summary =
  | { ok: true; customers: number; products: number; orders: number }
  | { ok: false; error: string };

async function loadSummary(): Promise<Summary> {
  try {
    const result = await runReadOnlyQuery(`
      select
        (select count(*) from customers)::int as customers,
        (select count(*) from products)::int  as products,
        (select count(*) from orders)::int    as orders
    `);
    const row = result.rows[0] as Record<string, number>;
    return {
      ok: true,
      customers: row.customers,
      products: row.products,
      orders: row.orders,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function Home() {
  const summary = await loadSummary();

  return (
    <div className="flex flex-1 justify-center px-6 py-14">
      <main className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Natural-language SQL Agent
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Ask a question in plain English. The agent reads the database schema,
          writes the SQL, and runs it against Postgres.
        </p>

        {summary.ok ? (
          <p className="mt-3 font-mono text-xs text-zinc-500">
            demo store · {summary.customers.toLocaleString()} customers ·{" "}
            {summary.products.toLocaleString()} products ·{" "}
            {summary.orders.toLocaleString()} orders · read-only
          </p>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Could not read from the database.
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-xs text-amber-900/80 dark:text-amber-200/80">
              {summary.error}
            </pre>
            <p className="mt-3 text-amber-900/80 dark:text-amber-200/80">
              Check that <code className="font-mono">DATABASE_URL</code> is set
              and that <code className="font-mono">npm run seed</code> has been
              run.
            </p>
          </div>
        )}

        <div className="mt-8">
          <AskPanel />
        </div>
      </main>
    </div>
  );
}
