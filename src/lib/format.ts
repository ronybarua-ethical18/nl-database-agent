/**
 * Value formatting for query results.
 *
 * Postgres sends more than plain numbers over the wire, and raw output looked
 * poor in practice: counts arrive as strings ("23"), revenue as "893288.35",
 * and date_trunc columns as "2024-08-01T00:00:00.000Z".
 */

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** numeric/bigint arrive as strings from postgres.js — treat them as numbers. */
export function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && NUMERIC_RE.test(value);
}

export function isTimestampValue(value: unknown): boolean {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

/**
 * A timestamp at exactly midnight UTC is almost always a date_trunc bucket, so
 * showing a time component would be noise.
 */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const midnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: midnight ? undefined : "2-digit",
    ...(midnight ? {} : { hour: "2-digit", minute: "2-digit" }),
    timeZone: "UTC",
  });
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  // Money-ish and ratio-ish values both read better clamped to 2 decimals.
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isTimestampValue(value)) return formatTimestamp(value as string);
  if (isNumericValue(value)) return formatNumber(Number(value));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Compact form for stat tiles, where width is tight: 893288.35 -> 893.3k */
export function formatCompact(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (isTimestampValue(value)) return formatTimestamp(value as string);
  if (!isNumericValue(value)) {
    const text = String(value);
    return text.length > 16 ? `${text.slice(0, 15)}…` : text;
  }
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return formatNumber(n);
}
