/**
 * Design tokens, ported from docs/reference/SqlAgentDashboard.jsx.
 *
 * Kept as a runtime object rather than Tailwind `dark:` variants because the
 * dashboard toggles theme on click, and one source of truth for both modes is
 * easier to keep honest than paired utility classes on every element.
 *
 * barRest differs from the mock deliberately. The mock's recessive bar colours
 * fell below the 2:1 visibility floor against their own card surface
 * (#2C4B43 measured 1.87:1 on dark, #BCD6CC 1.54:1 on light), which made four
 * of five bars barely register as marks. These values clear the floor at 2.70:1
 * and 2.29:1 while staying clearly recessive against barTop.
 */

export type Theme = {
  bg: string;
  panel: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderSoft: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  amber: string;
  amberSoft: string;
  barTop: string;
  barRest: string;
  shadow: string;
  navHover: string;
  navActive: string;
};

export const THEMES: { dark: Theme; light: Theme } = {
  dark: {
    bg: "#0C0E0D",
    panel: "#101413",
    surface: "#141816",
    surfaceAlt: "#1B201E",
    border: "#272D29",
    borderSoft: "#1E2320",
    ink: "#E9ECE8",
    muted: "#8B928C",
    faint: "#5D645F",
    accent: "#2DD4A7",
    onAccent: "#052A21",
    accentSoft: "rgba(45,212,167,0.13)",
    amber: "#F0B24B",
    amberSoft: "rgba(240,178,75,0.15)",
    barTop: "#2DD4A7",
    barRest: "#3D6459",
    shadow: "0 10px 34px rgba(0,0,0,0.55)",
    navHover: "#181D1B",
    navActive: "rgba(45,212,167,0.13)",
  },
  light: {
    bg: "#F4F6F3",
    panel: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceAlt: "#EEF1EC",
    border: "#E3E7E1",
    borderSoft: "#EDF0EB",
    ink: "#171A18",
    muted: "#6A716B",
    faint: "#9DA49E",
    accent: "#0F8A6B",
    onAccent: "#FFFFFF",
    accentSoft: "rgba(15,138,107,0.10)",
    amber: "#B5760F",
    amberSoft: "#FBEED8",
    barTop: "#0F8A6B",
    barRest: "#86B5A4",
    shadow: "0 8px 28px rgba(28,40,34,0.10)",
    navHover: "#EEF1EC",
    navActive: "rgba(15,138,107,0.10)",
  },
};

/** The agent-trace terminal panel, which stays dark in both themes. */
export const TERM = { bg: "#0A0C0B", ink: "#C9CFC9", dim: "#7C837D" };

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
