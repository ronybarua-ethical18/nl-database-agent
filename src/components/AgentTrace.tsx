"use client";

// Milestone 3 — makes the self-correction loop visible.
// Milestone 4 — restyled as the reference mock's terminal panel.
//
// An honesty note on the animation. The mock reveals steps 640ms apart as if
// progress streamed in. It does not: /api/ask runs the whole loop server-side
// and returns one JSON payload after 20-70 seconds, so there is no incremental
// signal to render. What is animated here is the *real* attempt list, revealed
// after the fact — every line shown actually happened. Genuine streaming would
// mean turning the route into an event stream, which is its own piece of work.

import { useEffect, useState } from "react";
import type { Attempt } from "@/lib/agent";
import { TERM, type Theme } from "@/lib/theme";

type Step = { tone: "run" | "err" | "fix" | "ok"; text: string };

/** Turns the attempt list into the narration the mock shows. */
export function buildSteps(attempts: Attempt[], ok: boolean): Step[] {
  const steps: Step[] = [
    { tone: "run", text: "Reading database schema" },
    { tone: "run", text: "Writing SQL query" },
  ];

  attempts.forEach((attempt, i) => {
    if (attempt.error) {
      steps.push({ tone: "run", text: "Running query on Postgres" });
      steps.push({ tone: "err", text: `Query failed — ${attempt.error}` });
      if (i < attempts.length - 1) {
        steps.push({ tone: "fix", text: "Reading error, rewriting the query" });
      }
    } else {
      steps.push({ tone: "run", text: "Running query on Postgres" });
    }
  });

  steps.push(
    ok
      ? { tone: "ok", text: "Answer ready" }
      : { tone: "err", text: "Could not resolve the question" },
  );
  return steps;
}

export default function AgentTrace({
  steps,
  theme,
  animate,
}: {
  steps: Step[];
  theme: Theme;
  animate: boolean;
}) {
  // Reset on a new result is handled by the parent giving this component a new
  // `key`, which remounts it — rather than a setState inside the effect.
  const [shown, setShown] = useState(animate ? 0 : steps.length);

  useEffect(() => {
    if (!animate) return;
    const timers = steps.map((_, i) =>
      setTimeout(() => setShown(i + 1), 180 * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps, animate]);

  if (steps.length === 0) return null;

  const dotColor = (tone: Step["tone"]) =>
    tone === "err" || tone === "fix"
      ? theme.amber
      : tone === "ok"
        ? theme.accent
        : TERM.dim;

  return (
    <div
      style={{
        background: TERM.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 13,
        padding: "14px 16px",
        marginBottom: 16,
        fontFamily: "var(--font-mono), monospace",
        fontSize: 12.5,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 11,
          alignItems: "center",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 9, background: "#E06C5A" }} />
        <span style={{ width: 9, height: 9, borderRadius: 9, background: "#E0B34A" }} />
        <span style={{ width: 9, height: 9, borderRadius: 9, background: "#5FB94A" }} />
        <span
          style={{
            marginLeft: 6,
            color: TERM.dim,
            fontSize: 11,
            letterSpacing: "0.05em",
          }}
        >
          agent-trace
        </span>
      </div>

      {steps.slice(0, shown).map((step, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 11,
            padding: "3.5px 0",
            alignItems: "flex-start",
            color: step.tone === "err" ? theme.amber : TERM.ink,
            animation: animate ? "riseIn 0.28s ease both" : "none",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              marginTop: 5,
              borderRadius: 8,
              flexShrink: 0,
              background: dotColor(step.tone),
            }}
          />
          <span style={{ minWidth: 0, overflowWrap: "break-word" }}>
            {step.text}
          </span>
        </div>
      ))}
    </div>
  );
}
