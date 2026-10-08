import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { generateText, Output, type FinishReason, type LanguageModel } from "ai";
import type { z } from "zod";

/**
 * The only module that knows which provider is in use.
 *
 * Every model call in the app goes through `callLlm`, so pointing the app at
 * the model router later is a change here (or in env), not in the callers.
 * Each call carries a `step` name: the router's task hint and the dashboard's
 * cost-by-step key. Nothing is logged yet; that is the next task.
 *
 * Both providers have generous free tiers:
 *  - google: Gemini Flash via https://aistudio.google.com
 *  - groq:   Llama via https://console.groq.com
 */
function resolveModel(): { provider: string; model: string } {
  const provider = process.env.LLM_PROVIDER ?? "google";
  const model =
    process.env.LLM_MODEL ??
    (provider === "groq" ? "llama-3.3-70b-versatile" : "gemini-3.5-flash");
  return { provider, model };
}

function getModel(): LanguageModel {
  const { provider, model } = resolveModel();
  return provider === "groq" ? groq(model) : google(model);
}

/** The provider and model actually in use, for the Settings panel. */
export function describeModel(): { provider: string; model: string } {
  return resolveModel();
}

/**
 * What the call is for. `sql_generation` and `sql_fix` are the same prompt
 * shape, but a fix carries the failed SQL and its error and is the better
 * candidate for a stronger model. `explanation` produces the plain-language
 * answer and the chart spec in one call, so there is no separate chart step.
 */
export type LlmStep = "sql_generation" | "sql_fix" | "explanation";

interface LlmBaseRequest {
  step: LlmStep;
  /** System instructions for the model. */
  instructions?: string;
  prompt: string;
}

export interface LlmTextRequest extends LlmBaseRequest {
  schema?: undefined;
}

/** Structured output: the provider is asked for JSON matching the schema. */
export interface LlmObjectRequest<T> extends LlmBaseRequest {
  schema: z.ZodType<T>;
}

export interface LlmUsage {
  inputTokens: number;
  /**
   * Every output token the provider billed, thinking included. Cost is
   * `inputTokens × input price + outputTokens × output price`; nothing else
   * needs adding.
   */
  outputTokens: number;
  /**
   * The thinking share of `outputTokens` (Gemini's thoughtsTokenCount). It is
   * already counted there, so never add the two. Visible output is
   * `outputTokens - reasoningTokens`; on the baseline run thinking was most of
   * the output, which is where a router saves first.
   */
  reasoningTokens: number;
}

export interface LlmTextResponse {
  text: string;
  /**
   * Why the model stopped. "stop" is a complete answer; "length" means the
   * output budget ran out and `text` is cut off mid-way. Callers decide what
   * that means for their step; this module only reports it.
   */
  finishReason: FinishReason;
  /** Counts the provider reported; a count it did not report is 0. */
  usage: LlmUsage;
  /**
   * The model id the provider reported, or the id requested when it reports
   * none (Gemini does not), so today this is the env-selected model. With a
   * router and `LLM_MODEL=auto` it becomes the model the router chose.
   */
  model: string;
  latencyMs: number;
}

export interface LlmObjectResponse<T> extends LlmTextResponse {
  output: T;
}

export interface LlmOptions {
  /** Overrides the env-selected model. Tests inject a mock through this. */
  model?: LanguageModel;
}

export function callLlm(req: LlmTextRequest, opts?: LlmOptions): Promise<LlmTextResponse>;
export function callLlm<T>(
  req: LlmObjectRequest<T>,
  opts?: LlmOptions,
): Promise<LlmObjectResponse<T>>;
export async function callLlm<T>(
  req: LlmTextRequest | LlmObjectRequest<T>,
  opts: LlmOptions = {},
): Promise<LlmTextResponse | LlmObjectResponse<T>> {
  const start = performance.now();
  // Provider errors are deliberately not caught here. Callers decide what a
  // rate limit or a malformed object means for their step.
  const result = await generateText({
    model: opts.model ?? getModel(),
    instructions: req.instructions,
    prompt: req.prompt,
    output: req.schema ? Output.object({ schema: req.schema }) : undefined,
  });

  const response: LlmTextResponse = {
    text: result.text,
    finishReason: result.finishReason,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? 0,
    },
    model: result.finalStep.response.modelId,
    latencyMs: Math.round(performance.now() - start),
  };
  if (!req.schema) return response;
  // generateText has already validated the JSON against the schema (a mismatch
  // throws NoObjectGeneratedError); reading `output` throws
  // NoOutputGeneratedError when the call did not finish with "stop". Both
  // reach the caller unchanged, exactly as when agent.ts called the SDK
  // directly. The cast is safe because `output` is typed from the schema.
  return { ...response, output: result.output as T };
}
