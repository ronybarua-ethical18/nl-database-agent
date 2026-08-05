/**
 * Static validation layer for LLM-generated SQL.
 *
 * Defence in depth — this is the outermost of three layers:
 *   1. this guard, before execution
 *   2. `BEGIN READ ONLY` + statement timeout in db.ts, which Postgres enforces
 *      regardless of what slips past here
 *   3. a database role with SELECT and nothing else
 *
 * The guard analyses *code only*. String literals, dollar-quoted blocks,
 * quoted identifiers, and comments are replaced with whitespace before any
 * keyword matching, so a legitimate `where p.name = 'Set of 4 Mugs'` is not
 * rejected for containing "set". That mattered more than it looks: a spurious
 * rejection consumes one of the agent's three retry attempts, which shows up
 * as unexplained accuracy loss rather than as a visible error.
 */

/**
 * Keywords that must never appear in executable code. Matched only against
 * text outside literals/comments, so identifiers and data are unaffected.
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
  "reindex",
  "cluster",
  "vacuum",
  "analyze",
  "refresh",
  // SELECT ... INTO creates a table
  "into",
  // permissions and session state
  "grant",
  "revoke",
  "set",
  "reset",
  // transaction control and procedural execution
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
];

/**
 * Functions that read server files, open outbound connections, or burn wall
 * clock. A non-superuser role cannot call most of these, and the statement
 * timeout bounds pg_sleep, but the check is free.
 */
const FORBIDDEN_FUNCTIONS = [
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "lo_import",
  "lo_export",
  "dblink",
  "pg_sleep",
  "set_config",
];

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join("|")})\\b`, "i");
const FORBIDDEN_FN_RE = new RegExp(`\\b(${FORBIDDEN_FUNCTIONS.join("|")})\\b`, "i");

export type GuardResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

type StripResult = { code: string } | { error: string };

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Replace every non-code region with a single space, preserving word
 * boundaries so keyword matching stays accurate. Returns an error for any
 * unterminated literal or comment, since a parser disagreeing with Postgres
 * about where a string ends is exactly how injection hides.
 */
function stripNonCode(sql: string): StripResult {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- to end of line
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      out += " ";
      i = nl + 1;
      continue;
    }

    // Block comment: /* ... */, nestable in Postgres
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) return { error: "Unterminated block comment." };
      out += " ";
      continue;
    }

    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (ch === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) return { error: "Unterminated dollar-quoted string." };
        out += " ";
        i = close + tag[0].length;
        continue;
      }
    }

    // Single-quoted string literal. '' escapes a quote; E'...' also honours
    // backslash escapes.
    if (ch === "'") {
      const prev = sql[i - 1];
      const escapeString =
        (prev === "E" || prev === "e") && !isWordChar(sql[i - 2]);
      i++;
      let closed = false;
      while (i < sql.length) {
        if (escapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return { error: "Unterminated string literal." };
      // The E prefix is already in `out`; leave it, it is harmless as code.
      out += " ";
      continue;
    }

    // Double-quoted identifier. "" escapes a quote.
    if (ch === '"') {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return { error: "Unterminated quoted identifier." };
      out += " ";
      continue;
    }

    out += ch;
    i++;
  }

  return { code: out };
}

export function validateSql(raw: string): GuardResult {
  let sql = raw.trim();

  if (sql.length === 0) {
    return { ok: false, reason: "Empty SQL statement." };
  }

  const stripped = stripNonCode(sql);
  if ("error" in stripped) {
    return { ok: false, reason: stripped.error };
  }
  let code = stripped.code;

  // Allow exactly one trailing semicolon, and nothing after it.
  const trailing = /;\s*$/;
  if (trailing.test(code)) {
    code = code.replace(trailing, "");
    sql = sql.replace(trailing, "");
  }

  if (code.trim().length === 0) {
    return { ok: false, reason: "No executable SQL statement found." };
  }
  if (code.includes(";")) {
    return { ok: false, reason: "Multiple SQL statements are not allowed." };
  }
  if (!/^\s*(select|with)\b/i.test(code)) {
    return { ok: false, reason: "Only SELECT queries are allowed." };
  }

  const keyword = FORBIDDEN_RE.exec(code);
  if (keyword) {
    return {
      ok: false,
      reason: `Forbidden keyword "${keyword[0].toUpperCase()}" — this agent is read-only.`,
    };
  }

  const fn = FORBIDDEN_FN_RE.exec(code);
  if (fn) {
    return {
      ok: false,
      reason: `Forbidden function "${fn[0].toLowerCase()}" — this agent may only read table data.`,
    };
  }

  return { ok: true, sql };
}
