"use client";

// Milestone 4 (extension) — the Saved queries view.

import type { SavedQuery } from "@/lib/history";
import type { Theme } from "@/lib/theme";
import { Icon, ICON } from "./Icon";
import { EmptyState } from "./HistoryPanel";

export default function SavedPanel({
  saved,
  theme,
  onRun,
  onRemove,
}: {
  saved: SavedQuery[];
  theme: Theme;
  onRun: (question: string) => void;
  onRemove: (question: string) => void;
}) {
  if (saved.length === 0) {
    return (
      <div style={{ flex: 1, padding: "18px 22px 24px" }}>
        <EmptyState
          theme={theme}
          icon={ICON.saved}
          title="Nothing saved yet"
          body="Bookmark a question from the Ask view to keep it here. Saved questions re-run against live data, so the answer is never stale."
        />
      </div>
    );
  }

  return (
    <div
      className="scroll"
      style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px" }}
    >
      <p style={{ margin: "0 0 14px", fontSize: 13, color: theme.muted }}>
        {saved.length} saved question{saved.length === 1 ? "" : "s"}. Opening one
        re-runs it against live data.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {saved.map((item) => (
          <div
            key={item.question}
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
            <span style={{ color: theme.accent, display: "flex", flexShrink: 0 }}>
              <Icon size={15} path={ICON.saved} />
            </span>
            <button
              onClick={() => onRun(item.question)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: theme.ink,
                font: "inherit",
                fontSize: 14,
                padding: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.question}
            </button>
            <button
              onClick={() => onRemove(item.question)}
              aria-label={`Unsave "${item.question}"`}
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
