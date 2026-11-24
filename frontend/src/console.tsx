import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Cable,
  CircleDot,
  Fan,
  FilePlus2,
  Fingerprint,
  LockKeyhole,
  LogOut,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  UserRound,
} from "lucide-react";
import { api, clock, dateTime } from "./lib";
import { LiquidGlassThemeToggle } from "./theme-toggle";
import type { AttendanceRow, Status } from "./types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export type MachineView = {
  motor: "RUNNING" | "STOPPING" | "STOPPED" | "FAULT" | "UNKNOWN";
  guard: "LOCKED" | "UNLOCKED" | "FAULT" | "UNKNOWN";
  safety: string;
  safetyTone: "ok" | "warn" | "bad" | "idle";
  level: number; // 0..1 estimated rotational energy, for the fan only
  tone: "ok" | "warn" | "bad" | "idle";
  /** Why a start would be refused, from reported feedback only. */
  startBlocked: string;
};

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Everything shown to the engineer is derived from reported feedback only. */
export function machineView(s?: Status, online = true): MachineView {
  const fresh = Boolean(online && s?.fresh);
  const t = fresh ? s?.latest : null;
  if (!t) {
    return {
      motor: "UNKNOWN",
      guard: "UNKNOWN",
      safety: online
        ? s?.connected
          ? s?.latest
            ? "No current feedback from the machine"
            : "Waiting for the machine"
          : "Machine controller not connected"
        : "Console service unavailable",
      safetyTone: "idle",
      level: 0,
      tone: "idle",
      startBlocked: online
        ? "Waiting for current machine feedback"
        : "Console service unavailable",
    };
  }
  const motor = t.motor;
  // Only reported lock feedback may say the guard is released. A verified
  // standstill is a precondition, never proof of release by itself.
  const guard: MachineView["guard"] =
    t.lock === "FAULT" || t.standstill === "SENSOR_FAULT"
      ? "FAULT"
      : t.lock === "RELEASED"
        ? "UNLOCKED"
        : t.lock === "LOCKED"
          ? "LOCKED"
          : "UNKNOWN";

  let safety = "Waiting for standstill verification";
  let safetyTone: MachineView["safetyTone"] = "idle";
  if (
    t.standstill === "SENSOR_FAULT" ||
    t.lock === "FAULT" ||
    motor === "FAULT"
  ) {
    safety = "Safety system fault — do not open the guard";
    safetyTone = "bad";
  } else if (t.standstill === "VERIFIED" && guard === "UNLOCKED") {
    safety = "Standstill verified — safe to open the guard";
    safetyTone = "ok";
  } else if (t.standstill === "VERIFIED" && guard === "LOCKED") {
    safety = "Standstill verified — guard release pending";
    safetyTone = "ok";
  } else if (motor === "STOPPING" || t.standstill === "VERIFYING") {
    safety = "Waiting for the motor to stop — guard stays locked";
    safetyTone = "warn";
  } else if (motor === "RUNNING") {
    safety = "Motor running — guard locked";
    safetyTone = "ok";
  } else if (t.standstill === "NOT_VERIFIED") {
    safety = "Motor stopped — standstill not yet verified";
    safetyTone = "warn";
  }

  const adc = t.back_emf_adc ?? 0;
  const level =
    motor === "RUNNING"
      ? clamp(0.55 + adc / 1600)
      : motor === "STOPPING"
        ? clamp(adc / 700)
        : 0;
  const tone: MachineView["tone"] =
    motor === "FAULT"
      ? "bad"
      : motor === "RUNNING"
        ? "ok"
        : motor === "STOPPING"
          ? "warn"
          : motor === "STOPPED"
            ? "idle"
            : "idle";
  const startBlocked =
    guard === "FAULT" || motor === "FAULT" || t.standstill === "SENSOR_FAULT"
      ? "Safety system fault"
      : guard === "UNLOCKED"
        ? "The guard is open"
        : guard !== "LOCKED"
          ? "Guard lock is not confirmed"
          : motor === "RUNNING"
            ? "Motor is already running"
            : motor === "STOPPING"
              ? "Motor is still stopping"
              : "";
  return { motor, guard, safety, safetyTone, level, tone, startBlocked };
}

/* ------------------------------------------------------------------ */
/* Fan                                                                 */
/* ------------------------------------------------------------------ */

export function FanRotor({
  view,
  size = 210,
}: {
  view: MachineView;
  size?: number;
}) {
  const [speed, setSpeed] = useState(0); // degrees per second
  const angle = useRef(0);
  const last = useRef(performance.now());
  const [render, setRender] = useState(0);
  const target =
    view.motor === "RUNNING"
      ? 520
      : view.motor === "STOPPING"
        ? 520 * clamp(view.level) ** 0.8
        : 0;

  useEffect(() => {
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last.current) / 1000);
      last.current = now;
      // Ease toward the reported state, so STOPPING visibly decelerates.
      setSpeed((v) =>
        Math.abs(target - v) < 1
          ? target
          : v + (target - v) * Math.min(1, dt * 2.2),
      );
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const dt = (now - previous) / 1000;
      previous = now;
      if (speed > 0.2) {
        angle.current = (angle.current + speed * dt) % 360;
        setRender((n) => n + 1);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [speed]);

  const moving = speed > 0.2;
  const blur = clamp(speed / 1300, 0, 0.55);
  return (
    <div
      className={`rotor ${moving ? "moving" : "still"} ${view.tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Motor ${view.motor.toLowerCase()}`}
      data-angle={render}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        <circle className="rotor-ring" cx="100" cy="100" r="94" />
        <circle className="rotor-ring inner" cx="100" cy="100" r="72" />
        <g
          className="rotor-blades"
          style={{ transform: `rotate(${angle.current}deg)` }}
        >
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 100 100)`}>
              <path d="M100 100 C 116 84, 124 58, 112 30 C 100 40, 92 62, 94 86 Z" />
            </g>
          ))}
        </g>
        <circle className="rotor-hub" cx="100" cy="100" r="15" />
        <circle className="rotor-hub-dot" cx="100" cy="100" r="4" />
        {moving && (
          <g className="rotor-motion" style={{ opacity: blur }}>
            <circle cx="100" cy="100" r="56" />
          </g>
        )}
      </svg>
      <span className="rotor-caption">{view.motor}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-in gate                                                        */
/* ------------------------------------------------------------------ */

export function AccessGate({
  s,
  online,
  onChanged,
}: {
  s?: Status;
  online: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [port, setPort] = useState("");
  const [ports, setPorts] = useState<{ port: string; description: string }[]>(
    [],
  );
  const denied = Boolean(s?.last_unauthorised) && !s?.access;
  const configured = Boolean(s?.operator.configured);
  const connected = Boolean(online && s?.connected);
  const sim = s?.source === "simulator";
  const operators = s?.operator.operators ?? [];

  async function present(card: string) {
    setBusy(card);
    setNote("");
    try {
      await api("/api/access/simulate", { ref: card });
      setNote("Card presented at the simulated reader.");
      window.setTimeout(onChanged, 400);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (connected || s?.preview) return;
    void loadPorts();
  }, [connected, s?.preview]);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !online) return;
    if (!s?.operator.error?.includes("No operator registry")) return;
    seeded.current = true;
    void createRegistry();
  }, [online, s?.preview, s?.operator.error]);

  async function loadPorts() {
    try {
      const list =
        await api<{ port: string; description: string }[]>("/api/ports");
      setPorts(list);
      setPort((current) =>
        current && list.some((p) => p.port === current)
          ? current
          : (list[0]?.port ?? ""),
      );
      if (!list.length) setNote("No serial port found. Check the USB cable and driver.");
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  async function connectLive() {
    setBusy("live");
    setNote("");
    try {
      const st = await api<Status>("/api/device/connect", {
        port,
        baud: 115200,
        timeout: 0.25,
        reconnect: true,
      });
      setNote(
        st.connected
          ? `Connected to ${st.port}. Scan your card.`
          : st.error || "The port did not open. Check the cable and the port name.",
      );
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createRegistry() {
    setBusy("registry");
    setNote("");
    try {
      await api("/api/operators/create", {});
      setNote("config/operators.json created. Edit the names, then reload.");
      window.setTimeout(onChanged, 300);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function reloadRegistry() {
    setBusy("reload");
    setNote("");
    try {
      await api("/api/operators/reload", {});
      setNote("Operator list reloaded.");
      window.setTimeout(onChanged, 300);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function stopSimulator() {
    setBusy("live");
    setNote("");
    try {
      await api("/api/simulator", { enabled: false });
      setNote("Simulator stopped. Choose the Arduino port under Machine link.");
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function startSimulator() {
    setBusy("sim");
    setNote("");
    try {
      await api("/api/simulator", { enabled: true });
      setNote("Simulator started. Present a card below to sign in.");
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <img src="/prooflock.png" alt="" width={44} height={44} />
          <div>
            <h1>ProofLock</h1>
            <p>Machine guard control</p>
          </div>
        </div>

        <div
          className={`scan ${denied ? "denied" : connected ? "" : "offline"}`}
        >
          <div className="scan-frame">
            <LockKeyhole size={22} strokeWidth={1.6} />
          </div>
          <strong>
            {denied
              ? "Access denied"
              : connected
                ? "Sign in"
                : "Controller offline"}
          </strong>
          <span className="scan-help">
            {denied
              ? `${s?.last_unauthorised}. ${s?.operator.error ? "Create the operator list below, then scan again." : "Motor controls stay locked."}`
              : sim
                ? "Simulated reader. Present a card below to review the console."
                : connected
                  ? "Present your registered RFID card to unlock the machine controls."
                  : s?.preview
                    ? "This preview is simulator-only. A USB controller is never available here."
                    : "Connect the machine controller over USB to unlock with your RFID card."}
          </span>
        </div>

        <dl className="gate-state">
          <div>
            <dt>Reader</dt>
            <dd className={connected ? "ok" : "bad"}>
              {!online
                ? "Service unavailable"
                : sim && connected
                  ? "Simulated reader"
                  : connected
                    ? `USB · ${s?.port ?? "connected"}`
                    : "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Registered operators</dt>
            <dd className={configured ? "ok" : "warn"}>
              {configured
                ? `${s?.operator.count} registered`
                : s?.operator.error
                  ? "Registry missing"
                  : "None registered"}
            </dd>
          </div>
          <div>
            <dt>Motor controls</dt>
            <dd className="warn">
              Locked until sign-in
            </dd>
          </div>
        </dl>

        {s?.operator.error && (
          <div className="gate-fix">
            <p className="gate-note">
              <CircleAlert size={14} /> {s.operator.error}.
            </p>
            <p className="gate-note-plain">
              The service reads the operator list from that exact path. Copy{" "}
              <code>config/operators.example.json</code> to{" "}
              <code>config/operators.json</code>, edit the names, then reload.
            </p>
            <div className="gate-fix-actions">
              <button
                className="button primary"
                disabled={Boolean(busy) || !online}
                onClick={createRegistry}
              >
                <FilePlus2 size={14} />
                {busy === "registry" ? "Creating…" : "Create from example"}
              </button>
              <button
                className="button small"
                disabled={Boolean(busy) || !online}
                onClick={reloadRegistry}
              >
                <RefreshCw size={14} />
                {busy === "reload" ? "Reloading…" : "Reload list"}
              </button>
            </div>
            {sim && (
              <p className="gate-note-plain">
                In simulator runs the file is <code>config/operators.json</code>{" "}
                in the folder where the service was started.
              </p>
            )}
          </div>
        )}
        {note && <p className="gate-note">{note}</p>}

        {!connected && !s?.preview && (
          <div className="gate-connect">
            <div className="gate-connect-row">
              <select
                value={sim ? "" : port}
                onChange={(e) => setPort(e.target.value)}
                disabled={Boolean(busy)}
                aria-label="Serial port"
              >
                <option value="">
                  {ports.length ? "Select the Arduino port" : "No serial port found"}
                </option>
                {ports.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.port} — {p.description}
                  </option>
                ))}
              </select>
              <button
                className="button primary"
                disabled={!online || !port || Boolean(busy)}
                onClick={connectLive}
              >
                <Cable size={15} />
                {busy === "live" ? "Connecting…" : "Connect Arduino"}
              </button>
            </div>
            <div className="gate-connect-row">
              <button
                className="button small"
                disabled={!online || Boolean(busy)}
                onClick={loadPorts}
              >
                <RefreshCw size={14} /> Refresh ports
              </button>
            </div>
          </div>
        )}

        {sim && connected && (
          <div className="gate-sim">
            <span className="gate-sim-label">
              <ScanLine size={13} /> Simulated reader
            </span>
            <div className="gate-sim-row">
              <select value={ref} onChange={(e) => setRef(e.target.value)}>
                <option value="">Select an operator</option>
                {operators.map((o) => (
                  <option key={o.ref} value={o.ref}>
                    {o.name} · {o.ref}
                  </option>
                ))}
              </select>
              <button
                className="button"
                disabled={!ref || Boolean(busy)}
                onClick={() => present(ref)}
              >
                Present card
              </button>
            </div>
            <button
              className="button small"
              disabled={Boolean(busy)}
              onClick={() => present("OP-99")}
            >
              Present unregistered card
            </button>
            <button
              className="button small"
              disabled={Boolean(busy)}
              onClick={stopSimulator}
            >
              <Cable size={14} />
              {busy === "live" ? "Stopping…" : "Use the real Arduino"}
            </button>
          </div>
        )}
        <p className="gate-foot">
          <ShieldCheck size={13} /> Card identifiers never reach this browser.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Motor control                                                       */
/* ------------------------------------------------------------------ */

export function MotorPanel({
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
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const signedIn = Boolean(s?.access);
  const fresh = Boolean(online && s?.fresh);
  const canStart =
    signedIn && fresh && view.motor === "STOPPED" && !view.startBlocked;
  const canStop = signedIn && fresh && view.motor === "RUNNING";
  const last = s?.last_command;

  async function run(action: "MOTOR_ON" | "MOTOR_OFF") {
    setBusy(action);
    setFeedback("");
    try {
      await onCommand(action);
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={`panel motor-panel ${view.tone}`}>
      <div className="panel-head">
        <div>
          <h2>Motor control</h2>
          <p>Commands are checked against live safety feedback.</p>
        </div>
        <span className={`state-pill ${view.motor.toLowerCase()}`}>
          {view.motor}
        </span>
      </div>

      <div className="motor-stage">
        <FanRotor view={view} />
        <div className="motor-meta">
          <span className="meta-label">Last operation</span>
          <strong className="mono">
            {last
              ? `${last.action === "MOTOR_ON" ? "Start" : "Stop"} · ${clock(last.at)}`
              : "None this session"}
          </strong>
          {last?.operator?.name && (
            <span className="meta-sub">by {last.operator.name}</span>
          )}
        </div>
      </div>

      <div className="motor-actions">
        <button
          className="control start"
          disabled={!canStart || Boolean(busy)}
          onClick={() => run("MOTOR_ON")}
          title={
            !signedIn
              ? "Sign in first"
              : !fresh
                ? "Machine feedback is not current"
                : view.startBlocked || "Start the motor"
          }
        >
          <Power size={22} />
          <span>MOTOR ON</span>
        </button>
        <button
          className="control stop"
          disabled={!canStop || Boolean(busy)}
          onClick={() => run("MOTOR_OFF")}
          title={!signedIn ? "Sign in first" : "Stop the motor"}
        >
          <PowerOff size={22} />
          <span>MOTOR OFF</span>
        </button>
      </div>
      <p className="motor-hint">
        {!signedIn
          ? "Sign in with your RFID card to enable the controls."
          : !fresh
            ? "Waiting for current machine feedback."
            : canStart
              ? "Ready to start."
              : canStop
                ? "Motor running. Stop stays available."
                : view.motor === "STOPPING"
                  ? "Motor coasting to a stop. The guard stays locked."
                  : view.motor === "STOPPED" && view.startBlocked
                    ? `${view.startBlocked} — close it and the machine can start.`
                    : "Controls follow the reported machine state."}
      </p>
      {feedback && (
        <p className="motor-feedback">
          <CircleAlert size={14} /> {feedback}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Guard / safety panel                                                */
/* ------------------------------------------------------------------ */

export function GuardPanel({
  s,
  online,
  view,
}: {
  s?: Status;
  online: boolean;
  view: MachineView;
}) {
  const lockFitted = s?.lock_fitted;
  const guardFitted = s?.guard_fitted;
  const t = online && s?.fresh ? s.latest : null;
  return (
    <section className={`panel guard-panel ${view.safetyTone}`}>
      <div className="panel-head">
        <div>
          <h2>Machine safety</h2>
          <p>Guard locking and standstill verification</p>
        </div>
        <ShieldCheck size={18} className="dim" />
      </div>

      <div className={`guard-lock ${view.guard.toLowerCase()}`}>
        <div className="lock-art">
          {view.guard === "FAULT" ? (
            <ShieldX size={54} strokeWidth={1.4} />
          ) : view.guard === "UNLOCKED" ? (
            <LockKeyhole size={54} strokeWidth={1.4} className="open" />
          ) : (
            <LockKeyhole size={54} strokeWidth={1.4} />
          )}
        </div>
        <div>
          <span className="lock-label">Guard</span>
          <strong className="lock-state">
            {view.guard === "UNKNOWN"
              ? "STATUS UNKNOWN"
              : `GUARD ${view.guard}`}
          </strong>
          <span className="lock-sub">
            {view.guard === "UNLOCKED"
              ? "Release confirmed by the controller"
              : view.guard === "FAULT"
                ? "Lock feedback reports a fault"
                : view.guard === "LOCKED"
                  ? "Release is inhibited"
                  : "No lock feedback available"}
          </span>
        </div>
      </div>

      <div className={`safety-line ${view.safetyTone}`}>
        {view.safetyTone === "bad" ? (
          <AlertTriangle size={17} />
        ) : view.safetyTone === "ok" ? (
          <CheckCircle2 size={17} />
        ) : (
          <CircleDot size={17} />
        )}
        <span>{view.safety}</span>
      </div>

      <ul className="safety-steps">
        <li className={view.motor === "RUNNING" ? "on" : ""}>
          <span>Motor</span>
          <strong>{view.motor === "UNKNOWN" ? "No report" : view.motor}</strong>
        </li>
        <li className={t?.standstill === "VERIFYING" ? "on" : ""}>
          <span>Standstill check</span>
          <strong>
            {!t
              ? "No report"
              : t.standstill === "VERIFIED"
                ? "Passed"
                : t.standstill === "VERIFYING"
                  ? "In progress"
                  : t.standstill === "SENSOR_FAULT"
                    ? "Sensor fault"
                    : "Not passed"}
          </strong>
        </li>
        <li className={view.guard === "LOCKED" ? "on" : ""}>
          <span>Guard lock</span>
          <strong>{view.guard}</strong>
        </li>
      </ul>

      {(guardFitted === false || lockFitted === false) && (
        <p className="guard-warning">
          <ShieldAlert size={15} />
          {guardFitted === false && lockFitted === false
            ? "No guard switch or lock sensor is fitted. This build has no guard interlock of its own."
            : guardFitted === false
              ? "No guard switch is fitted. The guard cannot be monitored."
              : "No lock-position sensor is fitted. Lock state is inferred from standstill only."}
        </p>
      )}
      <p className="guard-foot">
        <ShieldCheck size={13} /> Standstill and guard release are decided by
        the controller, not this console.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Operator / system status                                            */
/* ------------------------------------------------------------------ */

export function StatusPanel({
  s,
  online,
  view,
}: {
  s?: Status;
  online: boolean;
  view: MachineView;
}) {
  const connected = Boolean(online && s?.connected);
  const interlockFault = view.safetyTone === "bad";
  const system = !online
    ? { text: "OFFLINE", tone: "bad" }
    : interlockFault
      ? { text: "FAULT", tone: "bad" }
      : s?.guard_fitted === false || s?.lock_fitted === false
        ? { text: "WARNING", tone: "warn" }
        : connected
          ? { text: "NORMAL", tone: "ok" }
          : { text: "DISCONNECTED", tone: "warn" };
  return (
    <section className="panel status-panel">
      <div className="panel-head">
        <div>
          <h2>Operator &amp; system</h2>
          <p>Session and equipment health</p>
        </div>
      </div>
      <div className="operator-card">
        <span className="operator-icon">
          <UserRound size={20} />
        </span>
        <div>
          <strong>{s?.access?.operator.name ?? "No engineer signed in"}</strong>
          <span>{s?.access?.operator.ref ?? "Sign in to enable controls"}</span>
        </div>
        {s?.access && <BadgeCheck size={18} className="ok" />}
      </div>
      <dl className="status-rows">
        <div>
          <dt>
            <Fingerprint size={14} /> RFID reader
          </dt>
          <dd className={connected ? "ok" : "bad"}>
            {connected ? "Connected" : "Disconnected"}
          </dd>
        </div>
        <div>
          <dt>
            <ShieldCheck size={14} /> Safety interlock
          </dt>
          <dd
            className={
              interlockFault ? "bad" : s?.guard_fitted === false ? "warn" : "ok"
            }
          >
            {interlockFault
              ? "Fault"
              : s?.guard_fitted === false
                ? "Not fitted"
                : "Ready"}
          </dd>
        </div>
        <div>
          <dt>
            <Radio size={14} /> System status
          </dt>
          <dd className={system.tone}>
            {system.text}
          </dd>
        </div>
        <div>
          <dt>
            <Fingerprint size={14} /> Session
          </dt>
          <dd className="idle">
            {s?.access
              ? `Expires in ${Math.max(1, Math.round(s.access.remaining / 60))} min`
              : "Locked"}
          </dd>
        </div>
      </dl>
      {s?.error && (
        <p className="status-error">
          <CircleAlert size={14} /> {s.error}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export function Attendance({
  s,
  onChanged,
}: {
  s?: Status;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [more, setMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const source = s?.source ?? "live";

  const since = useMemo(() => {
    if (!day) return 0;
    return new Date(`${day}T00:00:00`).getTime() / 1000;
  }, [day]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const params = new URLSearchParams({
      source,
      since: String(since),
      search,
      offset: String(offset),
      limit: "25",
    });
    fetch(`/api/attendance?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Attendance history unavailable");
        return r.json();
      })
      .then((data) => {
        if (!live) return;
        setRows(data.rows);
        setMore(data.more);
        setError("");
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [source, since, search, offset, s?.revision, day]);

  return (
    <section className="panel attendance-panel">
      <div className="panel-head">
        <div>
          <h2>Attendance</h2>
          <p>Successful RFID sign-ins, newest first</p>
        </div>
        <div className="attendance-tools">
          <label className="search">
            <Search size={14} />
            <input
              placeholder="Engineer or ID"
              value={search}
              maxLength={60}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label className="date">
            <CalendarDays size={14} />
            <input
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <button
            className="icon-button"
            onClick={onChanged}
            aria-label="Refresh attendance"
          >
            <RefreshCw size={15} />
          </button>
          <a
            className="button small"
            href={`/api/attendance/export?${new URLSearchParams({ source, since: String(since), search })}`}
          >
            Export
          </a>
        </div>
      </div>

      {error ? (
        <p className="attendance-empty">
          <CircleAlert size={16} /> {error}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Engineer</th>
                <th>ID number</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    <span className="cell-time">{clock(r.at)}</span>
                    <span className="cell-date">
                      {dateTime(r.at).split(",")[0]}
                    </span>
                  </td>
                  <td>{r.operator_name || "Unregistered card"}</td>
                  <td className="mono">{r.operator_ref || "—"}</td>
                  <td>
                    <span
                      className={`pill ${r.result === "ACCEPTED" ? "ok" : "bad"}`}
                    >
                      {r.result === "ACCEPTED" ? "Granted" : "Denied"}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="attendance-empty">
                    {loading
                      ? "Loading attendance…"
                      : "No sign-ins match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>
          {rows.length
            ? `Showing ${offset + 1}–${offset + rows.length}`
            : "No records shown"}
        </span>
        <button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 25))}
        >
          Previous
        </button>
        <button disabled={!more} onClick={() => setOffset((v) => v + 25)}>
          Next
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function ConsoleHeader({
  s,
  online,
  now,
  onLock,
  theme,
  onThemeChange,
}: {
  s?: Status;
  online: boolean;
  now: Date;
  onLock: () => void;
  theme: "light" | "dark";
  onThemeChange: (t: "light" | "dark") => void;
}) {
  const name = s?.access?.operator.name;
  return (
    <header className="console-header">
      <a className="console-brand" href="#console">
        <img src="/prooflock.png" alt="" width={34} height={34} />
        <span>
          <b>ProofLock</b>
          <small>MACHINE GUARD CONTROL</small>
        </span>
      </a>
      <div className="console-status">
        <span className={`chip ${online ? "ok" : "bad"}`}>
          {online
            ? s?.source === "simulator"
              ? "SIMULATOR"
              : "ONLINE"
            : "OFFLINE"}
        </span>
        <span className="console-clock">
          <strong>{now.toLocaleTimeString("en-GB")}</strong>
          <small>
            {now.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </small>
        </span>
      </div>
      <div className="console-user">
        <span className={`avatar ${name ? "on" : ""}`}>
          <UserRound size={16} />
        </span>
        <span>
          <b>{name ?? "Operator"}</b>
          <small>{s?.access?.operator.ref ?? "Signed out"}</small>
        </span>
        <LiquidGlassThemeToggle theme={theme} onThemeChange={onThemeChange} />
        <button className="button small" onClick={onLock} disabled={!s?.access}>
          <LogOut size={14} /> {s?.access ? "Lock" : "Locked"}
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Settings drawer (serial link, kept off the operator screen)         */
/* ------------------------------------------------------------------ */

export function LinkSettings({
  s,
  open,
  close,
}: {
  s?: Status;
  open: boolean;
  close: () => void;
}) {
  const [config, setConfig] = useState({
    port: "",
    baud: 115200,
    timeout: 0.25,
    reconnect: true,
  });
  const [ports, setPorts] = useState<{ port: string; description: string }[]>(
    [],
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const list =
        await api<{ port: string; description: string }[]>("/api/ports");
      setPorts(list);
      setConfig((c) => ({
        ...c,
        port:
          c.port && list.some((p) => p.port === c.port)
            ? c.port
            : (list[0]?.port ?? ""),
      }));
      setNote(
        list.length
          ? ""
          : "No serial port found. Check the USB cable and driver.",
      );
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside
        className="drawer"
        role="dialog"
        aria-label="Machine link settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <div>
            <h2>Machine link</h2>
            <p>Serial connection to the controller</p>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <label>
          Port
          <select
            value={config.port}
            onChange={(e) => setConfig({ ...config, port: e.target.value })}
          >
            <option value="">Select a port</option>
            {ports.map((p) => (
              <option key={p.port} value={p.port}>
                {p.port} — {p.description}
              </option>
            ))}
          </select>
        </label>
        <div className="drawer-row">
          <label>
            Baud rate
            <input
              type="number"
              min={300}
              max={1000000}
              value={config.baud}
              onChange={(e) =>
                setConfig({ ...config, baud: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Read timeout (s)
            <input
              type="number"
              step={0.05}
              min={0.05}
              max={1}
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
            checked={config.reconnect}
            onChange={(e) =>
              setConfig({ ...config, reconnect: e.target.checked })
            }
          />
          Reconnect after link loss
        </label>
        <p className="drawer-note">
          {s?.connected
            ? `Connected to ${s.port} at ${s.baud} baud. Disconnect before changing settings.`
            : "Opening a port can reset some boards. Close other serial monitors first."}
        </p>
        {!s?.connected && s?.error && (
          <p className="drawer-note warn">
            <CircleAlert size={14} /> {s.error}
          </p>
        )}
        {note && <p className="drawer-note">{note}</p>}
        <div className="drawer-actions">
          <button className="button small" onClick={load} disabled={busy}>
            <RefreshCw size={14} /> Refresh ports
          </button>
          <button
            className="button primary"
            disabled={!config.port || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const st = await api<Status>("/api/device/connect", config);
                setNote(
                  st.connected
                    ? `Connected to ${st.port} at ${st.baud} baud. Scan your card.`
                    : (st.error || "The port did not open. Check the cable and the port name."),
                );
              } catch (e) {
                setNote((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Connect
          </button>
          <button
            className="button"
            disabled={!s?.connected}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/device/disconnect", {});
                setNote("Disconnected.");
              } catch (e) {
                setNote((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </button>
        </div>
        <div className="drawer-actions">
          <button
            className="button"
            onClick={async () => {
              await api("/api/simulator", {
                enabled: s?.source !== "simulator",
              });
            }}
          >
            <ScanLine size={14} />{" "}
            {s?.source === "simulator" ? "Stop simulator" : "Start simulator"}
          </button>
          <button
            className="button"
            onClick={async () => {
              await api("/api/operators/reload", {});
              setNote("Operator registry reloaded.");
            }}
          >
            Reload operators
          </button>
        </div>
      </aside>
    </div>
  );
}
