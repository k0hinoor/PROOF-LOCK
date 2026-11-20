import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleHelp,
  Clock3,
  Cpu,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { clock, dateTime, label } from "./lib";
import type { Record, Sample } from "./types";

export const tone = (value: string) =>
  ["RUNNING", "CLOSED", "LOCKED", "VERIFIED", "ACCEPTED", "AGREE"].includes(
    value,
  )
    ? "green"
    : ["FAULT", "SENSOR_FAULT", "MISMATCH", "ERROR", "DENIED", "OPEN"].includes(
          value,
        )
      ? "red"
      : [
            "WARNING",
            "STOPPING",
            "VERIFYING",
            "NOT_VERIFIED",
            "STALE",
            "RELEASED",
          ].includes(value)
        ? "amber"
        : ["INFO", "NOTICE", "STOPPED"].includes(value)
          ? "blue"
          : "muted";
export const display = (v: string) =>
  label(v)
    .toLowerCase()
    .replace(/(^|\s)\S/g, (s) => s.toUpperCase())
    .replace(/\bRfid\b/g, "RFID");
export function Badge({ value, dot = true }: { value: string; dot?: boolean }) {
  return (
    <span className={`badge ${tone(value)}`}>
      {dot && <i />}
      {label(value)}
    </span>
  );
}
export function Section({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Stat({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <section className="panel stat">
      <div className="stat-top">
        <span>{title}</span>
        <span className={`icon-box ${tone(value)}`}>
          <Icon size={17} />
        </span>
      </div>
      <strong className={tone(value)}>{display(value)}</strong>
      <small>{caption}</small>
    </section>
  );
}
export function Empty({
  text,
  icon: Icon = CircleHelp,
}: {
  text: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <Icon size={20} />
      <span>{text}</span>
    </div>
  );
}
export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="detail-rows">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Chart({
  samples,
  range,
  setRange,
  stale,
}: {
  samples: Sample[];
  range: number;
  setRange: (v: number) => void;
  stale: boolean;
}) {
  const [hover, setHover] = useState<number>();
  const clip = useId();
  const last = samples.at(-1)?.at ?? 0;
  const min = last - range;
  const visible = samples.filter((s) => s.at >= min);
  const selected =
    hover === undefined
      ? undefined
      : visible.reduce<Sample | undefined>(
          (best, s) =>
            !best || Math.abs(s.at - hover) < Math.abs(best.at - hover)
              ? s
              : best,
          undefined,
        );
  const X = (at: number) => 52 + ((at - min) / range) * 684;
  const Y = (adc: number) => 194 - (adc / 1024) * 170;
  let path = "",
    pen = false;
  visible.forEach((s) => {
    if (s.adc == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${X(s.at).toFixed(2)},${Y(s.adc).toFixed(2)}`;
    pen = true;
  });
  return (
    <Section
      title="Back-EMF trend"
      description="Raw analog input · ADC counts"
      className="chart-panel"
      action={
        <div className="segment" aria-label="Chart range">
          {[
            [30, "30s"],
            [120, "2m"],
            [300, "5m"],
          ].map(([v, n]) => (
            <button
              key={v}
              aria-pressed={range === v}
              onClick={() => setRange(Number(v))}
            >
              {n}
            </button>
          ))}
        </div>
      }
    >
      <div className="chart-info">
        <span>
          <i />
          Back-EMF ADC
        </span>
        <span className="mono">
          {stale
            ? "LAST SESSION"
            : selected?.adc != null
              ? `${selected.adc} counts · ${clock(selected.at)}`
              : "10-BIT INPUT"}
        </span>
      </div>
      {path ? (
        <div className={stale ? "chart stale" : "chart"}>
          <svg
            viewBox="0 0 755 226"
            role="img"
            aria-label={`Back-EMF ADC readings over the last ${range} seconds. Vertical axis zero to 1024 counts.`}
            onPointerLeave={() => setHover(undefined)}
            onPointerMove={(e) => {
              const matrix = e.currentTarget.getScreenCTM();
              if (!matrix) return;
              const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                matrix.inverse(),
              );
              setHover(min + ((point.x - 52) / 684) * range);
            }}
          >
            <defs>
              <clipPath id={clip}>
                <rect x="52" y="20" width="685" height="175" />
              </clipPath>
            </defs>
            {[0, 256, 512, 768, 1024].map((v) => (
              <g key={v}>
                <line x1="52" y1={Y(v)} x2="736" y2={Y(v)} />
                <text x="42" y={Y(v) + 4} textAnchor="end">
                  {v === 1024 ? "1,024" : v}
                </text>
              </g>
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((v) => {
              const at = min + (range * v) / 6;
              return (
                <g key={v}>
                  <line x1={X(at)} y1="24" x2={X(at)} y2="194" />
                  <text
                    x={X(at)}
                    y="216"
                    textAnchor={v === 6 ? "end" : v === 0 ? "start" : "middle"}
                  >
                    {clock(at)}
                  </text>
                </g>
              );
            })}
            <path className="trace" d={path} clipPath={`url(#${clip})`} />
            {selected?.adc != null && (
              <circle cx={X(selected.at)} cy={Y(selected.adc)} r="4" />
            )}
            {!selected && visible.length === 1 && visible[0].adc != null && (
              <circle cx={X(visible[0].at)} cy={Y(visible[0].adc)} r="3" />
            )}
          </svg>
        </div>
      ) : (
        <Empty icon={Activity} text="No ADC samples in this window" />
      )}
      <div className="chart-footer">
        <span>
          <Clock3 size={12} /> Receive time · local
        </span>
        <span>Uncalibrated signal</span>
      </div>
    </Section>
  );
}
export function EventTable({
  rows,
  compact = false,
  onSelect,
}: {
  rows: Record[];
  compact?: boolean;
  onSelect: (r: Record) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event</th>
            <th>Severity</th>
            {!compact && (
              <>
                <th>Category</th>
                <th>Details</th>
              </>
            )}
            <th>Source</th>
            <th aria-label="Open details" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono time">
                {compact ? clock(r.at) : dateTime(r.at)}
              </td>
              <td>
                <button className="event-name" onClick={() => onSelect(r)}>
                  {r.category === "rfid" ? (
                    <Fingerprint size={15} />
                  ) : r.category === "connection" ? (
                    <Cpu size={15} />
                  ) : r.code.startsWith("LOCK") ? (
                    <LockKeyhole size={15} />
                  ) : (
                    <Activity size={15} />
                  )}{" "}
                  {display(r.code)}
                </button>
              </td>
              <td>
                <Badge value={r.severity} />
              </td>
              {!compact && (
                <>
                  <td>{display(r.category)}</td>
                  <td>{r.details || "—"}</td>
                </>
              )}
              <td>
                <span className="source-text">
                  {r.source === "simulator"
                    ? "Simulator"
                    : r.origin === "device"
                      ? "Live device"
                      : "Dashboard"}
                </span>
              </td>
              <td>
                <button
                  className="icon-button"
                  onClick={() => onSelect(r)}
                  aria-label={`Inspect ${display(r.code)}`}
                >
                  <ArrowUpRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function EventDetail({
  record,
  close,
}: {
  record: Record;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="drawer">
        <div className="panel-head">
          <div>
            <div className="eyebrow">EVENT DETAILS</div>
            <h2>{display(record.code)}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <DetailRows
          rows={[
            ["Received", dateTime(record.at)],
            ["Severity", <Badge value={record.severity} />],
            ["Source", `${record.source} · ${record.origin}`],
            ["Category", record.category],
            ["Packet sequence", record.seq ?? "—"],
            ["Details", record.details || "—"],
          ]}
        />
        <div className="drawer-body">
          <h3>Telemetry at receipt</h3>
          {record.snapshot ? (
            <pre>{JSON.stringify(record.snapshot, null, 2)}</pre>
          ) : (
            <Empty text="No telemetry snapshot" icon={ShieldCheck} />
          )}
        </div>
      </div>
    </dialog>
  );
}
