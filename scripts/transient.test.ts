import { test } from "node:test";
import assert from "node:assert/strict";
import { APICallError } from "ai";
import { isDbTransient, isDbTransientMessage, isProviderOutage } from "./transient";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

test("database connection failures are transient; SQL errors are not", () => {
  // postgres.js puts the reason on err.code.
  assert.equal(isDbTransient(withCode("write CONNECT_TIMEOUT host:5432", "CONNECT_TIMEOUT")), true);
  assert.equal(isDbTransient(withCode("read ECONNRESET", "ECONNRESET")), true);
  assert.equal(isDbTransient(withCode('syntax error at or near "SELEC"', "42601")), false);
  assert.equal(isDbTransient("CONNECT_TIMEOUT"), false); // not an error object
  // postgres.js raises CONNECTION_ENDED for a query after sql.end(): a bug in
  // the runner, which waiting cannot fix and must not hide as a skip.
  assert.equal(isDbTransient(withCode("write CONNECTION_ENDED", "CONNECTION_ENDED")), false);
});

test("Postgres connection-class errors and DNS hiccups are transient too", () => {
  // 08xxx: connection exceptions; 57P01/57P03: server shutting down / not
  // yet accepting connections (a Neon compute waking up); EAI_AGAIN: DNS.
  for (const code of ["08006", "08001", "57P01", "57P03", "EAI_AGAIN"]) {
    assert.equal(isDbTransient(withCode(code, code)), true, code);
  }
  // Other class 57 errors are not about reachability: 57014 is a statement
  // timeout, which a broken query can cause.
  assert.equal(isDbTransient(withCode("canceling statement due to statement timeout", "57014")), false);
});

test("an agent attempt's error text reveals a database outage", () => {
  // The agent keeps only err.message on a failed attempt, so the runner has
  // to recognise the outage from the text postgres.js and Node produce.
  for (const message of [
    "write CONNECT_TIMEOUT ep-cold-glade.neon.tech:5432",
    "connect ECONNREFUSED 127.0.0.1:5432",
    "read ECONNRESET",
    "getaddrinfo EAI_AGAIN ep-cold-glade.neon.tech",
    "write CONNECTION_CLOSED ep-cold-glade.neon.tech:5432",
    "terminating connection due to administrator command",
    "the database system is starting up",
  ]) {
    assert.equal(isDbTransientMessage(message), true, message);
  }
});

test("ordinary SQL and guard failures in an attempt are not outages", () => {
  for (const message of [
    'column "revenue" does not exist',
    "Rejected by safety guard: only SELECT is allowed",
    "canceling statement due to statement timeout",
    "The query ran but returned no rows.",
    "write CONNECTION_ENDED host:5432",
  ]) {
    assert.equal(isDbTransientMessage(message), false, message);
  }
});

test("provider outages: 503, overload and network failures reaching the API", () => {
  const unavailable = new APICallError({
    message: "The model is overloaded. Please try again later.",
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode: 503,
  });
  assert.equal(isProviderOutage(unavailable), true);
  assert.equal(isProviderOutage(new TypeError("fetch failed")), true);
  assert.equal(isProviderOutage(new Error("Cannot connect to API: read ECONNRESET")), true);
  assert.equal(isProviderOutage(new Error("API key not valid")), false);
});

test("a database error that escapes the agent is not called a provider outage", () => {
  // Both carry ECONNRESET, but this one came from the database socket (it has
  // the code on the error itself), so it must not be labelled as the provider.
  assert.equal(isProviderOutage(withCode("read ECONNRESET", "ECONNRESET")), false);
});
