"use client";

// Milestone 1 — the happy path: type a question, POST it to /api/ask, render
// the rows as a plain table.
// Milestone 3 — surface the retry trace and the honest failure message.
// Explanation, chart, and the "Show SQL" toggle remain deliberately absent;
// those are milestone 4.

import { useState, type SubmitEvent } from "react";
// Type-only import, erased at build time — this does not pull the server-side
// database or LLM modules into the client bundle.
import type { AgentResult } from "@/lib/agent";
import AgentTrace from "./AgentTrace";
import ResultTable from "./ResultTable";

type Status = "idle" | "loading" | "done" | "error";

export default function AskPanel() {
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || status === "loading") return;

    setStatus("loading");
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status}).`);
        setStatus("error");
        return;
      }
      setResult(body as AgentResult);
      setStatus("done");
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
      setStatus("error");
    }
  }

  const busy = status === "loading";

  return (
    <div>
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Show the top 5 customers by orders"
          aria-label="Ask a question about the data"
          className="h-11 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-[15px] outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={busy || question.trim().length === 0}
          className="h-11 rounded-xl bg-zinc-900 px-5 text-[15px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="mt-6">
        {busy && (
          <p className="text-sm text-zinc-500">
            Writing SQL and running it against Postgres…
          </p>
        )}

        {status === "error" && error && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </div>
        )}

        {/* Milestone 3 — the retry trace, shown only when an attempt failed. */}
        {status === "done" && result && result.attempts.length > 0 && (
          <AgentTrace attempts={result.attempts} />
        )}

        {/*
          Milestone 3 — when every attempt fails, or the agent refuses a write
          request, say so plainly instead of rendering nothing.
        */}
        {status === "done" && result && !result.ok && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {result.message}
          </div>
        )}

        {status === "done" && result?.ok && (
          <ResultTable
            columns={result.columns ?? []}
            rows={result.rows ?? []}
            truncated={result.truncated}
          />
        )}
      </div>
    </div>
  );
}
