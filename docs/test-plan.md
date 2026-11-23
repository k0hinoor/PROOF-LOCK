# ProofLock verification checklist

## Software checks

- `npm --prefix frontend run build` — type-check and production bundle.
- `python -m unittest discover -s backend/tests -v` — run with the environment that contains the backend requirements.
- `python -m unittest discover -s firmware/tests -v` — keeps the sketch, the documented frames and the dashboard's command frames aligned.
- Start the app with an unused database path. The **access gate** must appear, show `Machine controller offline` and offer no motor controls.
- Click **Start simulator**, present a registered card, and confirm the console opens with that engineer's name and reference.
- Present an unregistered card (`OP-99`): the gate must answer `ACCESS DENIED`, name the reason, and keep the motor controls unreachable.
- Motor cycle: **MOTOR ON** → `RUNNING`, `GUARD LOCKED`, fan spinning. **MOTOR OFF** → `STOPPING`, "waiting for the motor to stop", guard still locked, fan slowing. Then `STOPPED`, `SAFE TO OPEN`, lock released, fan stopped.
- While the guard is released, **MOTOR ON** must be disabled and the hint must explain why. Wait for the guard to re-latch, then start again.
- Attendance: each accepted scan adds exactly one row with a real timestamp, newest first; search and the date filter work; no row appears for a denied card; motor commands never create attendance rows.
- **Lock** returns to the gate and the console stops sending run permits. Reload while signed in: the session survives (server-side).
- Stop the service while the page is open: the console reports the service unavailable and marks readings unknown rather than stale-but-current.
- Narrow viewport and keyboard navigation: no horizontal overflow at 390 px, focus visible on the gate and both motor buttons.

## Preview mode

`PROOFLOCK_PREVIEW=1` starts the simulator automatically and refuses every write except a simulated card scan or a motor command against the simulator: no serial connect, no simulator toggle, no data pruning. Verify `POST /api/device/connect`, `/api/simulator` and `/api/data/prune` return 403, and that `/api/ports` is empty.

## Physical Arduino acceptance — not run in Arena

Use a **low-energy bench setup**, not operational machinery. This checklist tests display/integration; it does not validate a safety circuit.

| Test | Pass condition |
| --- | --- |
| Port discovery and serial connection | Correct COM port can be selected; valid v1 telemetry increments the packet counter. |
| Firmware contract | Record approved baud, real sample packets, update rate and firmware version; confirm how lock feedback, standstill and ADC fields are generated. |
| Card enrolment | A card in the sketch's table reports `ACCEPTED` with its `OP-nn` reference; any other card reports `DENIED`. The UID never appears on screen, in SQLite or in exports. |
| Access gating | Console stays locked until an accepted scan; `Lock` returns to the gate; an expired session locks itself. |
| Start | `MOTOR ON` energises the relay only while the guard is closed and the lock is locked. |
| Run permit | Close the browser while the motor runs: the board must cut the relay within about 2.5 s and log `LINK_LOST_STOP`. |
| Stop and verify | Report `STOPPING`, then `VERIFYING`, then explicit `VERIFIED`. A zero ADC without explicit verification must not display `VERIFIED`. |
| Guard release | The solenoid only energises after the settle window; turning the shaft during the release window aborts it (`RELEASE_ABORTED`). |
| Guard feedback | Report A/B disagreement and individual fault values; confirm the warning. If no interlock is fitted, the console must keep saying so. |
| Data freshness | Pause telemetry while sending heartbeats. Machine values become stale after three seconds; the link still reports packet activity. |
| Unplug/replug | While live, unplug USB and confirm old values are not shown as current. Replug and confirm the session resumes only on fresh telemetry. |
| Protocol recovery | Insert malformed, oversized or unknown-enum test frames using a benign bench feed. Confirm warnings and continued reading of the next valid frame. |

Keep physical safeguard validation and risk assessment separate from these dashboard checks. Do not rely on the console to interpret safe access.

## Serial stress regression

The POSIX test sends a fragmented CRLF frame, then a burst of 1,000 valid frames interleaved with 80 oversized or invalid UTF-8 frames, and verifies the valid sample count in SQLite and that a heartbeat cannot keep machine readings current. A separate test drives the real pySerial writer and checks the bytes that reach the wire: one `MOTOR_ON`, a permit refresh that writes frames but no history, and one `MOTOR_OFF`. These are virtual-port tests, not measurements of wire throughput or firmware latency.

For bench sign-off, use the actual board, cable, drivers, target computer and firmware. Capture the approved baud and a few real v1 frames, repeat unplug/replug several times, and compare dashboard states against independently observed bench states. Neither the simulator nor the virtual-port test can validate the physical interlock or certify the prototype.
