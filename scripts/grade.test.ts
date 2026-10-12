import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentResult } from "../src/lib/agent";
import { grade, normalizeCell, sameRows } from "./grade";

const answered = (rows: Record<string, unknown>[]): AgentResult => ({
  ok: true,
  question: "Q",
  rows,
  attempts: [{ sql: "SELECT 1" }],
});

// --- behaviour carried over unchanged from eval.ts ---------------------------

test("column names and column order do not matter", () => {
  assert.ok(sameRows([{ total_sales: "10.00", country: "DE" }], [{ country: "DE", revenue: "10" }]));
});

test("row order does not matter, row count does", () => {
  const a = [{ n: 1 }, { n: 2 }];
  assert.ok(sameRows(a, [{ n: 2 }, { n: 1 }]));
  assert.equal(sameRows(a, [{ n: 1 }]), false);
});

test("numbers compare at 2 decimal places", () => {
  assert.equal(normalizeCell("315.0925"), normalizeCell("315.09"));
  assert.equal(normalizeCell("483242.2600"), normalizeCell(483242.26));
  assert.notEqual(normalizeCell("315.10"), normalizeCell("315.09"));
});

test("NULL is distinct from the text 'null' and from an empty string", () => {
  assert.notEqual(normalizeCell(null), normalizeCell("null"));
  assert.notEqual(normalizeCell(null), normalizeCell(""));
});

test("an extra column fails", () => {
  assert.equal(sameRows([{ name: "A", price: "1.00" }], [{ name: "A" }]), false);
});

// --- months -----------------------------------------------------------------

test("a first-of-month midnight UTC timestamp equals the 'YYYY-MM' month", () => {
  // date_trunc('month', timestamptz) and ::date both arrive like this from
  // postgres.js on a GMT session; to_char(..., 'YYYY-MM') arrives as text.
  assert.equal(normalizeCell(new Date("2026-08-01T00:00:00.000Z")), normalizeCell("2026-08"));
  assert.ok(
    sameRows(
      [{ month: new Date("2026-03-01T00:00:00Z"), revenue: "100.50" }],
      [{ month: "2026-03", revenue: "100.5" }],
    ),
  );
});

test("other timestamps keep their full value", () => {
  // Not a month boundary: still compared exactly.
  assert.notEqual(normalizeCell(new Date("2026-08-02T00:00:00Z")), normalizeCell("2026-08"));
  assert.notEqual(normalizeCell(new Date("2026-08-01T10:30:00Z")), normalizeCell("2026-08"));
  assert.equal(normalizeCell(new Date("2026-08-02T00:00:00Z")), "2026-08-02T00:00:00.000Z");
});

test("a timestamp without time zone is a month too when the runner runs in UTC", () => {
  // postgres.js parses `timestamp` (no zone) as LOCAL time, so on a UTC+6
  // machine date_trunc('month', created_at::timestamp) would land at 18:00
  // the day before. The eval and verify-golden scripts pin TZ=UTC for that.
  const saved = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    assert.equal(normalizeCell(new Date("2026-03-01 00:00:00")), normalizeCell("2026-03"));
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test("different months stay different", () => {
  assert.notEqual(normalizeCell(new Date("2026-07-01T00:00:00Z")), normalizeCell("2026-08"));
});

// --- grading against several accepted answers -------------------------------

const q = { id: "q", question: "Q" };

test("passes when the rows match the main answer", () => {
  assert.deepEqual(grade(q, answered([{ n: 1 }]), [[{ n: 1 }], [{ n: 2 }]]), { pass: true });
});

test("passes when the rows match any accepted alternative", () => {
  assert.deepEqual(grade(q, answered([{ n: 2 }]), [[{ n: 1 }], [{ n: 2 }]]), { pass: true });
});

test("a month answer passes grade() whichever way the agent writes it", () => {
  const key = [[{ month: "2026-03", revenue: "100.00" }]];
  const agent = answered([{ month: new Date("2026-03-01T00:00:00Z"), total: "100" }]);
  assert.deepEqual(grade(q, agent, key), { pass: true });
});

test("no answer rows to compare: only an empty result passes, as before", () => {
  assert.deepEqual(grade(q, answered([]), null), { pass: true });
  assert.deepEqual(grade(q, answered([]), []), { pass: true });
  assert.deepEqual(grade(q, answered([{ n: 1 }]), []), {
    pass: false,
    reason: "expected 0 row(s), agent returned 1",
  });
});

test("a miss on every answer fails, with the reason taken from the main answer", () => {
  assert.deepEqual(grade(q, answered([{ n: 3 }, { n: 4 }]), [[{ n: 1 }], [{ n: 2 }]]), {
    pass: false,
    reason: "expected 1 row(s), agent returned 2",
  });
  assert.deepEqual(grade(q, answered([{ n: 3 }]), [[{ n: 1 }], [{ n: 2 }]]), {
    pass: false,
    reason: "1 row(s) but different values or extra columns",
  });
});

test("refusal questions are graded on the refusal, not on rows", () => {
  const refuse = { ...q, expect: "refuse" as const };
  const declined: AgentResult = { ok: false, question: "Q", attempts: [], refusal: "refuse", message: "no" };
  assert.deepEqual(grade(refuse, declined, null), { pass: true });
  assert.deepEqual(grade(refuse, answered([{ n: 1 }]), null), {
    pass: false,
    reason: "expected refuse, but the agent answered",
  });
  assert.deepEqual(grade(refuse, { ...declined, refusal: "cannot_answer", message: "MSG" }, null), {
    pass: false,
    reason: "expected refuse, got cannot_answer",
    detail: "MSG",
  });
});

test("an answerable question the agent did not answer fails", () => {
  const failed: AgentResult = { ok: false, question: "Q", attempts: [], message: "DB said no" };
  assert.deepEqual(grade(q, failed, [[{ n: 1 }]]), {
    pass: false,
    reason: "agent produced no answer",
    detail: "DB said no",
  });
  assert.deepEqual(grade(q, { ...failed, refusal: "cannot_answer" }, [[{ n: 1 }]]), {
    pass: false,
    reason: "agent declined (cannot_answer) but the question is answerable",
  });
});
