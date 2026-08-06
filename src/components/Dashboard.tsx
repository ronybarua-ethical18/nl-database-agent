"use client";

// Milestone 4 — the dashboard shell, following docs/reference/SqlAgentDashboard.jsx.
//
// Owns the state the views share: theme, active nav, the current question and
// result, and the localStorage-backed history and saved lists.
//
// Styling is inline off a theme object rather than Tailwind `dark:` variants,
// matching the reference. The theme toggles at runtime, and one token object for
// both modes is easier to keep consistent than paired utilities on every element.

import { useCallback, useState } from "react";
import type { AgentResult } from "@/lib/agent";
import {
  addToHistory,
  clearHistory,
  isSaved,
  removeFromHistory,
  toggleSaved,
  type HistoryEntry,
} from "@/lib/history";
import {
  useHistory,
  usePrefersReducedMotion,
  useSavedQueries,
  useTheme,
} from "@/lib/use-browser-state";
import { THEMES } from "@/lib/theme";
import AskView, { type Phase } from "./AskView";
import HistoryPanel from "./HistoryPanel";
import SavedPanel from "./SavedPanel";
import SettingsPanel, { type AgentConfig } from "./SettingsPanel";
import { Icon, ICON } from "./Icon";

type Nav = "ask" | "history" | "saved" | "settings";

const NAV: { key: Nav; icon: React.ReactNode; label: string }[] = [
  { key: "ask", icon: ICON.ask, label: "Ask" },
  { key: "history", icon: ICON.history, label: "History" },
  { key: "saved", icon: ICON.saved, label: "Saved queries" },
  { key: "settings", icon: ICON.settings, label: "Settings" },
];

const TITLES: Record<Nav, string> = {
  ask: "Ask your data",
  history: "History",
  saved: "Saved queries",
  settings: "Settings",
};

export default function Dashboard({
  config,
  datasetSummary,
}: {
  config: AgentConfig;
  datasetSummary: string;
}) {
  const [nav, setNav] = useState<Nav>("ask");
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Browser-owned state, read through useSyncExternalStore so it survives
  // hydration without a mismatch and without a setState in an effect.
  const history = useHistory();
  const saved = useSavedQueries();
  const [mode, toggleTheme] = useTheme();
  const animate = !usePrefersReducedMotion();

  const dark = mode === "dark";
  const theme = dark ? THEMES.dark : THEMES.light;

  const ask = useCallback(async (asked: string) => {
    setNav("ask");
    setQuestion(asked);
    setPhase("running");
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: asked }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status}).`);
        setPhase("error");
        return;
      }

      const agentResult = body as AgentResult;
      setResult(agentResult);
      setPhase("done");
      addToHistory(asked, agentResult, Date.now());
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
      setPhase("error");
    }
  }, []);

  const openHistoryEntry = (entry: HistoryEntry) => {
    // Restores the cached answer — no LLM call, no waiting.
    setQuestion(entry.question);
    setResult(entry.result);
    setError(null);
    setPhase("done");
    setNav("ask");
  };

  const questionIsSaved = question.trim().length > 0 && isSaved(question);

  return (
    <div
      id="adash"
      style={{
        // Consumed by the CSS in globals.css for placeholder and scrollbar.
        ["--faint" as string]: theme.faint,
        ["--sb" as string]: theme.border,
        ["--navhover" as string]: theme.navHover,
        color: theme.ink,
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        boxShadow: theme.shadow,
        display: "flex",
        overflow: "hidden",
        width: "100%",
        maxWidth: 1100,
        height: "min(760px, calc(100vh - 48px))",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 216,
          flexShrink: 0,
          background: theme.panel,
          borderRight: `1px solid ${theme.border}`,
          display: "flex",
          flexDirection: "column",
          padding: "18px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "2px 6px 20px",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: theme.accent,
              color: theme.onAccent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={17} path={ICON.db} />
          </div>
          <div
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: "-0.01em",
            }}
          >
            DataAsk
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((item) => {
            const on = nav === item.key;
            const count =
              item.key === "history"
                ? history.length
                : item.key === "saved"
                  ? saved.length
                  : 0;
            return (
              <button
                key={item.key}
                className="nav"
                onClick={() => setNav(item.key)}
                aria-current={on ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 10px",
                  borderRadius: 9,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13.5,
                  font: "inherit",
                  textAlign: "left",
                  background: on ? theme.navActive : "transparent",
                  color: on ? theme.accent : theme.muted,
                  fontWeight: on ? 500 : 400,
                }}
              >
                <span style={{ display: "flex" }}>
                  <Icon size={17} path={item.icon} />
                </span>
                {item.label}
                {count > 0 && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      fontFamily: "var(--font-mono), monospace",
                      color: theme.faint,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 14,
            borderTop: `1px solid ${theme.border}`,
          }}
        >
          <button
            onClick={toggleTheme}
            className="nav"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 10px",
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              fontSize: 13.5,
              width: "100%",
              textAlign: "left",
              background: "transparent",
              color: theme.muted,
              font: "inherit",
            }}
          >
            <span style={{ display: "flex" }}>
              <Icon size={17} path={dark ? ICON.sun : ICON.moon} />
            </span>
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <header
          style={{
            height: 56,
            flexShrink: 0,
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            gap: 12,
            background: theme.panel,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontWeight: 500,
              fontSize: 15,
            }}
          >
            {TITLES[nav]}
          </div>

          {nav === "ask" && question.trim().length > 0 && (
            <button
              onClick={() => toggleSaved(question, Date.now())}
              aria-label={questionIsSaved ? "Unsave this question" : "Save this question"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: questionIsSaved ? theme.accent : theme.muted,
                fontSize: 12.5,
                font: "inherit",
                padding: "4px 6px",
              }}
            >
              <Icon size={15} path={ICON.saved} />
              {questionIsSaved ? "Saved" : "Save"}
            </button>
          )}

          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono), monospace",
              fontSize: 10.5,
              color: theme.accent,
              background: theme.accentSoft,
              padding: "4px 9px",
              borderRadius: 20,
              whiteSpace: "nowrap",
            }}
          >
            {datasetSummary}
          </span>
        </header>

        {nav === "ask" && (
          <AskView
            theme={theme}
            animate={animate}
            question={question}
            setQuestion={setQuestion}
            phase={phase}
            result={result}
            error={error}
            onAsk={ask}
          />
        )}

        {nav === "history" && (
          <HistoryPanel
            entries={history}
            theme={theme}
            onOpen={openHistoryEntry}
            onRemove={removeFromHistory}
            onClear={clearHistory}
          />
        )}

        {nav === "saved" && (
          <SavedPanel
            saved={saved}
            theme={theme}
            onRun={(q) => ask(q)}
            onRemove={(q) => toggleSaved(q, Date.now())}
          />
        )}

        {nav === "settings" && <SettingsPanel config={config} theme={theme} />}
      </div>
    </div>
  );
}
