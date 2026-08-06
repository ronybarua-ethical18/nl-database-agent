"use client";

// Milestone 4 (extension) — the Settings view.
//
// Rather than a stub with toggles that do nothing, this shows the guardrails the
// agent actually runs under. Every value is read from the server at request time
// (see src/app/page.tsx) rather than duplicated here, so the panel cannot drift
// from the real configuration — including the database role, queried live, which
// is what makes the "read-only" claim checkable rather than decorative.

import type { Theme } from "@/lib/theme";
import { Icon, ICON } from "./Icon";

export type AgentConfig = {
  provider: string;
  model: string;
  maxAttempts: number;
  statementTimeoutMs: number;
  maxRows: number;
  dbRole: string | null;
  canWrite: boolean | null;
};

export default function SettingsPanel({
  config,
  theme,
}: {
  config: AgentConfig;
  theme: Theme;
}) {
  const rows: { label: string; value: string; note: string }[] = [
    {
      label: "Database role",
      value: config.dbRole ?? "unavailable",
      note:
        config.canWrite === null
          ? "Could not read privileges."
          : config.canWrite
            ? "This role can write. It should hold SELECT only."
            : "Holds SELECT only — writes are refused by Postgres.",
    },
    {
      label: "Query transaction",
      value: "BEGIN READ ONLY",
      note: "Postgres rejects any write, whatever SQL the model produces.",
    },
    {
      label: "Statement timeout",
      value: `${config.statementTimeoutMs / 1000}s`,
      note: "Applied with SET LOCAL inside the transaction, so a heavy query cannot hang the server.",
    },
    {
      label: "Row cap",
      value: config.maxRows.toLocaleString(),
      note: "Results beyond this are truncated before leaving the server.",
    },
    {
      label: "Retry limit",
      value: `${config.maxAttempts} attempts`,
      note: "On a failed or empty query the error is fed back to the model, bounded to this many tries.",
    },
    {
      label: "Model",
      value: `${config.model}`,
      note: `via ${config.provider}. Free tier allows roughly 20 requests a minute.`,
    },
  ];

  return (
    <div
      className="scroll"
      style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginBottom: 6,
        }}
      >
        <span style={{ color: theme.accent, display: "flex" }}>
          <Icon size={17} path={ICON.shield} />
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            fontFamily: "var(--font-display), sans-serif",
          }}
        >
          Guardrails
        </h2>
      </div>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 13,
          color: theme.muted,
          lineHeight: 1.6,
          maxWidth: 560,
        }}
      >
        The agent executes SQL written by a language model in response to
        arbitrary questions. These are the limits it runs under, read live from
        the server. Three of them are enforced by Postgres rather than by
        application code.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13, color: theme.muted }}>
                {row.label}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono), monospace",
                  fontSize: 12.5,
                  color:
                    row.label === "Database role" && config.canWrite
                      ? theme.amber
                      : theme.ink,
                }}
              >
                {row.value}
              </span>
            </div>
            <div style={{ fontSize: 12, color: theme.faint, lineHeight: 1.55 }}>
              {row.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
