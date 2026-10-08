import { test } from "node:test";
import assert from "node:assert/strict";
import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { callLlm } from "./llm";

/**
 * Builds the result shape the V4 model interface expects from doGenerate.
 * Usage is nested here, unlike the flat usage generateText reports back.
 */
function mockResult(
  text: string,
  usage: { input?: number; output?: number; reasoning?: number } = {},
) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
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
  assert.equal("output" in res, false);
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
  const model = mockModel(mockResult("x", { input: 10, output: 5, reasoning: 7 }));
  const res = await callLlm({ step: "sql_fix", prompt: "Q" }, { model });
  assert.deepEqual(res.usage, { inputTokens: 10, outputTokens: 5, reasoningTokens: 7 });
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
