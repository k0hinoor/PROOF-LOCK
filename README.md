# ProofLock

**A local monitoring console for the ProofLock stop-verified guard prototype.**

Read Arduino Uno telemetry over USB, inspect machine-state transitions, and export a timestamped record of what the controller reported. The dashboard runs on the connected laptop without an account, internet connection, or cloud service.

[Quick start](#quick-start) · [Connect an Arduino](#connect-an-arduino) · [Serial contract](docs/protocol.md) · [Bench checklist](docs/test-plan.md) · [Project specification](ProofLock_Dashboard_PRD_and_Tech_Stack.pdf)

![ProofLock Machine overview in explicitly labelled simulator mode, with a back-EMF chart, standstill timeline, guard channels and recent events](docs/assets/overview.png)

> [!IMPORTANT]
> **Monitoring only.** ProofLock is a student prototype, not a certified machine-safety system. The dashboard cannot start or stop the machine, release the guard, override an interlock, or change a threshold. The physical protective system must operate independently of the Arduino telemetry and laptop. Test only on an appropriate low-energy bench setup; do not use this prototype as the sole safeguard on machinery that can cause injury.

## What you can do

| Screen | Purpose |
| --- | --- |
| **Overview** | See motor, guard, lock feedback, explicit standstill verification, a selectable raw ADC trend, and recent events. |
| **Events** | Filter by time, category, severity, source, and search text. Inspect the packet sequence and telemetry snapshot, or export filtered records. |
| **Operators** | Review device-reported RFID outcomes using short local references. Raw UIDs are not retained. |
| **Diagnostics** | Inspect link and telemetry ages, device metadata, packet gaps, malformed frames, guard inputs, and raw ADC. Copy diagnostics or export the selected sampling window. |
| **Settings** | Select serial port, baud, timeout, and reconnection preference; switch simulator or display modes and explicitly clean up older records. |

## Quick start

**Prerequisites:** Python 3.11+ and Node.js 22 with npm. Internet access is needed to install dependencies; not to operate the built dashboard.

From the repository root, build the frontend:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
```

Then choose the commands for your OS. Activation is not required.

**Windows PowerShell**

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

**macOS / Linux**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **<http://127.0.0.1:8000>**. Live mode starts disconnected with unknown readings. To take a no-hardware tour, open **Settings → Simulator → Start simulator**, then return to **Overview**. The demo runs a deterministic stop-verification sequence and emits example RFID records. It is always labelled **SIMULATOR**, including in exports. The Arena preview is simulator-only and does not connect to a USB device on your computer.

## Connect an Arduino

The bench firmware, pin table, card enrolment steps, standstill calibration and upload troubleshooting are in [`firmware/README.md`](firmware/README.md).

1. Use a USB **data** cable. Run the service on the computer that the board is physically plugged into.
2. Upload the bench firmware in [`firmware/prooflock_uno`](firmware/README.md), or confirm your own sketch emits the [documented v1 telemetry](docs/protocol.md). The included sketch is a **demonstration**, not production firmware: it has no guard switches, no lock-position sensor and no validated safety circuit, and it refuses to release the solenoid until you calibrate the standstill threshold. `115200` is the default baud in both the sketch and Settings.
3. Close Arduino Serial Monitor or any other app using the port. In **Settings → USB serial**, refresh ports, select the Uno’s port, match its baud rate, then click **Connect USB**.
4. Check **Diagnostics** for valid packets. An open port alone does not make data current. An event or heartbeat cannot refresh the machine snapshot; a valid telemetry packet must arrive within three seconds.
5. If the port reappears with the same OS name after unplugging, auto-reconnect will retry it. If the OS assigns a different port, refresh the list and select it explicitly.

| Symptom | What to check |
| --- | --- |
| No port appears | Try a known data cable or another USB port. On Windows, check Device Manager and the board’s USB adapter driver. On Linux, verify your login has permission to open the serial device. |
| Port busy or repeatedly reconnecting | Close other serial tools. Check the cable, port permissions, and whether the OS renamed the port. Some Uno boards reset when the serial port opens. |
| Open port, no current values | Confirm baud and newline framing; check malformed packets and the latest warning. Wait for boot to finish. Use telemetry, not just heartbeat packets. |
| `UNKNOWN` lock or voltage unavailable | Send validated physical lock feedback or leave lock unknown. The dashboard reports raw counts only; there is no confirmed voltage calibration. |
| Page unavailable | Run the service from the repo root and build `frontend/dist` before starting it. If port 8000 is occupied, choose another loopback port. |

## How it works

```text
Arduino telemetry ──USB RX──▶ pySerial reader ──▶ v1 validation ──▶ session state
                                                       ├──▶ SQLite events / samples
                                                       └──▶ FastAPI WebSocket / REST ──▶ React console

Physical guard interlock: independent, with no dashboard command path.
```

- **Transport:** WebSocket streaming is preferred. The console temporarily polls the same status endpoint when a browser or preview proxy blocks the socket.
- **Freshness:** Missing or stale live data never becomes zero or `STOPPED`. A low ADC reading never becomes `VERIFIED`; only an explicit report can supply that state. Guard disagreement is reported separately.
- **Audit:** CSV timestamps are UTC; the UI renders local receive time. Event records distinguish device reports from dashboard observations. Unusual timing is a device-reported warning, not proof of bypass.
- **Storage:** SQLite WAL data lives in `data/prooflock.sqlite3` by default and is ignored by Git. Set `PROOFLOCK_DB` to use a different local file. Export first if you need an archive before retention cleanup. Display and serial preferences live in your browser.
- **Privacy:** The service accepts short `OP-` references, not raw tag UIDs. It does not retain raw serial frames or send records to the cloud.
- **Deployment:** Use one server worker on loopback. Do not expose the hardware-connected service publicly. The separate preview mode disables serial and mutations and must use a dedicated simulator database.

## Develop and verify

```sh
# Backend checks (use .venv\Scripts\python.exe on Windows)
.venv/bin/python -m unittest discover -s backend/tests -v

# Frontend type-check and production build
npm --prefix frontend run build

# Optional Vite development server (with backend on 127.0.0.1:8000)
npm --prefix frontend run dev
```

The backend suite covers malformed and partial frames, unknown enums, operator redaction, explicit verification, stale/disconnected data, guard disagreement, persistence, and source isolation. The POSIX integration test exercises the real pySerial reader against a virtual serial port, including disconnect and reconnect. On Windows that test is skipped. For physical sign-off, follow the [bench checklist](docs/test-plan.md); browser and virtual-port checks are not proof of electrical or firmware integration.
