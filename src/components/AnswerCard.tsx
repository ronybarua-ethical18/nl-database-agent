"use client";

// Milestone 4 — the answer card: explanation, stat tiles, chart, table, and a
// collapsed "Show SQL" toggle carrying the retry badge.
//
// Every field here already existed on AgentResult and was being sent to the
// browser unused; this milestone is almost entirely rendering.

import { useState } from "react";
import type { AgentResult } from "@/lib/agent";
import type { Theme } from "@/lib/theme";
import { TERM } from "@/lib/theme";
import { Icon, ICON } from "./Icon";
import ResultChart from "./ResultChart";
import ResultTable from "./ResultTable";
import StatTiles, { deriveTiles } from "./StatTiles";

export default function AnswerCard({
  result,
  theme,
  animate,
}: {
  result: AgentResult;
  theme: Theme;
  animate: boolean;
}) {
  const [showSql, setShowSql] = useState(false);

  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const retries = result.attempts.filter((a) => a.error).length;
  const tiles = deriveTiles(columns, rows);

  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        animation: animate ? "riseIn 0.4s ease both" : "none",
      }}
    >
      {result.explanation ? (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <span style={{ color: theme.accent, flexShrink: 0, marginTop: 2 }}>
            <Icon size={18} path={ICON.spark} />
          </span>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>
            {result.explanation}
          </p>
        </div>
      ) : (
        result.explanationNote && (
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: theme.muted,
            }}
          >
            {result.explanationNote}
          </p>
        )
      )}

      <StatTiles tiles={tiles} theme={theme} />

      {result.chart && (
        <ResultChart
          spec={result.chart}
          rows={rows}
          theme={theme}
          animate={animate}
        />
      )}

      <ResultTable
        columns={columns}
        rows={rows}
        truncated={result.truncated}
        theme={theme}
      />

      {result.sql && (
        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 13,
            marginTop: 13,
          }}
        >
          <button
            onClick={() => setShowSql((v) => !v)}
            aria-expanded={showSql}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: "none",
              border: "none",
              color: theme.muted,
              fontSize: 13,
              cursor: "pointer",
              padding: 0,
              font: "inherit",
            }}
          >
            <span
              style={{
                display: "flex",
                transform: showSql ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <Icon size={14} path={ICON.chevron} />
            </span>
            {showSql ? "Hide SQL" : "Show SQL"}
            {retries > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono), monospace",
                  fontSize: 10.5,
                  color: theme.amber,
                  background: theme.amberSoft,
                  padding: "3px 8px",
                  borderRadius: 20,
                  marginLeft: 4,
                }}
              >
                fixed after {retries} {retries === 1 ? "retry" : "retries"}
              </span>
            )}
          </button>
          {showSql && (
            <pre
              style={{
                margin: "11px 0 0",
                background: TERM.bg,
                color: TERM.ink,
                borderRadius: 11,
                padding: "13px 15px",
                fontFamily: "var(--font-mono), monospace",
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                whiteSpace: "pre",
                border: `1px solid ${theme.border}`,
              }}
            >
              {result.sql}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
