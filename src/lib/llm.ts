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
