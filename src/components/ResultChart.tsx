"use client";

// Milestone 4 — recharts bar/line chart for results that suit one.
//
// The chart spec comes from the agent (`result.chart`), which already validates
// that xKey and yKey exist in the result and that there is more than one row.
//
// Colour is emphasis, not a value ramp: the largest bar takes the accent, the
// rest take one recessive step of the same hue. Grading every bar by size would
// double-encode length as hue and burn the only free channel on information the
// bar length already carries.
//
// A tooltip is included, which the reference mock omitted — without it, and with
// no y-axis, the bars carried no readable magnitude. The table below the chart is
// the accessible twin, so no value is reachable by hover alone.

import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/agent";
import type { Theme } from "@/lib/theme";
import { formatCell, formatCompact } from "@/lib/format";

type Row = Record<string, unknown>;

function TooltipCard({
  active,
  payload,
  label,
  theme,
  yKey,
}: {
  active?: boolean;
  payload?: { value?: unknown }[];
  label?: unknown;
  theme: Theme;
  yKey: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 9,
        padding: "8px 11px",
        boxShadow: theme.shadow,
        fontSize: 12.5,
      }}
    >
      <div style={{ color: theme.muted, marginBottom: 3 }}>
        {formatCell(label)}
      </div>
      <div
        style={{
          color: theme.ink,
          fontFamily: "var(--font-mono), monospace",
          fontWeight: 500,
        }}
      >
        {yKey}: {formatCell(payload[0].value)}
      </div>
    </div>
  );
}

export default function ResultChart({
  spec,
  rows,
  theme,
  animate,
}: {
  spec: ChartSpec;
  rows: Row[];
  theme: Theme;
  animate: boolean;
}) {
  if (spec.type === "none" || !spec.xKey || !spec.yKey) return null;

  const xKey = spec.xKey;
  const yKey = spec.yKey;

  // Recharts needs numbers; postgres.js hands back numeric/bigint as strings.
  const data = rows.map((row) => ({ ...row, [yKey]: Number(row[yKey]) }));
  if (data.some((d) => !Number.isFinite(d[yKey] as number))) return null;

  const max = Math.max(...data.map((d) => d[yKey] as number));

  const axis = {
    tick: { fill: theme.muted, fontSize: 11 },
    axisLine: { stroke: theme.border },
    tickLine: false,
  } as const;

  return (
    // Height includes the x-axis band so the labels are never clipped.
    <div style={{ height: 176, marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height="100%">
        {spec.type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => formatCompact(v)} />
            <YAxis {...axis} width={54} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip
              content={<TooltipCard theme={theme} yKey={yKey} />}
              cursor={{ stroke: theme.border }}
            />
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={theme.barTop}
              strokeWidth={2}
              dot={{ r: 3, fill: theme.barTop, strokeWidth: 0 }}
              activeDot={{
                r: 5,
                fill: theme.barTop,
                stroke: theme.surface,
                strokeWidth: 2,
              }}
              isAnimationActive={animate}
            />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => formatCompact(v)} />
            <YAxis {...axis} width={54} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip
              content={<TooltipCard theme={theme} yKey={yKey} />}
              cursor={{ fill: theme.accentSoft }}
            />
            <Bar dataKey={yKey} radius={[4, 4, 0, 0]} isAnimationActive={animate}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={(d[yKey] as number) === max ? theme.barTop : theme.barRest}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
