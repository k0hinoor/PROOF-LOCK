import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  Cable,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Cpu,
  DoorClosed,
  Download,
  Fingerprint,
  Gauge,
  LayoutDashboard,
  LockKeyhole,
  Radio,
  RefreshCw,
  Settings2,
  Shield,
  ShieldCheck,
  Timer,
  Usb,
  Wrench,
} from "lucide-react";
import {
  Badge,
  Chart,
  DetailRows,
  display,
  Empty,
  EventDetail,
  EventTable,
  Section,
  Stat,
  tone,
} from "./components";
import {
  age,
  api,
  clock,
  dateTime,
  useEvents,
  useMonitor,
  usePreference,
} from "./lib";
import type { Record, Source, Status } from "./types";
import "./style.css";

const pages = [
  [
    "Overview",
    LayoutDashboard,
    "Monitor machine states and controller telemetry.",
  ],
  [
    "Events",
    ClipboardList,
    "Review, filter and export the local event history.",
  ],
  [
    "Operators",
    Fingerprint,
    "Review RFID presentations reported by the controller.",
  ],
  [
    "Diagnostics",
    Activity,
    "Inspect link health, signals and protocol validation.",
  ],
  ["Settings", Settings2, "Manage the local console, serial link and data."],
] as const;
type Page = (typeof pages)[number][0];
const href = (p: Page) => `#${p.toLowerCase()}`;
const currentPage = () =>
  pages.find(([name]) => href(name) === location.hash)?.[0] ?? "Overview";
const query = (params: { [key: string]: string | number }) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

function Overview({
  s,
  online,
  range,
  setRange,
  inspect,
  source,
}: {
  s?: Status;
  online: boolean;
  range: number;
  setRange: (n: number) => void;
  inspect: (r: Record) => void;
  source: Source;
}) {
  const fresh = online && s?.fresh;
  const t = fresh ? s?.latest : null;
  const channelA = t?.guard_a ?? "UNKNOWN",
    channelB = t?.guard_b ?? "UNKNOWN";
  const guard =
    channelA === "FAULT" || channelB === "FAULT"
      ? "FAULT"
      : t && s?.mismatch
        ? "MISMATCH"
        : channelA === channelB
          ? channelA
          : "UNKNOWN";
  const events = useEvents(query({ source, limit: 6 }), s?.revision);
  const rfid = useEvents(
    query({ source, category: "rfid", limit: 1 }),
    s?.revision,
  )?.rows[0];
  return (
    <>
      <div className="workspace-label">
        <span>LIVE SIGNALS</span>
        <span>
          <Radio size={13} />{" "}
          {source === "simulator"
            ? "Simulated controller"
            : (s?.port ?? "No serial port")}
        </span>
      </div>
      <div className="stat-grid">
        <Stat
          title="Motor state"
          value={t?.motor ?? "UNKNOWN"}
          caption={
            t
              ? "Controller-reported state"
              : s?.latest
                ? "Last reading is stale"
                : "Awaiting valid telemetry"
          }
          icon={Gauge}
        />
        <Stat
          title="Guard inputs"
          value={guard}
          caption={
            guard === "MISMATCH"
              ? "Channels A and B disagree"
              : guard === "FAULT"
                ? "Guard channel fault"
                : guard === "UNKNOWN"
                  ? "Both inputs required"
                  : "Channels A and B agree"
          }
          icon={DoorClosed}
        />
        <Stat
          title="Lock state"
          value={t?.lock ?? "UNKNOWN"}
          caption={
            t && t.lock !== "UNKNOWN"
              ? "Reported feedback"
              : "Feedback unavailable"
          }
          icon={LockKeyhole}
        />
        <Stat
          title="Standstill"
          value={t?.standstill ?? "UNKNOWN"}
          caption="Explicit controller verification"
          icon={ShieldCheck}
        />
      </div>
      <div className="overview-grid">
        <Chart
          samples={s?.samples ?? []}
          range={range}
          setRange={setRange}
          stale={!fresh}
        />
        <Section
          title="Machine sequence"
          description={
            fresh ? "Reported standstill transitions" : "No current sequence"
          }
          action={<Timer size={17} className="dim" />}
          className="sequence-panel"
        >
          {s?.sequence.length ? (
            <ol className={`timeline ${!fresh ? "old" : ""}`}>
              {s.sequence.slice(0, 4).map((item, i) => (
                <li key={`${item.at}-${i}`}>
                  <i className={tone(item.state)} />
                  <div>
                    <strong>{display(item.state)}</strong>
                    <small>
                      {i === 0
                        ? fresh
                          ? "Latest reported state"
                          : "Last received · stale"
                        : "Received transition"}
                    </small>
                  </div>
                  <time className="mono">{clock(item.at)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <Empty text="No reported transitions yet" icon={Timer} />
          )}
        </Section>
        <Section
          title="Recent events"
          description="Latest records from the current data source"
          action={
            <a className="button small" href="#events">
              View all <ArrowRight size={14} />
            </a>
          }
          className="recent"
        >
          {events?.rows.length ? (
            <EventTable rows={events.rows} compact onSelect={inspect} />
          ) : (
            <Empty
              icon={ClipboardList}
              text={
                events?.error ||
                (!events ? "Loading events…" : "No events recorded yet")
              }
            />
          )}
        </Section>
        <div className="side-stack">
          <Section
            title="Guard channels"
            action={<DoorClosed size={17} className="dim" />}
          >
            <DetailRows
              rows={[
                ["Channel A", <Badge value={channelA} />],
                ["Channel B", <Badge value={channelB} />],
                [
                  "Agreement",
                  <Badge
                    value={
                      guard === "MISMATCH"
                        ? "MISMATCH"
                        : ["CLOSED", "OPEN"].includes(guard)
                          ? "AGREE"
                          : "UNKNOWN"
                    }
                  />,
                ],
              ]}
            />
          </Section>
          <Section
            title="Last RFID event"
            action={
              <a
                className="icon-button"
                href="#operators"
                aria-label="Open operators"
              >
                <Fingerprint size={17} />
              </a>
            }
          >
            {rfid ? (
              <DetailRows
                rows={[
                  [
                    rfid.details,
                    <Badge value={rfid.code.replace("RFID_", "")} />,
                  ],
                  ["Received", dateTime(rfid.at)],
                ]}
              />
            ) : (
              <Empty text="No RFID event recorded" icon={Fingerprint} />
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function History({
  source,
  s,
  operators,
  inspect,
}: {
  source: Source;
  s?: Status;
  operators: boolean;
  inspect: (r: Record) => void;
}) {
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [windowDays, setDays] = useState("0");
  const [offset, setOffset] = useState(0);
  const [historySource, setHistorySource] = useState(source);
  const [anchor, setAnchor] = useState(() => Date.now() / 1000);
  const since = Number(windowDays)
    ? Math.floor(anchor - Number(windowDays) * 86400)
    : 0;
  const params = {
    source: historySource,
    category: operators ? "rfid" : category,
    severity,
    search,
    since,
  };
  const result = useEvents(
    query({ ...params, offset, limit: 25 }),
    s?.revision,
  );
  function change(set: (v: string) => void, v: string) {
    set(v);
    setOffset(0);
    setAnchor(Date.now() / 1000);
  }
  return (
    <Section
      title={operators ? "RFID activity" : "Event history"}
      description={
        operators
          ? "Only short operator references are stored. RFID is not a safety decision."
          : "Device reports and dashboard observations are recorded separately."
      }
      action={
        <a
          className="button primary"
          href={`/api/events/export?${query(params)}`}
        >
          <Download size={15} /> Export CSV
        </a>
      }
    >
      <div className="filters">
        <label>
          Search
          <input
            placeholder={operators ? "Operator reference" : "Event or operator"}
            maxLength={100}
            value={search}
            onChange={(e) => change(setSearch, e.target.value)}
          />
        </label>
        <label>
          Time range
          <select
            value={windowDays}
            onChange={(e) => change(setDays, e.target.value)}
          >
            <option value="0">All time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
        {!operators && (
          <label>
            Category
            <select
              value={category}
              onChange={(e) => change(setCategory, e.target.value)}
            >
              <option value="">All categories</option>
              {[
                "state",
                "connection",
                "protocol",
                "rfid",
                "event",
                "diagnostic",
              ].map((v) => (
                <option key={v} value={v}>
                  {display(v)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => change(setSeverity, e.target.value)}
          >
            <option value="">All severities</option>
            {["INFO", "NOTICE", "WARNING", "ERROR"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Data source
          <select
            disabled={s?.preview}
            value={historySource}
            onChange={(e) =>
              change((v) => setHistorySource(v as Source), e.target.value)
            }
          >
            <option value="live">Live hardware</option>
            <option value="simulator">Simulator</option>
          </select>
        </label>
      </div>
      {result?.rows.length ? (
        <EventTable rows={result.rows} onSelect={inspect} />
      ) : (
        <Empty
          icon={operators ? Fingerprint : ClipboardList}
          text={
            result?.error ||
            (!result
              ? "Loading history…"
              : operators
                ? "No RFID activity matches these filters."
                : "No events match these filters.")
          }
        />
      )}
      <div className="pagination">
        <span>
          {result?.rows.length
            ? `Showing ${offset + 1}–${offset + result.rows.length}`
            : "No matching records shown"}
        </span>
        <button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 25))}
        >
          Previous
        </button>
        <button
          disabled={!result?.more}
          onClick={() => setOffset((v) => v + 25)}
        >
          Next
        </button>
      </div>
    </Section>
  );
}

function Diagnostics({
  s,
  online,
  source,
  range,
}: {
  s?: Status;
  online: boolean;
  source: Source;
  range: number;
}) {
  const [copy, setCopy] = useState("");
  const t = s?.latest;
  async function copyStatus() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          s ? { ...s, samples: undefined } : { service: "unavailable" },
          null,
          2,
        ),
      );
      setCopy("Copied");
    } catch {
      setCopy("Clipboard unavailable");
    }
  }
  return (
    <div className="generic-grid">
      <Section
        title="Serial connection"
        description="Transport and application health"
        action={<Cable size={17} className="dim" />}
      >
        <DetailRows
          rows={[
            ["Backend", online ? "Available" : "Unavailable"],
            [
              "Link",
              !online ? "Unknown" : s?.connected ? "Connected" : "Disconnected",
            ],
            ["Port", s?.port ?? "—"],
            ["Baud rate", s?.baud ?? "—"],
            ["Session started", s?.since ? dateTime(s.since) : "—"],
            ["Last valid packet", age(s?.packet_age)],
            ["Last telemetry", age(s?.telemetry_age)],
            ["Link message", s?.error || "—"],
          ]}
        />
      </Section>
      <Section
        title="Device identity"
        description="Metadata reported by firmware"
        action={<Cpu size={17} className="dim" />}
      >
        <DetailRows
          rows={[
            ["Device", s?.meta.device ?? "—"],
            ["Firmware", s?.meta.firmware ?? "—"],
            ["Protocol version", s?.meta.v ?? "—"],
            [
              "Uptime",
              s?.meta.uptime_ms == null ? "—" : `${s.meta.uptime_ms} ms`,
            ],
            [
              "Data source",
              source === "simulator" ? "Simulator" : "Live hardware",
            ],
          ]}
        />
      </Section>
      <Section
        title="Packet health"
        description="Counters for the current session"
        action={
          <button className="small" onClick={copyStatus}>
            {copy || "Copy diagnostics"}
          </button>
        }
      >
        <DetailRows
          rows={[
            ["Latest telemetry sequence", t?.seq ?? "—"],
            ["Valid packets", s?.valid ?? "—"],
            ["Malformed packets", s?.invalid ?? "—"],
            ["Missing sequence count", s?.missing ?? "—"],
            ["Ignored fields", s?.unknown ?? "—"],
            ["Latest protocol warning", s?.last_warning || "—"],
          ]}
        />
      </Section>
      <Section
        title="Sensor readings"
        description={
          online && s?.fresh
            ? "Current telemetry"
            : "Last received context · not current"
        }
        action={
          <a
            className="button small"
            href={`/api/telemetry/export?${query({ source, since: (s?.samples.at(-1)?.at ?? Date.now() / 1000) - range, until: s?.samples.at(-1)?.at ?? Date.now() / 1000 })}`}
          >
            <Download size={14} /> Export window
          </a>
        }
      >
        <DetailRows
          rows={[
            [
              "Raw back-EMF",
              t?.back_emf_adc == null ? "—" : `${t.back_emf_adc} counts`,
            ],
            ["Calibrated voltage", "Not configured"],
            ["Guard A", t?.guard_a ? display(t.guard_a) : "—"],
            ["Guard B", t?.guard_b ? display(t.guard_b) : "—"],
            [
              "Guard disagreement",
              !t
                ? "—"
                : s?.mismatch
                  ? "Mismatch reported"
                  : "No open/closed mismatch reported",
            ],
            ["Standstill report", t?.standstill ? display(t.standstill) : "—"],
          ]}
        />
      </Section>
    </div>
  );
}

function Preferences({
  s,
  online,
  theme,
  setTheme,
  range,
  setRange,
  density,
  setDensity,
}: {
  s?: Status;
  online: boolean;
  theme: string;
  setTheme: (v: string) => void;
  range: number;
  setRange: (v: number) => void;
  density: string;
  setDensity: (v: string) => void;
}) {
  const [config, setConfig] = usePreference("serial", {
    port: "",
    baud: 115200,
    timeout: 0.25,
    reconnect: true,
  });
  const [ports, setPorts] = useState<{ port: string; description: string }[]>(
    [],
  );
  const [portError, setPortError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [days, setDays] = usePreference("retentionDays", 30);
  async function refresh() {
    try {
      setPorts(await api("/api/ports"));
      setPortError("");
    } catch (e) {
      setPortError((e as Error).message);
    }
  }
  useEffect(() => {
    if (online) void refresh();
  }, [online]);
  async function action(route: string, body: object, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(route, body);
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const disabled = !online || busy || s?.preview;
  return (
    <>
      {message && (
        <div className="notice" role="status">
          <CircleAlert size={16} />
          {message}
        </div>
      )}
      <div className="generic-grid">
        <Section
          title="USB serial"
          description="Choose the port and baud rate used by your Arduino firmware."
          action={
            <button className="small" onClick={refresh} disabled={disabled}>
              <RefreshCw size={14} /> Refresh ports
            </button>
          }
        >
          <div className="form">
            <label>
              Serial port
              <select
                disabled={disabled}
                value={config.port}
                onChange={(e) => setConfig({ ...config, port: e.target.value })}
              >
                <option value="">Select port</option>
                {config.port && !ports.some((p) => p.port === config.port) && (
                  <option value={config.port}>
                    {config.port} (unavailable)
                  </option>
                )}
                {ports.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.port} · {p.description}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-columns">
              <label>
                Baud rate
                <input
                  disabled={disabled}
                  type="number"
                  min="300"
                  max="1000000"
                  value={config.baud}
                  onChange={(e) =>
                    setConfig({ ...config, baud: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Read timeout (s)
                <input
                  disabled={disabled}
                  type="number"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={config.timeout}
                  onChange={(e) =>
                    setConfig({ ...config, timeout: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                disabled={disabled}
                checked={config.reconnect}
                onChange={(e) =>
                  setConfig({ ...config, reconnect: e.target.checked })
                }
              />{" "}
              Reconnect after link loss
            </label>
            <p className="form-note">
              {portError ||
                s?.error ||
                (s?.preview
                  ? "USB access is disabled in this browser preview."
                  : ports.length
                    ? "Opening a port can reset some Arduino Uno boards."
                    : "No serial ports detected. Connect your board and refresh.")}
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={
                  disabled || !ports.some((p) => p.port === config.port)
                }
                onClick={() =>
                  action(
                    "/api/device/connect",
                    config,
                    "Connection requested. Watch for valid telemetry.",
                  )
                }
              >
                <Cable size={15} /> Connect USB
              </button>
              <button
                disabled={disabled || !s?.port}
                onClick={() =>
                  action(
                    "/api/device/disconnect",
                    {},
                    "Serial monitoring disconnected.",
                  )
                }
              >
                Disconnect
              </button>
            </div>
          </div>
        </Section>
        <Section
          title="Display"
          description="Preferences are saved in this browser."
        >
          <div className="form">
            <label>
              Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="dark">Midnight</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label>
              Chart window
              <select
                value={range}
                onChange={(e) => setRange(Number(e.target.value))}
              >
                <option value="30">30 seconds</option>
                <option value="120">2 minutes</option>
                <option value="300">5 minutes</option>
              </select>
            </label>
            <label>
              Table density
              <select
                value={density}
                onChange={(e) => setDensity(e.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
        </Section>
        <Section
          title="Simulator"
          description="Deterministic sample data, stored apart from hardware records."
          action={<Radio size={17} className="dim" />}
        >
          <div className="form">
            <p className="form-note">
              {s?.preview
                ? "This preview is locked to simulator mode."
                : "Starting simulation closes any local USB monitoring session."}
            </p>
            <div className="actions">
              <button
                disabled={disabled}
                onClick={() =>
                  action(
                    "/api/simulator",
                    { enabled: s?.source !== "simulator" },
                    s?.source === "simulator"
                      ? "Simulator stopped."
                      : "Simulator started.",
                  )
                }
              >
                {s?.source === "simulator"
                  ? "Stop simulator"
                  : "Start simulator"}
              </button>
            </div>
          </div>
        </Section>
        <Section
          title="Local records"
          description="Saved records are kept until you explicitly clean them up."
          action={<ClipboardList size={17} className="dim" />}
        >
          <div className="form">
            <label>
              Keep records from the last (days)
              <input
                disabled={disabled}
                type="number"
                min="1"
                max="3650"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <div className="actions">
              <button
                disabled={disabled || days < 1 || days > 3650}
                onClick={() => {
                  if (
                    confirm(
                      `Permanently delete live and simulator records older than ${days} days?`,
                    )
                  )
                    void action(
                      "/api/data/prune",
                      { days },
                      "Older records removed.",
                    );
                }}
              >
                Clean up older records
              </button>
            </div>
          </div>
        </Section>
        <Section
          title="About ProofLock"
          description="Student prototype · monitoring only"
          action={<Shield size={17} className="dim" />}
        >
          <DetailRows
            rows={[
              ["Dashboard", "1.0.0"],
              ["Supported protocol", "v1"],
              ["Units", "Raw ADC counts"],
              [
                "Hardware configuration",
                "Read-only; managed outside this console",
              ],
            ]}
          />
        </Section>
      </div>
    </>
  );
}

function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const { state: s, link } = useMonitor();
  const online = link === "online";
  const [theme, setTheme] = usePreference("theme", "dark");
  const [range, setRange] = usePreference("range", 120);
  const [density, setDensity] = usePreference("density", "comfortable");
  const [event, setEvent] = useState<Record>();
  useEffect(() => {
    const update = () => {
      setPage(currentPage());
      setEvent(undefined);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);
  const source = s?.source ?? "live";
  const sim = source === "simulator";
  const subtitle = pages.find((p) => p[0] === page)?.[2];
  const linkText =
    link === "loading"
      ? "Connecting to service"
      : !online
        ? "Service unavailable"
        : s?.fresh
          ? sim
            ? "Stream active"
            : "USB connected"
          : s?.connected
            ? s.latest
              ? "Telemetry stale"
              : "Waiting for telemetry"
            : "USB disconnected";
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-icon">
            <ShieldCheck size={23} />
          </span>
          <span>
            <b>ProofLock</b>
            <small>MONITORING CONSOLE</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace">
          {pages.map(([name, Icon]) => (
            <a
              href={href(name)}
              aria-label={name}
              title={name}
              key={name}
              className={page === name ? "active" : ""}
              aria-current={page === name ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{name}</span>
              {page === name && (
                <ChevronRight size={14} className="nav-arrow" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="node">
            <Cpu size={19} />
            <div>
              <strong>Arduino Uno</strong>
              <small>
                {sim ? "Simulated node" : (s?.port ?? "No serial device")}
              </small>
            </div>
          </div>
          <div className="version">
            <span>LOCAL WORKSPACE</span>
            <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="desk">
        <header className="topbar">
          <div className="crumb">
            <LayoutDashboard size={15} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-status">
            <span
              className={s?.fresh && online ? "link-dot online" : "link-dot"}
            />
            {linkText}
            {online && s?.port && (
              <span className="top-extra mono">{s.port}</span>
            )}
            {online && s?.packet_age != null && (
              <span className="top-extra mono" title="Age of last valid packet">
                {age(s.packet_age)}
              </span>
            )}
            <span className="top-separator" />
            <span className={sim ? "mode sim" : "mode"}>
              {sim ? "SIMULATOR" : "LIVE MODE"}
            </span>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div>
              <div className="eyebrow">
                <span /> PROOFLOCK / MONITORING
              </div>
              <h1>{page === "Overview" ? "Machine overview" : page}</h1>
              <p>{subtitle}</p>
            </div>
            {page !== "Settings" && (
              <a className="button" href="#settings">
                <Usb size={16} /> Device settings <ChevronRight size={14} />
              </a>
            )}
          </div>
          {sim && (
            <div className="notice simulator">
              <Radio size={17} />
              <strong>Simulator mode</strong>
              <span>
                Viewing generated telemetry. No physical hardware is connected.
              </span>
              <span className="notice-tail">SIMULATED SOURCE</span>
            </div>
          )}
          {(!online ||
            s?.error ||
            s?.storage_error ||
            (!sim && s?.connected && !s.fresh)) && (
            <div className="notice issue" role="status">
              <CircleAlert size={17} />
              <span>
                {!online
                  ? link === "loading"
                    ? "Connecting to the local service…"
                    : "Local service unavailable. Previously received telemetry is not current."
                  : [
                      s?.error,
                      s?.storage_error,
                      s?.connected && !s.fresh
                        ? "Waiting for fresh protocol v1 telemetry. Check firmware, baud rate and USB connection."
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </span>
            </div>
          )}
          {page === "Overview" && (
            <Overview
              s={s}
              online={online}
              range={range}
              setRange={setRange}
              inspect={setEvent}
              source={source}
            />
          )}
          {(page === "Events" || page === "Operators") && (
            <History
              key={`${page}-${source}`}
              source={source}
              s={s}
              operators={page === "Operators"}
              inspect={setEvent}
            />
          )}
          {page === "Diagnostics" && (
            <Diagnostics s={s} online={online} source={source} range={range} />
          )}
          {page === "Settings" && (
            <Preferences
              s={s}
              online={online}
              theme={theme}
              setTheme={setTheme}
              range={range}
              setRange={setRange}
              density={density}
              setDensity={setDensity}
            />
          )}
          <footer>
            <span>
              <Shield size={13} /> Read-only observer · independent hardware
              interlock
            </span>
            <span>
              <Wrench size={13} /> Protocol {s?.meta.v ?? "v1 supported"}{" "}
              <span className="dot-sep">·</span> Updated{" "}
              {online ? age(s?.telemetry_age) : "—"}
              {online && s?.telemetry_age != null ? " ago" : ""}
            </span>
          </footer>
        </main>
      </div>
      {event && (
        <EventDetail record={event} close={() => setEvent(undefined)} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
