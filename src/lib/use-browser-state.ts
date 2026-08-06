"use client";

/**
 * Hooks for state the browser owns rather than React: localStorage and a media
 * query. Both are read with useSyncExternalStore, which renders the server
 * snapshot during hydration and swaps to the real value immediately after — no
 * hydration mismatch, and no setState inside an effect.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  getHistorySnapshot,
  getHistoryServerSnapshot,
  getSavedSnapshot,
  getSavedServerSnapshot,
  subscribe,
  type HistoryEntry,
  type SavedQuery,
} from "./history";

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(
    subscribe,
    getHistorySnapshot,
    getHistoryServerSnapshot,
  );
}

export function useSavedQueries(): SavedQuery[] {
  return useSyncExternalStore(
    subscribe,
    getSavedSnapshot,
    getSavedServerSnapshot,
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * False until proven otherwise: assume motion is fine, and the media query
 * corrects it on the first client render. CSS in globals.css also disables the
 * keyframe animations, so this flag only needs to gate the JS-driven ones
 * (recharts, the trace reveal).
 */
export function usePrefersReducedMotion(): boolean {
  const subscribeToQuery = useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const query = window.matchMedia(REDUCED_MOTION);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribeToQuery,
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCED_MOTION).matches
        : false,
    () => false,
  );
}

const THEME_KEY = "dataask.theme";
const themeListeners = new Set<() => void>();
let themeCache: "dark" | "light" | null = null;

function readTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useTheme(): ["dark" | "light", () => void] {
  const theme = useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    () => (themeCache ??= readTheme()),
    () => "dark" as const,
  );

  const toggle = useCallback(() => {
    themeCache = (themeCache ?? readTheme()) === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_KEY, themeCache);
    } catch {
      /* storage disabled — the toggle still works for this session */
    }
    for (const listener of themeListeners) listener();
  }, []);

  return [theme, toggle];
}

// --- a clock, so relative timestamps stay correct while a view is open ------

const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

/**
 * The current time as an external store. Reading `Date.now()` during render is
 * impure; a subscribable clock is both correct and self-updating, so "2m ago"
 * does not sit frozen while the panel is open.
 */
export function useNow(): number {
  const subscribeToClock = useCallback((onTick: () => void) => {
    clockListeners.add(onTick);
    clockTimer ??= setInterval(() => {
      clockNow = Date.now();
      for (const listener of clockListeners) listener();
    }, 30_000);
    return () => {
      clockListeners.delete(onTick);
      if (clockListeners.size === 0 && clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  }, []);

  return useSyncExternalStore(
    subscribeToClock,
    () => (clockNow ||= Date.now()),
    () => 0,
  );
}
