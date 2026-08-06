// Milestone 4 — the three summary tiles from the reference mock.
//
// The mock hard-coded a `stats` array. AgentResult has no such field, and adding
// one would mean a second LLM call per question — unaffordable at roughly 20
// requests a minute. So the tiles are derived from the result shape instead:
// the leading label column and the first numeric column give
// {leader, leader's value, total across rows}, which is meaningful for any
// ranking or group-by result.
//
// When the shape does not support it — no numeric column, or a single row that
// is already its own headline — nothing renders. A one-row "top 5" is a stat,
// not a table with tiles above it.

import type { Theme } from "@/lib/theme";
import { formatCompact, isNumericValue, isTimestampValue } from "@/lib/format";

type Row = Record<string, unknown>;

export type Tile = { label: string; value: string };

export function deriveTiles(columns: string[], rows: Row[]): Tile[] {
  if (rows.length < 2 || columns.length === 0) return [];

  const labelKey = columns.find(
    (c) => !isNumericValue(rows[0][c]) && !isTimestampValue(rows[0][c]),
  );
  const valueKey = columns.find((c) => isNumericValue(rows[0][c]));
  if (!valueKey) return [];

  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  const leader = rows[0];

  const tiles: Tile[] = [];
  if (labelKey) {
    tiles.push({ label: `Top ${labelKey}`, value: formatCompact(leader[labelKey]) });
  }
  tiles.push({ label: valueKey, value: formatCompact(leader[valueKey]) });
  tiles.push({ label: `Total ${valueKey}`, value: formatCompact(total) });
  return tiles;
}

export default function StatTiles({
  tiles,
  theme,
}: {
  tiles: Tile[];
  theme: Theme;
}) {
  if (tiles.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        gap: 11,
        marginBottom: 18,
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          style={{
            background: theme.surfaceAlt,
            borderRadius: 11,
            padding: "12px 14px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              color: theme.muted,
              marginBottom: 5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.label}
          </div>
          {/* Proportional figures, not tabular — these do not align vertically. */}
          <div
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontSize: 22,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  );
}
