// Milestone 1 — renders the raw query result as a table.
// Milestone 4 — restyled to the reference mock, with value formatting.
//
// This is also the chart's accessible twin: every value the chart encodes is
// readable here as text, so nothing is reachable by hover alone.

import type { Theme } from "@/lib/theme";
import { formatCell, isNumericValue } from "@/lib/format";

export default function ResultTable({
  columns,
  rows,
  truncated = false,
  theme,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  theme: Theme;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13.5, color: theme.muted }}>
        The query ran successfully but returned no rows.
      </p>
    );
  }

  // Right-align a column when its values are numeric, decided from the first
  // row: postgres.js returns numeric and bigint as strings, so typeof is not
  // enough on its own.
  const numericColumn = new Set(
    columns.filter((c) => isNumericValue(rows[0][c])),
  );

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: numericColumn.has(c) ? "right" : "left",
                    padding: "8px 6px",
                    color: theme.muted,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    borderBottom: `1px solid ${theme.border}`,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td
                    key={c}
                    style={{
                      textAlign: numericColumn.has(c) ? "right" : "left",
                      padding: "8px 6px",
                      whiteSpace: "nowrap",
                      borderBottom: `1px solid ${theme.borderSoft}`,
                      // tabular-nums here, where digits align down the column.
                      fontFamily: numericColumn.has(c)
                        ? "var(--font-mono), monospace"
                        : "inherit",
                      fontVariantNumeric: numericColumn.has(c)
                        ? "tabular-nums"
                        : "normal",
                    }}
                  >
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: theme.faint }}>
        {rows.length} row{rows.length === 1 ? "" : "s"}
        {truncated && " — truncated to the first 500"}
      </p>
    </div>
  );
}
