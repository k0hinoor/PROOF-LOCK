import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { AttendanceRow, Status } from "./types";
import type { MachineView } from "./console";
import { MotorPanel, GuardPanel } from "./console";

type Range = "today" | "week" | "month";

function startOf(range: Range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "week") d.setDate(d.getDate() - 6);
  if (range === "month") d.setDate(1);
  return d.getTime() / 1000;
}

function useAttendance(source: string, revision?: number) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/attendance?source=${source}&limit=100&since=0`, {
      signal: ctl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!ctl.signal.aborted) setRows(d.rows ?? []);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setRows([]);
      });
    return () => ctl.abort();
  }, [source, revision]);
  return rows;
}

function LineChart({ values, accent }: { values: number[]; accent: string }) {
  const w = 520;
  const h = 150;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = values.length < 2 ? w / 2 : (i / (values.length - 1)) * (w - 16) + 8;
    const y = h - 12 - (v / max) * (h - 28);
    return `${x},${y}`;
  });
  const d = pts.length ? `M ${pts.join(" L ")}` : "";
  const area = pts.length
    ? `M 8,${h - 12} L ${pts.join(" L ")} L ${w - 8},${h - 12} Z`
    : "";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fit-line" aria-hidden>
      <path d={area} fill={accent} opacity="0.12" />
      <path d={d} fill="none" stroke={accent} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function BarChart({
  labels,
  granted,
  denied,
}: {
  labels: string[];
  granted: number[];
  denied: number[];
}) {
  const max = Math.max(1, ...granted.map((g, i) => g + denied[i]));
  return (
    <div className="fit-bars" role="img" aria-label="Scans by day">
      {labels.map((label, i) => {
        const g = granted[i];
        const d = denied[i];
        const total = g + d;
        const h = (total / max) * 100;
        const gShare = total ? (g / total) * 100 : 0;
        return (
          <div key={label} className="fit-bar">
            <div className="fit-bar-stack" style={{ height: `${Math.max(6, h)}%` }}>
              <i style={{ flex: gShare || 0.01 }} className="g" />
              <i style={{ flex: 100 - gShare || 0.01 }} className="d" />
            </div>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Donut({
  slices,
}: {
  slices: { label: string; value: number; color: string }[];
}) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  let acc = 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="fit-donut">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1c1c20" strokeWidth="16" />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = `${frac * c} ${c}`;
          const rot = acc * 360 - 90;
          acc += frac;
          return (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeLinecap="butt"
              transform={`rotate(${rot} 60 60)`}
            />
          );
        })}
      </svg>
      <ul>
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <b>{total ? Math.round((s.value / total) * 100) : 0}%</b>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthCal({ marks }: { marks: Set<string> }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const title = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="fit-cal">
      <header>
        <strong>{title}</strong>
      </header>
      <div className="fit-cal-week">
        {"SMTWTFS".split("").map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="fit-cal-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const on = marks.has(key);
          const today = day === now.getDate();
          return (
            <span key={i} className={`${on ? "on" : ""} ${today ? "today" : ""}`}>
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function OverviewDash({
  s,
  online,
  view,
  onCommand,
}: {
  s?: Status;
  online: boolean;
  view: MachineView;
  onCommand: (action: "MOTOR_ON" | "MOTOR_OFF") => Promise<void>;
}) {
  const [range, setRange] = useState<Range>("week");
  const rows = useAttendance(s?.source ?? "live", s?.revision);
  const since = startOf(range);

  const filtered = useMemo(
    () => rows.filter((r) => r.at >= since),
    [rows, since],
  );
  const granted = filtered.filter((r) => r.result === "ACCEPTED");
  const denied = filtered.filter((r) => r.result === "DENIED");

  const spark = useMemo(() => {
    const buckets = range === "today" ? 12 : range === "week" ? 7 : 30;
    const out = Array(buckets).fill(0);
    const span = range === "today" ? 3600 * 2 : 86400;
    const origin = startOf(range);
    for (const r of filtered) {
      const i = Math.min(buckets - 1, Math.floor((r.at - origin) / span));
      if (i >= 0) out[i] += 1;
    }
    return out as number[];
  }, [filtered, range]);

  const weekBars = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const g = Array(7).fill(0);
    const d = Array(7).fill(0);
    const origin = Date.now() / 1000 - 6 * 86400;
    for (const r of rows) {
      if (r.at < origin) continue;
      const day = new Date(r.at * 1000).getDay();
      const i = (day + 6) % 7;
      if (r.result === "ACCEPTED") g[i] += 1;
      else d[i] += 1;
    }
    return { labels, g, d };
  }, [rows]);

  const marks = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.result !== "ACCEPTED") continue;
      const dt = new Date(r.at * 1000);
      set.add(
        `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      );
    }
    return set;
  }, [rows]);

  const operators = useMemo(() => {
    const map = new Map<string, { name: string; n: number }>();
    for (const r of granted) {
      const cur = map.get(r.operator_ref) ?? { name: r.operator_name, n: 0 };
      cur.n += 1;
      map.set(r.operator_ref, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 4);
  }, [granted]);

  const delta = granted.length;

  return (
    <div className="fit-grid">
      <section className="fit-card span-hero">
        <div className="fit-card-head">
          <div>
            <span className="fit-kicker">Sign-ins</span>
            <h2>
              {granted.length.toLocaleString()}
              <small>
                {delta > 0 ? (
                  <span className="up">
                    <ArrowUpRight size={14} /> {granted.length} this {range}
                  </span>
                ) : (
                  <span className="flat">No scans in this window</span>
                )}
              </small>
            </h2>
          </div>
          <div className="fit-range" role="tablist">
            {(["today", "week", "month"] as Range[]).map((r) => (
              <button
                key={r}
                className={range === r ? "on" : ""}
                onClick={() => setRange(r)}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <LineChart values={spark} accent="var(--lilac)" />
        <p className="fit-caption">
          {denied.length} denied · {s?.access ? `Signed in as ${s.access.operator.name}` : "No live session"}
        </p>
      </section>

      <section className="fit-card">
        <MonthCal marks={marks} />
      </section>

      <section className="fit-card">
        <div className="fit-card-head">
          <div>
            <span className="fit-kicker">Scans</span>
            <h2>
              {(weekBars.g.reduce((a, b) => a + b, 0) +
                weekBars.d.reduce((a, b) => a + b, 0)).toLocaleString()}
              <small>This week</small>
            </h2>
          </div>
        </div>
        <BarChart labels={weekBars.labels} granted={weekBars.g} denied={weekBars.d} />
      </section>

      <section className="fit-card motor-wrap">
        <MotorPanel s={s} online={online} view={view} onCommand={onCommand} />
      </section>

      <section className="fit-card">
        <span className="fit-kicker">Operators</span>
        <h3>On the reader</h3>
        <ol className="fit-ops">
          {operators.length ? (
            operators.map(([ref, o], i) => (
              <li key={ref}>
                <em>{String(i + 1).padStart(2, "0")}</em>
                <span>
                  <b>{o.name || "Unregistered"}</b>
                  <small>{ref}</small>
                </span>
                <strong>{o.n}</strong>
              </li>
            ))
          ) : (
            <li className="empty">No granted scans in this window.</li>
          )}
        </ol>
      </section>

      <section className="fit-card">
        <span className="fit-kicker">Access mix</span>
        <h3>Granted vs denied</h3>
        <Donut
          slices={[
            { label: "Granted", value: granted.length, color: "#c4b5fd" },
            { label: "Denied", value: denied.length, color: "#e8d36a" },
            {
              label: "Idle",
              value: granted.length + denied.length ? 0 : 1,
              color: "#3f3f46",
            },
          ].filter((s) => s.value > 0)}
        />
      </section>

      <section className="fit-card">
        <GuardPanel s={s} online={online} view={view} />
      </section>
    </div>
  );
}
