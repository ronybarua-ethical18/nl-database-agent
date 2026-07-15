/**
 * Static validation layer for LLM-generated SQL.
 *
 * Defense in depth: this runs BEFORE execution, and every query is also
 * executed inside a `BEGIN READ ONLY` transaction with a statement timeout
 * (see db.ts). Ideally the connection itself uses a read-only role.
 */

const FORBIDDEN_KEYWORDS = [
  // writes
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  "copy",
  // DDL
  "create",
  "drop",
  "alter",
  "truncate",
  "comment",
  "reindex",
  "cluster",
  "vacuum",
  "refresh",
  // permissions / session state
  "grant",
  "revoke",
  "set",
  "reset",
  "security",
  // transaction control / procedural
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "call",
  "do",
  "prepare",
  "execute",
  "deallocate",
  "listen",
  "notify",
  "lock",
  // SELECT INTO creates a table
  "into",
];

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join("|")})\\b`, "i");

export type GuardResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

export function validateSql(raw: string): GuardResult {
  let sql = raw.trim();

  // Allow exactly one trailing semicolon, nothing after it.
  sql = sql.replace(/;\s*$/, "");

  if (sql.length === 0) {
    return { ok: false, reason: "Empty SQL statement." };
  }
  if (sql.includes(";")) {
    return { ok: false, reason: "Multiple SQL statements are not allowed." };
  }
  if (sql.includes("--") || sql.includes("/*")) {
    return { ok: false, reason: "SQL comments are not allowed." };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: "Only SELECT queries are allowed." };
  }

  const match = sql.match(FORBIDDEN_RE);
  if (match) {
    return {
      ok: false,
      reason: `Forbidden keyword "${match[0].toUpperCase()}" — this agent is read-only.`,
    };
  }

  return { ok: true, sql };
}
