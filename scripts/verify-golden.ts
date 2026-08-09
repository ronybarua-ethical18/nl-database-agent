/**
 * Runs every `expected_sql` in evals/golden.json against the database and
 * prints what it returns.
 *
 * This is not the eval runner — no agent is involved and nothing is graded.
 * It exists so the answer key can be checked by a human before it becomes the
 * definition of "correct". A reference query that is wrong, or that silently
 * returns zero rows, would otherwise make the eval score meaningless: every
 * agent answer would be graded against a bad standard.
 *
 * It also catches the two ways a reference query rots:
 *   - zero rows, usually a filter that no longer matches any seeded data
 *   - a hard-coded date, which drifts as the seed's months move with now()
 *
 * Run with: npm run verify:golden
 */
import { config } from "dotenv";

// Next.js loads `.env.local`, but plain `dotenv/config` reads only `.env`.
config({ path: [".env.local", ".env"], quiet: true });

import { readFileSync } from "node:fs";
import postgres from "postgres";

type Question = {
  id: string;
  question: string;
  tags?: string[];
  expected_sql?: string;
  expect?: "refuse" | "cannot_answer";
};

const HARD_CODED_DATE = /'\d{4}-\d{2}-\d{2}/;

function preview(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no rows)";
  const shown = rows.slice(0, 3).map((row) =>
    Object.entries(row)
      .map(([key, value]) => `${key}=${value}`)
      .join("  "),
  );
  const more = rows.length > 3 ? `\n         ... ${rows.length - 3} more row(s)` : "";
  return shown.join("\n         ") + more;
}

async function main(): Promise<void> {
  const file = JSON.parse(readFileSync("evals/golden.json", "utf8")) as {
    questions: Question[];
  };
  const questions = file.questions;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  const sql = postgres(url, { max: 3 });

  const answerable = questions.filter((q) => q.expected_sql);
  const refusals = questions.filter((q) => q.expect);

  console.log(
    `evals/golden.json — ${questions.length} questions ` +
      `(${answerable.length} answerable, ${refusals.length} expected refusals)\n`,
  );

  let failed = 0;
  let empty = 0;

  for (const q of answerable) {
    const stale = HARD_CODED_DATE.test(q.expected_sql!);
    try {
      const rows = (await sql.unsafe(q.expected_sql!)) as unknown as Record<
        string,
        unknown
      >[];
      if (rows.length === 0) empty++;
      const flag = rows.length === 0 ? "EMPTY" : stale ? "DATE " : "ok   ";
      console.log(`${flag} ${q.id}`);
      console.log(`       Q: ${q.question}`);
      console.log(`       ${preview(rows)}\n`);
    } catch (err) {
      failed++;
      console.log(`ERROR ${q.id}`);
      console.log(`       Q: ${q.question}`);
      console.log(`       ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  for (const q of refusals) {
    console.log(`n/a   ${q.id}  — expects ${q.expect}, no SQL to run`);
    console.log(`       Q: ${q.question}\n`);
  }

  const duplicates = questions
    .map((q) => q.id)
    .filter((id, i, all) => all.indexOf(id) !== i);

  console.log("---");
  console.log(`${answerable.length - failed - empty} reference queries returned rows`);
  if (empty > 0) console.log(`${empty} returned NO rows — check the filter`);
  if (failed > 0) console.log(`${failed} failed to execute`);
  if (duplicates.length > 0) console.log(`duplicate ids: ${duplicates.join(", ")}`);

  await sql.end();
  if (failed > 0 || duplicates.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
