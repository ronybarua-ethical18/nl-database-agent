import React, { useState, useRef } from "react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";

const THEMES = {
  dark: {
    bg: "#0C0E0D", panel: "#101413", surface: "#141816", surfaceAlt: "#1B201E",
    border: "#272D29", borderSoft: "#1E2320", ink: "#E9ECE8", muted: "#8B928C", faint: "#5D645F",
    accent: "#2DD4A7", onAccent: "#052A21", accentSoft: "rgba(45,212,167,0.13)",
    amber: "#F0B24B", amberSoft: "rgba(240,178,75,0.15)", barTop: "#2DD4A7", barRest: "#2C4B43",
    shadow: "0 10px 34px rgba(0,0,0,0.55)", navHover: "#181D1B", navActive: "rgba(45,212,167,0.13)",
  },
  light: {
    bg: "#F4F6F3", panel: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#EEF1EC",
    border: "#E3E7E1", borderSoft: "#EDF0EB", ink: "#171A18", muted: "#6A716B", faint: "#9DA49E",
    accent: "#0F8A6B", onAccent: "#FFFFFF", accentSoft: "rgba(15,138,107,0.10)",
    amber: "#B5760F", amberSoft: "#FBEED8", barTop: "#0F8A6B", barRest: "#BCD6CC",
    shadow: "0 8px 28px rgba(28,40,34,0.10)", navHover: "#EEF1EC", navActive: "rgba(15,138,107,0.10)",
  },
};
const TERM = { bg: "#0A0C0B", ink: "#C9CFC9", dim: "#7C837D" };

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');
@keyframes riseIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
#adash *, #adash button, #adash .card { transition: background-color .35s ease, border-color .35s ease, color .2s ease; }
#adash input::placeholder { color: var(--faint); }
#adash .scroll::-webkit-scrollbar { width: 8px; }
#adash .scroll::-webkit-scrollbar-thumb { background: var(--sb); border-radius: 8px; }
#adash .nav:hover { background: var(--navhover) !important; }
`;

const DATASET = {
  top_products: {
    question: "Show the top 5 products sold last month",
    answer: "Wireless Earbuds led last month with 124 units sold, followed by the Yoga Mat and Coffee Grinder. The top five together made up roughly 41% of all units.",
    stats: [{ label: "Top product", value: "Earbuds" }, { label: "Units sold", value: "124" }, { label: "Revenue", value: "$6.2k" }],
    chart: [{ name: "Earbuds", v: 124 }, { name: "Yoga Mat", v: 92 }, { name: "Grinder", v: 74 }, { name: "Bottle", v: 58 }, { name: "Lamp", v: 47 }],
    table: { cols: ["Product", "Units", "Revenue"], rows: [["Wireless Earbuds", "124", "$6,200"], ["Yoga Mat", "92", "$2,760"], ["Coffee Grinder", "74", "$3,700"], ["Water Bottle", "58", "$870"], ["Desk Lamp", "47", "$1,880"]] },
    sql: `select p.name, sum(oi.qty) as units,
       sum(oi.qty * oi.unit_price) as revenue
from order_items oi
join products p on p.id = oi.product_id
join orders o on o.id = oi.order_id
where o.created_at >= date_trunc('month', now()) - interval '1 month'
  and o.created_at <  date_trunc('month', now())
group by p.name
order by units desc
limit 5;`,
    needsFix: true, fixNote: 'column "sold" does not exist',
  },
  top_customer: {
    question: "Who is our highest-spending customer?",
    answer: "Nadia Rahman is the highest-spending customer at $4,820 across 11 orders, ahead of the next customer by about $900.",
    stats: [{ label: "Customer", value: "N. Rahman" }, { label: "Total spent", value: "$4,820" }, { label: "Orders", value: "11" }],
    chart: [{ name: "Rahman", v: 4820 }, { name: "Chen", v: 3910 }, { name: "Okoro", v: 3450 }, { name: "Silva", v: 2980 }, { name: "Kim", v: 2610 }],
    table: { cols: ["Customer", "Orders", "Total spent"], rows: [["Nadia Rahman", "11", "$4,820"], ["Wei Chen", "9", "$3,910"], ["Amara Okoro", "8", "$3,450"], ["João Silva", "7", "$2,980"], ["Min-jun Kim", "6", "$2,610"]] },
    sql: `select c.name, count(distinct o.id) as orders,
       sum(oi.qty * oi.unit_price) as total_spent
from customers c
join orders o on o.customer_id = c.id
join order_items oi on oi.order_id = o.id
group by c.name
order by total_spent desc
limit 5;`,
    needsFix: false,
  },
};
const EXAMPLES = [{ key: "top_products", label: "Top 5 products last month" }, { key: "top_customer", label: "Highest-spending customer" }];

const reduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Icon({ path, size = 16, stroke = 1.6, fill = "none" }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{path}</svg>);
}
const ICON = {
  db: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  ask: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
  history: <><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" /></>,
  saved: <><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  spark: <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
};

export default function SqlAgentDashboard() {
  const [dark, setDark] = useState(true);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle");
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [activeKey, setActiveKey] = useState("top_products");
  const [nav, setNav] = useState("ask");
  const timers = useRef([]);
  const scrollRef = useRef(null);
  const t = dark ? THEMES.dark : THEMES.light;

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const run = (key) => {
    const data = DATASET[key] || DATASET.top_products;
    clearTimers(); setActiveKey(key); setQuery(data.question);
    setResult(null); setShowSql(false); setPhase("running");
    const trace = [
      { dot: "run", text: "Reading database schema" },
      { dot: "run", text: "Writing SQL query" },
      { dot: "run", text: "Running query on Postgres" },
    ];
    if (data.needsFix) {
      trace.push({ dot: "err", text: `Query failed — ${data.fixNote}` });
      trace.push({ dot: "fix", text: "Reading error, rewriting the query" });
      trace.push({ dot: "run", text: "Running query on Postgres" });
    }
    trace.push({ dot: "ok", text: "Answer ready" });
    const gap = reduced ? 55 : 640;
    setSteps([]);
    trace.forEach((s, i) => {
      const tm = setTimeout(() => {
        setSteps((p) => [...p, s]);
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        if (i === trace.length - 1) {
          const tm2 = setTimeout(() => { setResult(data); setPhase("done"); }, gap * 0.7);
          timers.current.push(tm2);
        }
      }, gap * (i + 1));
      timers.current.push(tm);
    });
  };

  const dotColor = (d) => (d === "err" || d === "fix" ? t.amber : d === "ok" ? t.accent : TERM.dim);
  const maxV = result ? Math.max(...result.chart.map((d) => d.v)) : 1;
  const NAV = [{ k: "ask", ic: ICON.ask, l: "Ask" }, { k: "history", ic: ICON.history, l: "History" }, { k: "saved", ic: ICON.saved, l: "Saved queries" }, { k: "settings", ic: ICON.settings, l: "Settings" }];

  return (
    <div id="adash" style={{ "--faint": t.faint, "--sb": t.border, "--navhover": t.navHover,
      fontFamily: "'Inter',sans-serif", color: t.ink, background: t.bg, borderRadius: 16,
      border: `1px solid ${t.border}`, height: 640, display: "flex", overflow: "hidden", boxShadow: t.shadow }}>
      <style>{FONTS}</style>

      {/* Sidebar */}
      <aside style={{ width: 216, flexShrink: 0, background: t.panel, borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", padding: "18px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px 20px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: t.accent, color: t.onAccent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={17} path={ICON.db} />
          </div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>DataAsk</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => {
            const on = nav === n.k;
            return (
              <button key={n.k} className="nav" onClick={() => setNav(n.k)}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 9,
                  border: "none", cursor: "pointer", fontSize: 13.5, fontFamily: "'Inter',sans-serif",
                  textAlign: "left", background: on ? t.navActive : "transparent",
                  color: on ? t.accent : t.muted, fontWeight: on ? 500 : 400 }}>
                <span style={{ display: "flex" }}><Icon size={17} path={n.ic} /></span>{n.l}
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
          <button onClick={() => setDark((v) => !v)} className="nav"
            style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 9,
              border: "none", cursor: "pointer", fontSize: 13.5, width: "100%", textAlign: "left",
              background: "transparent", color: t.muted, fontFamily: "'Inter',sans-serif" }}>
            <span style={{ display: "flex" }}><Icon size={17} path={dark ? ICON.sun : ICON.moon} /></span>
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Topbar */}
        <header style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", padding: "0 22px", gap: 12, background: t.panel }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500, fontSize: 15 }}>Ask your data</div>
          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5,
            color: t.accent, background: t.accentSoft, padding: "4px 9px", borderRadius: 20 }}>demo store · read-only</span>
        </header>

        {/* Sticky input zone */}
        <div style={{ flexShrink: 0, padding: "18px 22px 14px", borderBottom: `1px solid ${t.borderSoft}`, background: t.bg }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
            <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 13, color: t.faint, display: "flex" }}><Icon size={17} path={ICON.search} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && query.trim() && run(activeKey)}
                placeholder="Which products sold best last month?"
                style={{ width: "100%", height: 44, border: `1px solid ${t.border}`, borderRadius: 11,
                  padding: "0 14px 0 39px", fontSize: 14.5, fontFamily: "'Inter',sans-serif",
                  background: t.surface, color: t.ink, outline: "none", boxSizing: "border-box" }} />
            </div>
            <button onClick={() => query.trim() && run(activeKey)} disabled={phase === "running"}
              style={{ height: 44, padding: "0 20px", border: "none", borderRadius: 11,
                background: phase === "running" ? t.surfaceAlt : t.accent,
                color: phase === "running" ? t.muted : t.onAccent, fontSize: 14.5, fontWeight: 600,
                fontFamily: "'Space Grotesk',sans-serif", cursor: phase === "running" ? "default" : "pointer",
                whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7 }}>
              {phase === "running" ? "Thinking…" : <>Ask<Icon size={16} path={ICON.arrow} /></>}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: t.faint }}>Try</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.key} onClick={() => run(ex.key)}
                style={{ fontSize: 12.5, padding: "5px 12px", border: `1px solid ${t.border}`, borderRadius: 20,
                  background: t.surface, color: t.ink, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>{ex.label}</button>
            ))}
          </div>
        </div>

        {/* Scrollable results */}
        <div ref={scrollRef} className="scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px" }}>
          {phase === "idle" && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", textAlign: "center", color: t.muted }}>
              <div style={{ width: 54, height: 54, borderRadius: 15, background: t.surfaceAlt, color: t.faint,
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Icon size={26} path={ICON.spark} />
              </div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 500, color: t.ink, marginBottom: 6 }}>
                Ask a question to get started
              </div>
              <div style={{ fontSize: 13.5, maxWidth: 320, lineHeight: 1.6 }}>
                Type in plain language and the agent writes the SQL, runs it, and fixes its own mistakes before answering.
              </div>
            </div>
          )}

          {phase !== "idle" && (
            <div style={{ background: TERM.bg, border: `1px solid ${dark ? t.border : "#20241E"}`, borderRadius: 13,
              padding: "14px 16px", marginBottom: result ? 16 : 0, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 11, alignItems: "center" }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: "#E06C5A" }} />
                <span style={{ width: 9, height: 9, borderRadius: 9, background: "#E0B34A" }} />
                <span style={{ width: 9, height: 9, borderRadius: 9, background: "#5FB94A" }} />
                <span style={{ marginLeft: 6, color: TERM.dim, fontSize: 11, letterSpacing: "0.05em" }}>agent-trace</span>
              </div>
              {steps.map((s, i) => {
                const pending = phase === "running" && i === steps.length - 1;
                return (
                  <div key={i} style={{ display: "flex", gap: 11, padding: "3.5px 0", alignItems: "center",
                    color: s.dot === "err" ? t.amber : TERM.ink, animation: reduced ? "none" : "riseIn 0.28s ease both" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, flexShrink: 0, background: dotColor(s.dot),
                      animation: pending ? "blink 1s infinite" : "none" }} />
                    <span>{s.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result && (
            <div className="card" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14,
              padding: "18px 20px", animation: reduced ? "none" : "riseIn 0.4s ease both" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <span style={{ color: t.accent, flexShrink: 0, marginTop: 2 }}><Icon size={18} path={ICON.spark} /></span>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{result.answer}</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 11, marginBottom: 18 }}>
                {result.stats.map((s) => (
                  <div key={s.label} style={{ background: t.surfaceAlt, borderRadius: 11, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, color: t.muted, marginBottom: 5 }}>{s.label}</div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 600 }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ height: 150, marginBottom: 18 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fill: t.muted, fontSize: 11, fontFamily: "Inter" }}
                      axisLine={{ stroke: t.border }} tickLine={false} />
                    <Bar dataKey="v" radius={[5, 5, 0, 0]} isAnimationActive={!reduced}>
                      {result.chart.map((d, i) => (<Cell key={i} fill={d.v === maxV ? t.barTop : t.barRest} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>
                    {result.table.cols.map((c, i) => (
                      <th key={c} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 6px",
                        color: t.muted, fontWeight: 500, borderBottom: `1px solid ${t.border}` }}>{c}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {result.table.rows.map((r, ri) => (
                      <tr key={ri}>{r.map((cell, ci) => (
                        <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", padding: "8px 6px",
                          borderBottom: `1px solid ${t.borderSoft}`,
                          fontFamily: ci === 0 ? "Inter" : "'JetBrains Mono',monospace" }}>{cell}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 13, marginTop: 13 }}>
                <button onClick={() => setShowSql((v) => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none",
                    color: t.muted, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: "'Inter',sans-serif" }}>
                  <span style={{ transform: showSql ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "flex" }}>
                    <Icon size={14} path={ICON.chevron} />
                  </span>
                  {showSql ? "Hide SQL" : "Show SQL"}
                  {result.needsFix && (
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: t.amber,
                      background: t.amberSoft, padding: "3px 8px", borderRadius: 20, marginLeft: 4 }}>fixed after 1 retry</span>
                  )}
                </button>
                {showSql && (
                  <pre style={{ margin: "11px 0 0", background: TERM.bg, color: TERM.ink, borderRadius: 11,
                    padding: "13px 15px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.6,
                    overflowX: "auto", whiteSpace: "pre", border: `1px solid ${dark ? t.border : "#20241E"}` }}>{result.sql}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
