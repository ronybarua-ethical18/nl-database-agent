/**
 * Which failures in an eval run are transient — they measure nothing about
 * the agent, so the runner waits and retries, then skips, instead of grading
 * them. One place, so the network codes the database and the provider share
 * cannot drift apart between two lists.
 *
 * Pure, and unit-tested in transient.test.ts.
 */

/** Node socket and DNS failures, from either the database or the provider. */
const NETWORK_CODES = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"];

/**
 * postgres.js connection failures — Neon waking from idle, mostly.
 * CONNECTION_ENDED is deliberately absent: postgres.js raises it for a query
 * after `sql.end()`, a bug in the runner that waiting cannot fix.
 */
const DB_CODES = ["CONNECT_TIMEOUT", "CONNECTION_CLOSED"];

/**
 * SQLSTATEs for a server that is going away or not up yet: 57P01
 * admin_shutdown (the compute is being suspended), 57P03 cannot_connect_now
 * (it is still starting). Class 08, connection exceptions, is matched by
 * pattern. Other class 57 codes, such as 57014 statement timeout, are not
 * about reachability and stay errors.
 */
const DB_SQLSTATES = ["57P01", "57P03"];

/** The server messages for those two SQLSTATEs, for when only text survives. */
const DB_SQLSTATE_MESSAGES = [
  "terminating connection due to administrator command",
  "the database system is starting up",
  "the database system is not yet accepting connections",
];

const DB_TRANSIENT_CODES = new Set([...NETWORK_CODES, ...DB_CODES, ...DB_SQLSTATES]);

function codeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * A database error, judged by the `code` postgres.js or Node put on it. Used
 * for the reference queries the runner itself sends.
 */
export function isDbTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = codeOf(err);
  return code !== undefined && (DB_TRANSIENT_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code));
}

const DB_TRANSIENT_TEXT = new RegExp(
  [
    `\\b(${[...NETWORK_CODES, ...DB_CODES].join("|")})\\b`,
    ...DB_SQLSTATE_MESSAGES.map((m) => m.replace(/ /g, "\\s+")),
  ].join("|"),
  "i",
);

/**
 * The same judgement from an error message alone. The agent records only
 * `err.message` on a failed SQL attempt, so this is how the runner tells a
 * database outage during the agent's own query from a wrong query.
 */
export function isDbTransientMessage(message: string): boolean {
  return DB_TRANSIENT_TEXT.test(message);
}

const PROVIDER_OUTAGE_TEXT = new RegExp(
  [
    "\\b503\\b",
    "UNAVAILABLE",
    "high demand",
    "overloaded",
    "fetch failed",
    "Cannot connect to API",
    ...NETWORK_CODES.map((c) => `\\b${c}\\b`),
  ].join("|"),
  "i",
);

/**
 * Provider outages that are not quota: 503 UNAVAILABLE ("high demand"), a
 * dropped connection, or the SDK's own retry giving up on either. The agent
 * rethrows these, correctly — in the app they are a generic failure, not the
 * user's doing. In a run they measure nothing about the agent.
 *
 * An error that carries a database connection code itself came from the
 * database socket, not from the provider, so it is not counted here.
 */
export function isProviderOutage(err: unknown): boolean {
  if (isDbTransient(err)) return false;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return PROVIDER_OUTAGE_TEXT.test(text);
}
