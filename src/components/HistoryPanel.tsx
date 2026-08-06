"use client";

// Milestone 4 (extension) — the History view.
//
// Entries come from localStorage and carry their full cached AgentResult, so
// opening one restores the answer instantly and costs no LLM call.

import type { HistoryEntry } from "@/lib/history";
import { relativeTime } from "@/lib/history";
import { useNow } from "@/lib/use-browser-state";
import type { Theme } from "@/lib/theme";
import { Icon, ICON } from "./Icon";

function EmptyState({
  theme,
  icon,
  title,
  body,
}: {
  theme: Theme;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
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
        <Icon size={26} path={icon} />
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
        {title}
      </div>
      <div style={{ fontSize: 13.5, maxWidth: 320, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

export default function HistoryPanel({
  entries,
  theme,
  onOpen,
  onRemove,
  onClear,
}: {
  entries: HistoryEntry[];
  theme: Theme;
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const now = useNow();

  if (entries.length === 0) {
    return (
      <div style={{ flex: 1, padding: "18px 22px 24px" }}>
        <EmptyState
          theme={theme}
          icon={ICON.history}
          title="No history yet"
          body="Questions you ask are kept in this browser, along with their answers, so you can reopen them without re-running the query."
        />
      </div>
    );
  }

  return (
    <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 13, color: theme.muted }}>
          {entries.length} question{entries.length === 1 ? "" : "s"}, stored in
          this browser
        </span>
        <button
          onClick={onClear}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            color: theme.muted,
            fontSize: 12.5,
            cursor: "pointer",
            font: "inherit",
            padding: 0,
          }}
        >
          Clear all
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <button
              onClick={() => onOpen(entry)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: theme.ink,
                font: "inherit",
                padding: 0,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.question}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: theme.faint,
                  fontFamily: "var(--font-mono), monospace",
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span>{relativeTime(entry.askedAt, now)}</span>
                <span>
                  {entry.ok
                    ? `${entry.rowCount} row${entry.rowCount === 1 ? "" : "s"}`
                    : "no answer"}
                </span>
                {entry.retries > 0 && (
                  <span style={{ color: theme.amber }}>
                    {entry.retries} retr{entry.retries === 1 ? "y" : "ies"}
                  </span>
                )}
              </div>
            </button>
            <button
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove "${entry.question}" from history`}
              style={{
                background: "none",
                border: "none",
                color: theme.faint,
                cursor: "pointer",
                display: "flex",
                padding: 6,
                borderRadius: 8,
              }}
            >
              <Icon size={15} path={ICON.trash} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { EmptyState };
