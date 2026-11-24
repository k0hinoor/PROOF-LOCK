import { useEffect, useMemo, useState } from "react";
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

function LineChart({
  values,
  labels,
}: {
  values: number[];
  labels: string[];
}) {
  const w = 560;
  const h = 180;
  const pad = { l: 28, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...values);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) =>
    pad.l + (values.length < 2 ? innerW / 2 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fit-line" role="img" aria-label="Sign-ins over time">
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--line)"
            strokeWidth="1"
          />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fit-axis">
            {t}
          </text>
        </g>
      ))}
      {pts.length > 1 && (
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="var(--lilac)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--lilac)" />
      ))}
      {labels.map((label, i) =>
        i % Math.ceil(labels.length / 7) === 0 ? (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="fit-axis">
            {label}
          </text>
        ) : null,
      )}
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
    <div>
      <div className="fit-legend">
        <span className="g">Granted</span>
        <span className="d">Denied</span>
      </div>
      <div className="fit-bars" role="img" aria-label="Scans by day">
        {labels.map((label, i) => {
          const g = granted[i];
          const d = denied[i];
          const total = g + d;
          return (
            <div key={label} className="fit-bar">
              <div className="fit-bar-track">
                {total > 0 && (
                  <div
                    className="fit-bar-stack"
                    style={{ height: `${(total / max) * 100}%` }}
                  >
                    <i className="g" style={{ flex: g || 0.0001 }} />
                    <i className="d" style={{ flex: d || 0.0001 }} />
                  </div>
                )}
              </div>
              <span>{label}</span>
            </div>
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
  const granted = filtered.filter((r) => r.result === "ACCEPTED").length;
  const denied = filtered.filter((r) => r.result === "DENIED").length;

  const spark = useMemo(() => {
    const buckets = range === "today" ? 12 : range === "week" ? 7 : 14;
    const out = Array(buckets).fill(0);
    const span = range === "today" ? 3600 * 2 : 86400;
    const origin = startOf(range);
    const labels: string[] = [];
    for (let i = 0; i < buckets; i++) {
      const t = new Date((origin + i * span) * 1000);
      labels.push(
        range === "today"
          ? `${t.getHours()}:00`
          : t.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2),
      );
    }
    for (const r of filtered) {
      const i = Math.min(buckets - 1, Math.floor((r.at - origin) / span));
      if (i >= 0) out[i] += 1;
    }
    return { values: out as number[], labels };
  }, [filtered, range]);

  const weekBars = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const g = Array(7).fill(0);
    const d = Array(7).fill(0);
    const origin = Date.now() / 1000 - 6 * 86400;
    for (const r of rows) {
      if (r.at < origin) continue;
      const i = (new Date(r.at * 1000).getDay() + 6) % 7;
      if (r.result === "ACCEPTED") g[i] += 1;
      else d[i] += 1;
    }
    return { labels, g, d };
  }, [rows]);

  return (
    <div className="fit-grid">
      <section className="fit-card motor-wrap">
        <MotorPanel s={s} online={online} view={view} onCommand={onCommand} />
      </section>

      <section className="fit-card">
        <GuardPanel s={s} online={online} view={view} />
      </section>

      <section className="fit-card">
        <div className="fit-card-head">
          <div>
            <span className="fit-kicker">RFID sign-ins</span>
            <h2>
              {granted}
              <small>
                {granted + denied
                  ? `${denied} denied this ${range}`
                  : `No scans this ${range}`}
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
        <LineChart values={spark.values} labels={spark.labels} />
      </section>

      <section className="fit-card">
        <div className="fit-card-head">
          <div>
            <span className="fit-kicker">Reader traffic</span>
            <h2>
              {weekBars.g.reduce((a, b) => a + b, 0) +
                weekBars.d.reduce((a, b) => a + b, 0)}
              <small>Last 7 days</small>
            </h2>
          </div>
        </div>
        <BarChart labels={weekBars.labels} granted={weekBars.g} denied={weekBars.d} />
      </section>
    </div>
  );
}
