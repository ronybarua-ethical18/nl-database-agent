import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

/**
 * Both providers have generous free tiers:
 *  - google: Gemini Flash via https://aistudio.google.com
 *  - groq:   Llama via https://console.groq.com
 */
export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? "google";
  if (provider === "groq") {
    return groq(process.env.LLM_MODEL ?? "llama-3.3-70b-versatile");
  }
  return google(process.env.LLM_MODEL ?? "gemini-3.5-flash");
}

/** The provider and model actually in use, for the Settings panel. */
export function describeModel(): { provider: string; model: string } {
  const provider = process.env.LLM_PROVIDER ?? "google";
  const model =
    process.env.LLM_MODEL ??
    (provider === "groq" ? "llama-3.3-70b-versatile" : "gemini-3.5-flash");
  return { provider, model };
}
