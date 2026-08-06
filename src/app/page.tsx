import Dashboard from "@/components/Dashboard";
import type { AgentConfig } from "@/components/SettingsPanel";
import { MAX_ATTEMPTS } from "@/lib/agent";
import { MAX_ROWS, STATEMENT_TIMEOUT_MS, runReadOnlyQuery } from "@/lib/db";
import { describeModel } from "@/lib/llm";

/**
 * The dashboard page.
 *
 * Reads the dataset summary and the live database role at request time. The role
 * and its privileges are queried rather than asserted, so the Settings panel
 * reports what is actually true — if DATABASE_URL were ever pointed back at a
 * write-capable account, the panel would say so.
 */

// `cacheComponents` is not enabled, so a page with no dynamic APIs would be
// prerendered at build time and these values frozen at build values.
export const dynamic = "force-dynamic";

async function loadServerState(): Promise<{
  summary: string;
  dbRole: string | null;
  canWrite: boolean | null;
}> {
  try {
    const result = await runReadOnlyQuery(`
      select
        (select count(*) from customers)::int as customers,
        (select count(*) from orders)::int    as orders,
        current_user                         as role,
        (has_table_privilege('customers', 'INSERT')
         or has_table_privilege('customers', 'UPDATE')
         or has_table_privilege('customers', 'DELETE')) as can_write
    `);
    const row = result.rows[0] as {
      customers: number;
      orders: number;
      role: string;
      can_write: boolean;
    };
    return {
      summary: `demo store · ${row.customers.toLocaleString()} customers · ${row.orders.toLocaleString()} orders · ${
        row.can_write ? "read-write" : "read-only"
      }`,
      dbRole: row.role,
      canWrite: row.can_write,
    };
  } catch {
    return { summary: "database unavailable", dbRole: null, canWrite: null };
  }
}

export default async function Home() {
  const [{ summary, dbRole, canWrite }, { provider, model }] = [
    await loadServerState(),
    describeModel(),
  ];

  const config: AgentConfig = {
    provider,
    model,
    maxAttempts: MAX_ATTEMPTS,
    statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    maxRows: MAX_ROWS,
    dbRole,
    canWrite,
  };

  return <Dashboard config={config} datasetSummary={summary} />;
}
