// Milestone 3 — makes the self-correction loop visible.
//
// agent.ts already retries: on a failed or empty query it feeds the error back
// to the model and tries again, up to MAX_ATTEMPTS. Every attempt lands in
// `attempts[]`, but nothing rendered it — so a question that only succeeded on
// the second try looked identical to one that worked first time. This is the
// milestone's "visibly shows the agent erroring first, then self-correcting".

import type { Attempt } from "@/lib/agent";

export default function AgentTrace({ attempts }: { attempts: Attempt[] }) {
  const failed = attempts.filter((a) => a.error).length;

  // Nothing interesting happened — the first query worked.
  if (failed === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-3 font-mono text-xs tracking-wide text-zinc-500 uppercase">
        agent trace · {failed} failed {failed === 1 ? "attempt" : "attempts"}
      </p>
      <ol className="space-y-2">
        {attempts.map((attempt, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                attempt.error ? "bg-amber-500" : "bg-emerald-500"
              }`}
            />
            <span className="min-w-0">
              <span className="text-zinc-500">Attempt {i + 1} — </span>
              {attempt.error ? (
                <>
                  <span className="text-amber-700 dark:text-amber-500">
                    failed
                  </span>
                  <span className="mt-0.5 block font-mono text-xs wrap-break-word text-zinc-600 dark:text-zinc-400">
                    {attempt.error}
                  </span>
                </>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-500">
                  succeeded
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
