// Milestone 1 — renders the raw query result as a table.

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** Postgres numerics arrive as strings; right-align anything that is a number. */
function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  return typeof value === "string" && NUMERIC_RE.test(value);
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ResultTable({
  columns,
  rows,
  truncated = false,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        The query ran successfully but returned no rows.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-zinc-200 px-3 py-2 text-left font-medium whitespace-nowrap text-zinc-500 dark:border-zinc-800"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="even:bg-zinc-50 dark:even:bg-zinc-900/40">
                {columns.map((c) => (
                  <td
                    key={c}
                    className={`border-b border-zinc-100 px-3 py-2 whitespace-nowrap dark:border-zinc-800/60 ${
                      isNumeric(row[c]) ? "text-right font-mono" : "text-left"
                    }`}
                  >
                    {format(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {rows.length} row{rows.length === 1 ? "" : "s"}
        {truncated && " — truncated to the first 500"}
      </p>
    </div>
  );
}
