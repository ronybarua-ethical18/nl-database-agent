"use client";

// Milestone 1 + 3 + 4 — the Ask view: sticky input, example questions, the
// agent trace, and the answer card.

import { useEffect, useMemo, useRef, type SubmitEvent } from "react";
import type { AgentResult } from "@/lib/agent";
import type { Theme } from "@/lib/theme";
import { Icon, ICON } from "./Icon";
import AgentTrace, { buildSteps } from "./AgentTrace";
import AnswerCard from "./AnswerCard";

const EXAMPLES = [
  "Show the top 5 products sold last month",
  "Which customers spent the most?",
  "Revenue by category",
];

export type Phase = "idle" | "running" | "done" | "error";

export default function AskView({
  theme,
  animate,
  question,
  setQuestion,
  phase,
  result,
  error,
  onAsk,
}: {
  theme: Theme;
  animate: boolean;
  question: string;
  setQuestion: (q: string) => void;
  phase: Phase;
  result: AgentResult | null;
  error: string | null;
  onAsk: (question: string) => void;
  }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Derived from the result — state would only be a stale copy of it.
  const steps = useMemo(
    () => (result ? buildSteps(result.attempts, result.ok) : []),
    [result],
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [result, error]);

  const busy = phase === "running";

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!busy && question.trim()) onAsk(question.trim());
  }

  return (
    <>
      {/* Sticky input zone */}
      <div
        style={{
          flexShrink: 0,
          padding: "18px 22px 14px",
          borderBottom: `1px solid ${theme.borderSoft}`,
          background: theme.bg,
        }}
      >
        <form onSubmit={submit} style={{ display: "flex", gap: 8, marginBottom: 11 }}>
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "center",
              minWidth: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 13,
                color: theme.faint,
                display: "flex",
              }}
            >
              <Icon size={17} path={ICON.search} />
            </span>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which products sold best last month?"
              aria-label="Ask a question about the data"
              style={{
                width: "100%",
                height: 44,
                border: `1px solid ${theme.border}`,
                borderRadius: 11,
                padding: "0 14px 0 39px",
                fontSize: 14.5,
                font: "inherit",
                background: theme.surface,
                color: theme.ink,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={busy || question.trim().length === 0}
            style={{
              height: 44,
              padding: "0 20px",
              border: "none",
              borderRadius: 11,
              background: busy ? theme.surfaceAlt : theme.accent,
              color: busy ? theme.muted : theme.onAccent,
              fontSize: 14.5,
              fontWeight: 600,
              fontFamily: "var(--font-display), sans-serif",
              cursor: busy ? "default" : "pointer",
              opacity: question.trim().length === 0 && !busy ? 0.55 : 1,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {busy ? (
              "Thinking…"
            ) : (
              <>
                Ask
                <Icon size={16} path={ICON.arrow} />
              </>
            )}
          </button>
        </form>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 12, color: theme.faint }}>Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuestion(example);
                if (!busy) onAsk(example);
              }}
              disabled={busy}
              style={{
                fontSize: 12.5,
                padding: "5px 12px",
                border: `1px solid ${theme.border}`,
                borderRadius: 20,
                background: theme.surface,
                color: theme.ink,
                cursor: busy ? "default" : "pointer",
                font: "inherit",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable results */}
      <div
        ref={scrollRef}
        className="scroll"
        style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px" }}
      >
        {phase === "idle" && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              color: theme.muted,
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 15,
                background: theme.surfaceAlt,
                color: theme.faint,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Icon size={26} path={ICON.spark} />
            </div>
            <div
              style={{
                fontFamily: "var(--font-display), sans-serif",
                fontSize: 17,
                fontWeight: 500,
                color: theme.ink,
                marginBottom: 6,
              }}
            >
              Ask a question to get started
            </div>
            <div style={{ fontSize: 13.5, maxWidth: 320, lineHeight: 1.6 }}>
              Type in plain language and the agent writes the SQL, runs it, and
              fixes its own mistakes before answering.
            </div>
          </div>
        )}

        {busy && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: theme.muted,
              fontSize: 13.5,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 8,
                background: theme.accent,
                animation: animate ? "blink 1s infinite" : "none",
              }}
            />
            Reading the schema, writing SQL, and running it on Postgres…
          </div>
        )}

        {phase === "error" && error && (
          <div
            style={{
              border: `1px solid ${theme.amber}`,
              background: theme.amberSoft,
              borderRadius: 13,
              padding: "14px 16px",
              fontSize: 13.5,
              color: theme.ink,
            }}
          >
            {error}
          </div>
        )}

        {phase === "done" && result && (
          <>
            <AgentTrace
              key={`${result.question}-${result.attempts.length}-${result.ok}`}
              steps={steps}
              theme={theme}
              animate={animate}
            />
            {result.ok ? (
              <AnswerCard result={result} theme={theme} animate={animate} />
            ) : (
              <div
                style={{
                  border: `1px solid ${theme.amber}`,
                  background: theme.amberSoft,
                  borderRadius: 13,
                  padding: "14px 16px",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: theme.ink,
                }}
              >
                {result.message}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
