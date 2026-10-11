import { beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { callLlm, onLlmCall, type LlmCallLog } from "./llm";

/**
 * callLlm writes one llm_call line per call to stdout. Every test gets a
 * silent console.log, which keeps the test output clean and lets the logging
 * tests read back what was written.
 */
let logged: () => string[] = () => [];
beforeEach((t) => {
  // @types/node types a top-level hook's context as TestContext | SuiteContext;
  // at runtime a beforeEach hook receives the context of the test it runs for.
  const log = (t as TestContext).mock.method(console, "log", () => {});
  logged = () => log.mock.calls.map((c) => String(c.arguments[0]));
});

/**
 * Builds the result shape the V4 model interface expects from doGenerate.
 * Usage is nested here, unlike the flat usage generateText reports back, and
 * `output` is the total including `reasoning`, as the providers report it.
 */
function mockResult(
  text: string,
  usage: { input?: number; output?: number; reasoning?: number } = {},
  finish: "stop" | "length" = "stop",
) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: undefined },
    usage: {
      inputTokens: {
        total: usage.input,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: usage.output,
        text: undefined,
        reasoning: usage.reasoning,
      },
    },
    warnings: [],
  };
}

function mockModel(
  doGenerate: ReturnType<typeof mockResult> | (() => never),
  modelId = "mock-model",
) {
  return new MockLanguageModelV4({ modelId, doGenerate });
}

test("text request: returns the model's text and no output", async () => {
  const model = mockModel(mockResult("SELECT 1"));
  const res = await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.equal(res.text, "SELECT 1");
  assert.equal(res.finishReason, "stop");
  assert.equal("output" in res, false);
});

test("a cut-off answer is returned with finishReason length, not hidden", async () => {
  const model = mockModel(mockResult("SELECT * FROM cust", {}, "length"));
  const res = await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.equal(res.text, "SELECT * FROM cust");
  assert.equal(res.finishReason, "length");
});

test("a cut-off schema answer throws NoOutputGeneratedError", async () => {
  const model = mockModel(mockResult('{"a":', {}, "length"));
  await assert.rejects(
    callLlm({ step: "explanation", prompt: "Q", schema: z.object({ a: z.number() }) }, { model }),
    (err) => NoOutputGeneratedError.isInstance(err),
  );
});

test("instructions and prompt reach the model unchanged", async () => {
  const model = mockModel(mockResult("ok"));
  await callLlm(
    { step: "sql_generation", instructions: "Be terse.", prompt: "Question: how many?" },
    { model },
  );
  const call = model.doGenerateCalls[0];
  const system = call.prompt.find((m) => m.role === "system");
  const user = call.prompt.find((m) => m.role === "user");
  assert.equal(system?.content, "Be terse.");
  assert.deepEqual(user?.content, [{ type: "text", text: "Question: how many?" }]);
});

test("no instructions means no system message, as the explanation call relies on", async () => {
  const model = mockModel(mockResult("ok"));
  await callLlm({ step: "explanation", prompt: "Q" }, { model });
  const call = model.doGenerateCalls[0];
  assert.equal(call.prompt.some((m) => m.role === "system"), false);
  assert.equal(call.prompt.length, 1);
});

test("schema request: parses the output and asks the model for JSON", async () => {
  const model = mockModel(mockResult('{"a":1}'));
  const res = await callLlm(
    { step: "explanation", prompt: "Q", schema: z.object({ a: z.number() }) },
    { model },
  );
  assert.deepEqual(res.output, { a: 1 });
  assert.equal(res.text, '{"a":1}');
  assert.equal(model.doGenerateCalls[0].responseFormat?.type, "json");
});

test("usage is mapped to flat input / output / reasoning counts", async () => {
  // 12 output tokens of which 7 were thinking: outputTokens stays the total.
  const model = mockModel(mockResult("x", { input: 10, output: 12, reasoning: 7 }));
  const res = await callLlm({ step: "sql_fix", prompt: "Q" }, { model });
  assert.deepEqual(res.usage, { inputTokens: 10, outputTokens: 12, reasoningTokens: 7 });
});

test("usage the provider did not report becomes zero, not undefined", async () => {
  const model = mockModel(mockResult("x"));
  const res = await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.deepEqual(res.usage, { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
});

test("reports the model id that answered", async () => {
  const model = mockModel(mockResult("x"), "gemini-test-id");
  const res = await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.equal(res.model, "gemini-test-id");
});

test("records a non-negative latency", async () => {
  const model = mockModel(mockResult("x"));
  const res = await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.ok(Number.isFinite(res.latencyMs));
  assert.ok(res.latencyMs >= 0);
});

test("a provider error propagates as the same object", async () => {
  const boom = new Error("429 Too Many Requests");
  const model = mockModel(() => {
    throw boom;
  });
  await assert.rejects(
    callLlm({ step: "sql_generation", prompt: "Q" }, { model }),
    (err) => err === boom,
  );
});

test("output that does not match the schema throws NoObjectGeneratedError", async () => {
  const model = mockModel(mockResult('{"b":"x"}'));
  await assert.rejects(
    callLlm({ step: "explanation", prompt: "Q", schema: z.object({ a: z.number() }) }, { model }),
    (err) => NoObjectGeneratedError.isInstance(err),
  );
});

/** The llm_call entries the current test has logged, parsed. */
function entries(): Record<string, unknown>[] {
  return logged()
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((e) => e.evt === "llm_call");
}

function apiError(statusCode: number) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}

test("a successful call logs one llm_call line with its metadata", async () => {
  const model = mockModel(mockResult("x", { input: 10, output: 5, reasoning: 3 }));
  await callLlm({ step: "sql_generation", prompt: "Q" }, { model });

  assert.equal(entries().length, 1);
  const { ms, ...rest } = entries()[0];
  assert.deepEqual(rest, {
    evt: "llm_call",
    step: "sql_generation",
    ok: true,
    model: "mock-model",
    in: 10,
    out: 5,
    reasoning: 3,
    finish: "stop",
  });
  assert.equal(typeof ms, "number");
  assert.ok((ms as number) >= 0);
});

test("each call logs its own step", async () => {
  await callLlm({ step: "sql_fix", prompt: "Q" }, { model: mockModel(mockResult("x")) });
  await callLlm(
    { step: "explanation", prompt: "Q", schema: z.object({ a: z.number() }) },
    { model: mockModel(mockResult('{"a":1}')) },
  );
  assert.deepEqual(
    entries().map((e) => e.step),
    ["sql_fix", "explanation"],
  );
});

test("a cut-off answer logs finish length", async () => {
  const model = mockModel(mockResult("SELECT * FROM cust", {}, "length"));
  await callLlm({ step: "sql_generation", prompt: "Q" }, { model });
  assert.equal(entries()[0].finish, "length");
});

test("the log line carries no prompt, instructions, text or output", async () => {
  const model = mockModel(mockResult('{"secret":"ROWDATA_7"}'));
  await callLlm(
    {
      step: "explanation",
      instructions: "INSTRUCTIONS_7",
      prompt: "PROMPT_7",
      schema: z.object({ secret: z.string() }),
    },
    { model },
  );
  const written = logged().join("\n");
  assert.ok(written.includes("llm_call"), "nothing was logged");
  for (const sentinel of ["INSTRUCTIONS_7", "PROMPT_7", "ROWDATA_7", "secret"]) {
    assert.equal(written.includes(sentinel), false, `log leaked ${sentinel}`);
  }
});

test("a failed call is logged with ok false and rethrown unchanged", async () => {
  const boom = new TypeError("PROMPT_ECHO in provider message");
  const model = mockModel(() => {
    throw boom;
  });
  await assert.rejects(
    callLlm({ step: "sql_fix", prompt: "Q" }, { model }),
    (err) => err === boom,
  );

  assert.equal(entries().length, 1);
  const { ms, ...rest } = entries()[0];
  // No token fields: a failed call must not read as a free one. No message:
  // provider messages can echo the prompt.
  assert.deepEqual(rest, {
    evt: "llm_call",
    step: "sql_fix",
    ok: false,
    model: "mock-model",
    error: "TypeError",
  });
  assert.equal(typeof ms, "number");
});

test("a provider HTTP error logs its status", async () => {
  const err503 = apiError(503);
  const model = mockModel(() => {
    throw err503;
  });
  await assert.rejects(
    callLlm({ step: "sql_generation", prompt: "Q" }, { model }),
    (err) => err === err503,
  );
  assert.equal(entries()[0].error, "AI_APICallError");
  assert.equal(entries()[0].status, 503);
});

test("a rate limit that outlasted the SDK's retries logs status 429", async () => {
  const exhausted = new RetryError({
    message: "Failed after 3 attempts",
    reason: "maxRetriesExceeded",
    errors: [apiError(429), apiError(429)],
  });
  const model = mockModel(() => {
    throw exhausted;
  });
  await assert.rejects(callLlm({ step: "explanation", prompt: "Q" }, { model }));
  assert.equal(entries()[0].error, "AI_RetryError");
  assert.equal(entries()[0].status, 429);
});

test("schema failures are logged as failed calls", async () => {
  const schema = z.object({ a: z.number() });
  await assert.rejects(
    callLlm(
      { step: "explanation", prompt: "Q", schema },
      { model: mockModel(mockResult('{"b":"x"}')) },
    ),
  );
  await assert.rejects(
    callLlm(
      { step: "explanation", prompt: "Q", schema },
      { model: mockModel(mockResult('{"a":', {}, "length")) },
    ),
  );
  assert.deepEqual(
    entries().map((e) => [e.ok, e.error]),
    [
      [false, "AI_NoObjectGeneratedError"],
      [false, "AI_NoOutputGeneratedError"],
    ],
  );
});

test("a listener receives every entry that is logged, failures included", async (t) => {
  const seen: LlmCallLog[] = [];
  t.after(onLlmCall((e) => seen.push(e)));

  await callLlm({ step: "sql_generation", prompt: "Q" }, { model: mockModel(mockResult("x")) });
  await assert.rejects(
    callLlm(
      { step: "sql_fix", prompt: "Q" },
      {
        model: mockModel(() => {
          throw new Error("boom");
        }),
      },
    ),
  );

  assert.deepEqual(seen, entries());
  assert.deepEqual(
    seen.map((e) => [e.step, e.ok]),
    [
      ["sql_generation", true],
      ["sql_fix", false],
    ],
  );
});

test("a throwing listener changes neither the result nor the error", async (t) => {
  t.after(
    onLlmCall(() => {
      throw new Error("listener bug");
    }),
  );
  const res = await callLlm(
    { step: "sql_generation", prompt: "Q" },
    { model: mockModel(mockResult("SELECT 1")) },
  );
  assert.equal(res.text, "SELECT 1");

  const boom = new Error("provider down");
  await assert.rejects(
    callLlm(
      { step: "sql_generation", prompt: "Q" },
      {
        model: mockModel(() => {
          throw boom;
        }),
      },
    ),
    (err) => err === boom,
  );
});

test("an unsubscribed listener receives nothing more", async () => {
  const seen: LlmCallLog[] = [];
  const unsubscribe = onLlmCall((e) => seen.push(e));
  await callLlm({ step: "sql_generation", prompt: "Q" }, { model: mockModel(mockResult("x")) });
  unsubscribe();
  await callLlm({ step: "sql_generation", prompt: "Q" }, { model: mockModel(mockResult("x")) });
  assert.equal(seen.length, 1);
  assert.equal(entries().length, 2);
});
