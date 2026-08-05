/**
 * Milestone 2 — guard tests. Run with `npm test` (Node's built-in runner via tsx).
 *
 * The interesting cases are the ones where "does it contain a bad word?" gives
 * the wrong answer: bad words inside data, and semicolons inside data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSql } from "./sql-guard";

function accepts(sql: string) {
  const r = validateSql(sql);
  assert.equal(r.ok, true, `expected accept, got: ${r.ok ? "" : r.reason}`);
  return r;
}

function rejects(sql: string, match?: RegExp) {
  const r = validateSql(sql);
  assert.equal(r.ok, false, "expected reject, but it was accepted");
  if (match && !r.ok) {
    assert.match(r.reason, match);
  }
}

test("accepts ordinary SELECTs", () => {
  accepts("select * from customers");
  accepts("SELECT count(*) FROM orders");
  accepts(`
    select p.name, sum(oi.quantity) as units
    from order_items oi
    join products p on p.id = oi.product_id
    group by p.name
    order by units desc
    limit 5
  `);
});

test("accepts a WITH ... SELECT", () => {
  accepts(`
    with monthly as (
      select date_trunc('month', created_at) as m, count(*) as n
      from orders group by 1
    )
    select m, n from monthly order by m
  `);
});

test("accepts one trailing semicolon", () => {
  accepts("select 1;");
  accepts("select 1;   ");
});

// --- the regression this rewrite exists for -------------------------------

test("keywords inside string literals are data, not code", () => {
  accepts("select * from products where name = 'Set of 4 Mugs'");
  accepts("select * from products where name = 'Delete Me Lamp'");
  accepts("select * from orders where status = 'created'");
  accepts("select * from customers where name like '%Update%'");
  accepts("select 'insert into' as label");
});

test("semicolons inside string literals do not split the statement", () => {
  accepts("select * from customers where name = 'Robert; drop table students'");
  accepts("select ';' as semi");
});

test("escaped quotes inside literals are handled", () => {
  accepts("select * from customers where name = 'O''Brien'");
  accepts("select * from customers where name = 'it''s a set of things'");
  accepts("select E'line\\'s end' as x");
});

test("keywords inside quoted identifiers are allowed", () => {
  accepts('select "set" from products');
  accepts('select o."delete" from orders o');
});

test("comments are stripped, not rejected", () => {
  accepts("-- top products\nselect * from products");
  accepts("select * from products /* inline note */ where price > 10");
  accepts("select * from products -- trailing note\n");
  accepts("select /* nested /* deeper */ still */ 1");
});

// --- writes and DDL -------------------------------------------------------

test("rejects writes", () => {
  rejects("insert into customers (name) values ('x')", /only select/i);
  rejects("update customers set name = 'x'", /only select/i);
  rejects("delete from customers", /only select/i);
  rejects("truncate customers", /only select/i);
  rejects("drop table customers", /only select/i);
});

test("rejects writes hidden in a data-modifying CTE", () => {
  rejects(
    "with gone as (delete from customers returning id) select * from gone",
    /DELETE/i,
  );
  rejects(
    "with added as (insert into products (name) values ('x') returning id) select * from added",
    /INSERT/i,
  );
});

test("rejects SELECT ... INTO, which creates a table", () => {
  rejects("select * into new_customers from customers", /INTO/i);
});

test("rejects row locking", () => {
  rejects("select * from customers for update", /UPDATE/i);
});

test("rejects stacked statements", () => {
  rejects("select 1; drop table customers", /multiple sql statements/i);
  rejects("select 1;;", /multiple sql statements/i);
});

test("rejects anything that does not start as a query", () => {
  rejects("comment on table customers is 'x'", /only select/i);
  rejects("grant select on customers to public", /only select/i);
  rejects("explain analyze select 1", /only select/i);
  rejects("set statement_timeout = 0", /only select/i);
});

test("rejects server-side file and network functions", () => {
  rejects("select pg_read_file('/etc/passwd')", /pg_read_file/i);
  rejects("select pg_sleep(30)", /pg_sleep/i);
  rejects("select set_config('statement_timeout', '0', false)", /set_config/i);
  rejects("select * from dblink('host=x', 'select 1') as t(a int)", /dblink/i);
});

// --- malformed input ------------------------------------------------------

test("rejects unterminated literals and comments", () => {
  rejects("select * from customers where name = 'unclosed", /unterminated string/i);
  rejects('select "unclosed from customers', /unterminated quoted identifier/i);
  rejects("select 1 /* unclosed", /unterminated block comment/i);
  rejects("select $$unclosed", /unterminated dollar-quoted/i);
});

test("rejects dollar-quoted code smuggling", () => {
  // The body is data, so nothing executable remains after stripping.
  rejects("$$ drop table customers $$", /no executable sql/i);
});

test("accepts dollar-quoted strings used as data", () => {
  accepts("select $$it's fine$$ as note");
  accepts("select $tag$ set into delete $tag$ as note");
});

test("rejects empty and comment-only input", () => {
  rejects("", /empty/i);
  rejects("   ", /empty/i);
  rejects("-- just a comment\n", /no executable sql/i);
  rejects("/* nothing */", /no executable sql/i);
});

test("returns SQL with the trailing semicolon removed", () => {
  const r = validateSql("select 1;");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sql, "select 1");
});
