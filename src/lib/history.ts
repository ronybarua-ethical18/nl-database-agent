/**
 * Question history and saved queries, in localStorage.
 *
 * Deliberately client-side. The app connects to Postgres as `app_readonly`,
 * which holds SELECT and nothing else, so there is nowhere server-side to
 * persist to — and that constraint is the point, not a limitation to work
 * around. It also suits a public demo: each visitor sees only their own
 * questions, and no history endpoint exists to leak them.
 *
 * The full AgentResult is cached with each entry so replaying a question is
 * instant and costs no LLM call. That matters on the Gemini free tier, which
 * allows roughly 20 requests a minute.
 *
 * Exposed as a subscribable store rather than read into state inside an effect,
 * so components can use useSyncExternalStore: it is the API for reading
 * browser-owned state without a hydration mismatch, and it keeps the snapshot
 * reference stable between renders.
 */

import type { AgentResult } from "./agent";

const HISTORY_KEY = "dataask.history.v1";
const SAVED_KEY = "dataask.saved.v1";
/** Enough to be useful; small enough to stay well inside the ~5MB quota. */
const MAX_HISTORY = 25;

export type HistoryEntry = {
  id: string;
  question: string;
  askedAt: number;
  ok: boolean;
  rowCount: number;
  retries: number;
  result: AgentResult;
};

export type SavedQuery = { question: string; savedAt: number };

// Stable empty arrays: getSnapshot must return the same reference when nothing
// changed, or useSyncExternalStore re-renders forever.
const NO_HISTORY: HistoryEntry[] = [];
const NO_SAVED: SavedQuery[] = [];

let historyCache: HistoryEntry[] | null = null;
let savedCache: SavedQuery[] | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    // Corrupt or unavailable storage (private mode, quota) is not worth
    // breaking the page over.
    return fallback;
  }
}

function write<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage disabled — history is a convenience */
  }
}

export function getHistorySnapshot(): HistoryEntry[] {
  historyCache ??= read<HistoryEntry>(HISTORY_KEY, NO_HISTORY);
  return historyCache;
}

export function getSavedSnapshot(): SavedQuery[] {
  savedCache ??= read<SavedQuery>(SAVED_KEY, NO_SAVED);
  return savedCache;
}

/** During SSR and hydration there is no localStorage; both start empty. */
export const getHistoryServerSnapshot = (): HistoryEntry[] => NO_HISTORY;
export const getSavedServerSnapshot = (): SavedQuery[] => NO_SAVED;

function setHistory(next: HistoryEntry[]): void {
  historyCache = next;
  write(HISTORY_KEY, next);
  emit();
}

function setSaved(next: SavedQuery[]): void {
  savedCache = next;
  write(SAVED_KEY, next);
  emit();
}

export function addToHistory(
  question: string,
  result: AgentResult,
  now: number,
): void {
  const entry: HistoryEntry = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    question,
    askedAt: now,
    ok: result.ok,
    rowCount: result.rows?.length ?? 0,
    retries: result.attempts.filter((a) => a.error).length,
    result,
  };
  // Asking the same question twice should move it up, not duplicate it.
  const key = question.trim().toLowerCase();
  const rest = getHistorySnapshot().filter(
    (e) => e.question.trim().toLowerCase() !== key,
  );
  setHistory([entry, ...rest].slice(0, MAX_HISTORY));
}

export function clearHistory(): void {
  setHistory(NO_HISTORY);
}

export function removeFromHistory(id: string): void {
  setHistory(getHistorySnapshot().filter((e) => e.id !== id));
}

export function isSaved(question: string): boolean {
  const key = question.trim().toLowerCase();
  return getSavedSnapshot().some(
    (s) => s.question.trim().toLowerCase() === key,
  );
}

export function toggleSaved(question: string, now: number): void {
  const key = question.trim().toLowerCase();
  const current = getSavedSnapshot();
  const exists = current.some((s) => s.question.trim().toLowerCase() === key);
  setSaved(
    exists
      ? current.filter((s) => s.question.trim().toLowerCase() !== key)
      : [{ question, savedAt: now }, ...current],
  );
}

export function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
