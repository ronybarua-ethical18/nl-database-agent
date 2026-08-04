import { runReadOnlyQuery } from "@/lib/db";

/**
 * Milestone 0 skeleton. This deliberately queries the database rather than
 * rendering static text: if these counts appear on the deployed URL, then the
 * build, the env vars, Vercel→Neon connectivity, and the read-only role all
 * work. It is the diagnostic surface for the whole deploy chain.
 *
 * The real ask UI lands in milestone 1 (docs/reference/SqlAgentDashboard.jsx
 * is the visual target for that work).
 */

// `cacheComponents` is not enabled, so a page with no dynamic APIs would be
// prerendered at build time and these counts would be frozen at build values.
export const dynamic = "force-dynamic";

type Health =
  | { ok: true; counts: Record<string, number>; lastMonthUnits: number }
  | { ok: false; error: string };

async function loadHealth(): Promise<Health> {
  try {
    const result = await runReadOnlyQuery(`
      select
        (select count(*) from customers)::int   as customers,
        (select count(*) from products)::int    as products,
        (select count(*) from orders)::int      as orders,
        (select count(*) from order_items)::int as order_items,
        (select coalesce(sum(oi.quantity), 0)
           from orders o
           join order_items oi on oi.order_id = o.id
          where o.created_at >= date_trunc('month', now()) - interval '1 month'
            and o.created_at <  date_trunc('month', now()))::int as last_month_units
    `);
    const row = result.rows[0] as Record<string, number>;
    const { last_month_units, ...counts } = row;
    return { ok: true, counts, lastMonthUnits: last_month_units };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const LABELS: Record<string, string> = {
  customers: "customers",
  products: "products",
  orders: "orders",
  order_items: "order items",
};

export default async function Home() {
  const health = await loadHealth();

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Milestone 0 · skeleton live
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Natural-language SQL Agent
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Ask a Postgres database questions in plain English — the agent writes
          the SQL, runs it, fixes its own mistakes, and answers with an
          explanation, a table, and a chart. The ask interface arrives in
          milestone 1; this page confirms the deploy can reach a seeded
          database.
        </p>

        {health.ok ? (
          <>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(health.counts).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="font-mono text-2xl font-semibold">
                    {value.toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {LABELS[key] ?? key}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <span className="text-zinc-500">Units sold last month: </span>
              <span className="font-mono font-medium">
                {health.lastMonthUnits.toLocaleString()}
              </span>
              {health.lastMonthUnits === 0 && (
                <p className="mt-2 text-amber-600 dark:text-amber-500">
                  No sales recorded for last month — the demo question “top 5
                  products sold last month” will return nothing. Re-run{" "}
                  <code className="font-mono">npm run seed</code>.
                </p>
              )}
            </div>

            <p className="mt-6 font-mono text-xs text-zinc-500">
              connected read-only · queries run in a READ ONLY transaction with
              an 8s statement timeout
            </p>
          </>
        ) : (
          <div className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Could not read from the database.
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-xs text-amber-900/80 dark:text-amber-200/80">
              {health.error}
            </pre>
            <p className="mt-3 text-amber-900/80 dark:text-amber-200/80">
              Check that <code className="font-mono">DATABASE_URL</code> is set
              to the read-only connection string and that{" "}
              <code className="font-mono">npm run seed</code> has been run.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
