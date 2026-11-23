import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Gauge,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  AccessGate,
  Attendance,
  ConsoleHeader,
  GuardPanel,
  LinkSettings,
  MotorPanel,
  StatusPanel,
  machineView,
} from "./console";
import {
  Chart,
  DetailRows,
  EventDetail,
  EventTable,
  Section,
  display,
} from "./components";
import { age, api, useClock, useEvents, useMonitor } from "./lib";
import type { Record, Status } from "./types";
import "./style.css";

function Maintenance({ s, online }: { s?: Status; online: boolean }) {
  const source = s?.source ?? "live";
  const [range, setRange] = useState(120);
  const [event, setEvent] = useState<Record>();
  const history = useEvents(
    `source=${source}&category=control&limit=12`,
    s?.revision,
  );
  const samples = s?.samples ?? [];
  return (
    <div className="maintenance">
      <Section
        title="Controller diagnostics"
        description="Kept out of the operator screen on purpose"
        action={<Activity size={17} className="dim" />}
      >
        <DetailRows
          rows={[
            [
              "Link",
              online
                ? s?.connected
                  ? "Connected"
                  : "Disconnected"
                : "Unavailable",
            ],
            ["Port", s?.port ?? "—"],
            ["Baud rate", s?.baud ?? "—"],
            [
              "Last telemetry",
              s?.telemetry_age == null ? "—" : `${age(s.telemetry_age)} ago`,
            ],
            ["Valid packets", s?.valid ?? "—"],
            ["Rejected frames", s?.invalid ?? "—"],
            ["Last rejection", s?.last_parse_error || "—"],
            ["Commands sent", s?.tx_commands ?? 0],
            [
              "Guard switch fitted",
              s?.guard_fitted === false
                ? "No"
                : s?.guard_fitted
                  ? "Yes"
                  : "Unknown",
            ],
            [
              "Lock sensor fitted",
              s?.lock_fitted === false
                ? "No"
                : s?.lock_fitted
                  ? "Yes"
                  : "Unknown",
            ],
          ]}
        />
      </Section>
      <Section
        title="Raw standstill signal"
        description="For bench calibration only"
        action={<Gauge size={17} className="dim" />}
      >
        <Chart
          samples={samples}
          range={range}
          setRange={setRange}
          stale={!s?.fresh}
        />
      </Section>
      <Section
        title="Control history"
        description="Every command, including refusals"
        action={<ClipboardList size={17} className="dim" />}
      >
        {history?.rows.length ? (
          <EventTable rows={history.rows} onSelect={setEvent} compact />
        ) : (
          <p className="muted-note">
            {history?.error || "No commands recorded for this source."}
          </p>
        )}
      </Section>
      {event && (
        <EventDetail record={event} close={() => setEvent(undefined)} />
      )}
    </div>
  );
}

function Console() {
  const { state: s, link, refresh } = useMonitor();
  const now = useClock();
  const online = link === "online";
  const view = machineView(s, online);
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState<"console" | "maintenance">("console");
  const [banner, setBanner] = useState<{ text: string; tone: "ok" | "warn" }>();
  const signedIn = Boolean(s?.access);
  const sim = s?.source === "simulator";

  useEffect(() => {
    if (!signedIn) setPage("console");
  }, [signedIn]);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(undefined), 6000);
    return () => window.clearTimeout(id);
  }, [banner]);

  // The board only keeps the motor energised while MOTOR_ON keeps arriving.
  // This refreshes that permit about once a second; if this page closes, the
  // laptop sleeps or the link drops, the machine stops itself.
  const running = s?.source !== "simulator" && s?.latest?.motor === "RUNNING";
  useEffect(() => {
    if (!running || !online || !signedIn) return;
    const id = window.setInterval(() => {
      api("/api/control", { action: "MOTOR_ON", permit: true }).catch(
        () => undefined,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, online, signedIn]);

  async function command(action: "MOTOR_ON" | "MOTOR_OFF") {
    try {
      const result = await api<{
        accepted: boolean;
        reason: string;
        delivered?: boolean;
      }>("/api/control", { action, permit: false });
      setBanner({
        text: result.accepted
          ? result.delivered === false
            ? `${action === "MOTOR_ON" ? "Start" : "Stop"} accepted, but not delivered: ${result.reason}`
            : `${action === "MOTOR_ON" ? "Start" : "Stop"} command sent.`
          : result.reason,
        tone: result.accepted && result.delivered !== false ? "ok" : "warn",
      });
      refresh();
    } catch (e) {
      setBanner({ text: (e as Error).message, tone: "warn" });
      throw e;
    }
  }

  async function lock() {
    try {
      await api("/api/access/logout", {});
    } finally {
      refresh();
    }
  }

  return (
    <div className="console-shell">
      <ConsoleHeader s={s} online={online} now={now} onLock={lock} />
      {!signedIn ? (
        <AccessGate s={s} online={online} onChanged={refresh} />
      ) : (
        <>
          <div className="console-toolbar">
            <nav className="console-tabs" aria-label="Console sections">
              <button
                className={page === "console" ? "active" : ""}
                onClick={() => setPage("console")}
              >
                <ShieldCheck size={15} /> Machine
              </button>
              <button
                className={page === "maintenance" ? "active" : ""}
                onClick={() => setPage("maintenance")}
              >
                <Activity size={15} /> Diagnostics
              </button>
            </nav>
            <div className="toolbar-right">
              {sim && <span className="chip sim">SIMULATED DATA</span>}
              {!s?.fresh && (
                <span className="chip warn">
                  <i /> No current feedback
                </span>
              )}
              <button
                className="button small"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={14} /> Machine link
              </button>
            </div>
          </div>

          {banner && (
            <div className={`console-banner ${banner.tone}`} role="status">
              {banner.tone === "ok" ? (
                <CheckCircle2 size={16} />
              ) : (
                <CircleAlert size={16} />
              )}
              <span>{banner.text}</span>
              <button onClick={() => setBanner(undefined)} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}

          {page === "console" ? (
            <>
              <main className="console-grid">
                <MotorPanel
                  s={s}
                  online={online}
                  view={view}
                  onCommand={command}
                />
                <GuardPanel s={s} online={online} view={view} />
                <StatusPanel s={s} online={online} view={view} />
              </main>
              <Attendance s={s} onChanged={refresh} />
            </>
          ) : (
            <main className="console-maintenance">
              <Maintenance s={s} online={online} />
            </main>
          )}
        </>
      )}
      <footer className="console-foot">
        <span>
          <ShieldCheck size={13} /> Release is decided by the machine's own
          interlock.
        </span>
        <span className="mono">
          {sim ? "Hardware simulator" : (s?.port ?? "No controller")} ·{" "}
          {display(s?.source ?? "live")}
        </span>
        <button className="link-button" onClick={() => setSettings(true)}>
          <ChevronDown size={13} /> Machine link
        </button>
      </footer>
      <LinkSettings s={s} open={settings} close={() => setSettings(false)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Console />);
