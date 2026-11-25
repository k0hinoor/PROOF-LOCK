import { useMemo, useState } from "react";
import { Activity, Clock3, ShieldCheck, Zap } from "lucide-react";
import type { MachineView } from "./console";
import type { Sample, Status } from "./types";

type WindowSec = 30 | 60 | 120;

function adcPath(
  samples: Sample[],
  min: number,
  range: number,
  x0: number,
  y0: number,
  innerW: number,
  innerH: number,
) {
  const X = (at: number) => x0 + ((at - min) / range) * innerW;
  const Y = (adc: number) => y0 + innerH - (adc / 1024) * innerH;
  let line = "";
  let area = "";
  let pen = false;
  let end = x0;
  for (const s of samples) {
    if (s.adc == null) {
      if (pen) area += `L${end},${y0 + innerH}Z`;
      pen = false;
      continue;
    }
    const x = X(s.at);
    const y = Y(s.adc);
    line += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    area += pen ? `L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y0 + innerH}L${x.toFixed(1)},${y.toFixed(1)}`;
    end = x;
    pen = true;
  }
  if (pen) area += `L${end.toFixed(1)},${y0 + innerH}Z`;
  return { line, area, X, Y };
}

export function MachinePerformance({
  s,
  view,
  online,
}: {
  s?: Status;
  view: MachineView;
  online: boolean;
}) {
  const [range, setRange] = useState<WindowSec>(60);
  const [hover, setHover] = useState<number>();
  const samples = s?.samples ?? [];
  const lastAt = samples.at(-1)?.at ?? Date.now() / 1000;
  const min = lastAt - range;
  const visible = useMemo(
    () => samples.filter((p) => p.at >= min && p.adc != null),
    [samples, min],
  );
  const latestAdc = s?.latest?.back_emf_adc ?? visible.at(-1)?.adc ?? null;
  const peak = visible.reduce((n, p) => Math.max(n, p.adc ?? 0), 0);
  const vsRun =
    peak > 0 && latestAdc != null
      ? Math.round((1 - latestAdc / peak) * 100)
      : null;

  const coast =
    view.motor === "STOPPING" && s?.last_command?.action === "MOTOR_OFF"
      ? Math.max(0, lastAt - s.last_command.at)
      : null;

  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const w = 760;
  const h = 240;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const { line, area, X, Y } = adcPath(visible, min, range, pad.l, pad.t, innerW, innerH);

  const selected =
    hover === undefined
      ? undefined
      : visible.reduce<Sample | undefined>((best, p) => {
          if (p.adc == null) return best;
          if (!best) return p;
          return Math.abs(p.at - hover) < Math.abs(best.at - hover) ? p : best;
        }, undefined);

  const stale = !s?.fresh;
  const label =
    range === 30 ? "Live (Last 30s)" : range === 60 ? "Live (Last 1 min)" : "Live (Last 2 min)";

  return (
    <section className="perf">
      <header className="perf-head">
        <div>
          <span className="perf-kicker">ProofLock</span>
          <h2>Machine Performance</h2>
        </div>
        <div className="perf-range" role="tablist" aria-label="Live window">
          {([30, 60, 120] as WindowSec[]).map((v) => (
            <button
              key={v}
              type="button"
              className={range === v ? "on" : ""}
              onClick={() => setRange(v)}
            >
              {v === 30 ? "30s" : v === 60 ? "1m" : "2m"}
            </button>
          ))}
        </div>
      </header>
      <p className="perf-live">{stale ? "Last session" : label}</p>

      <div className="perf-kpis">
        <article className="perf-kpi peach">
          <span>
            <Activity size={14} /> Back-EMF (ADC)
          </span>
          <strong>{latestAdc == null ? "—" : latestAdc}</strong>
          <small>
            {vsRun == null
              ? "Uncalibrated counts"
              : vsRun >= 0
                ? `↓ ${vsRun}% vs window peak`
                : "Uncalibrated counts"}
          </small>
        </article>
        <article className="perf-kpi red">
          <span>
            <Zap size={14} /> Motor
          </span>
          <strong>{view.motor}</strong>
          <small>{online && s?.fresh ? "Reported state" : "No current feedback"}</small>
        </article>
        <article className="perf-kpi peach">
          <span>
            <Clock3 size={14} /> Coast time
          </span>
          <strong>{coast == null ? "—" : `${coast.toFixed(2)} s`}</strong>
          <small>
            {view.motor === "STOPPING"
              ? "Since stop command"
              : "Shown while the motor is stopping"}
          </small>
        </article>
        <article className="perf-kpi peach">
          <span>
            <ShieldCheck size={14} /> Guard status
          </span>
          <strong>{view.guard}</strong>
          <small>{view.safety}</small>
        </article>
      </div>

      <div className="perf-chart">
        {line ? (
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="perf-svg"
            role="img"
            aria-label="Standstill sensor over the selected window"
            onPointerLeave={() => setHover(undefined)}
            onPointerMove={(e) => {
              const svg = e.currentTarget;
              const box = svg.getBoundingClientRect();
              const x = ((e.clientX - box.left) / box.width) * w;
              setHover(min + ((x - pad.l) / innerW) * range);
            }}
          >
            <defs>
              <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--peach)" stopOpacity="0.45" />
                <stop offset="100%" stopColor="var(--peach)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 256, 512, 768, 1024].map((v) => (
              <g key={v}>
                <line
                  x1={pad.l}
                  x2={w - pad.r}
                  y1={Y(v)}
                  y2={Y(v)}
                  className="perf-grid"
                />
                <text x={pad.l - 8} y={Y(v) + 4} textAnchor="end" className="perf-axis">
                  {v === 1024 ? "1,024" : v}
                </text>
              </g>
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const at = min + (range * i) / 6;
              return (
                <text
                  key={i}
                  x={X(at)}
                  y={h - 8}
                  textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"}
                  className="perf-axis"
                >
                  {i === 0 ? "0s" : `${Math.round((range * i) / 6)}s`}
                </text>
              );
            })}
            <path d={area} fill="url(#perf-fill)" />
            <path d={line} className="perf-line peach" />
            {selected?.adc != null && (
              <>
                <line
                  x1={X(selected.at)}
                  x2={X(selected.at)}
                  y1={pad.t}
                  y2={pad.t + innerH}
                  className="perf-cursor"
                />
                <circle cx={X(selected.at)} cy={Y(selected.adc)} r="5" className="perf-dot peach" />
              </>
            )}
          </svg>
        ) : (
          <p className="muted-note">No standstill samples in this window.</p>
        )}
        {selected?.adc != null && (
          <div className="perf-tip">
            <b>t = {Math.max(0, selected.at - min).toFixed(0)} s</b>
            <span>
              Back-EMF: <em>{selected.adc}</em> counts
            </span>
            <span>Motor: {view.motor}</span>
          </div>
        )}
        <ul className="perf-legend">
          <li className="peach">Back-EMF (ADC counts)</li>
          <li className="red">Motor state · {view.motor}</li>
        </ul>
      </div>
    </section>
  );
}
