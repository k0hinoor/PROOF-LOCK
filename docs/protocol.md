# ProofLock serial protocol v1

**Dashboard integration contract.** The repository ships a reference bench sketch in [`firmware/prooflock_uno`](../firmware/README.md) that speaks exactly this protocol at `115200` baud; confirm the contract before connecting different firmware. No pin assignments, thresholds, calibrated voltages or safety decisions are defined here.

Use compact UTF-8 JSON objects, one per line (`LF`, or `CRLF`), with a maximum frame of 512 bytes before the newline. Use 8 data bits, no parity, 1 stop bit and no flow control. Set the same baud in firmware and Settings. Aim for telemetry at least once per second; machine state becomes stale after three seconds without a valid telemetry frame.

The board is the **only** thing that decides safety states. The dashboard reads those states and may send exactly two commands, described under [Command frames](#command-frames-dashboard--board).

Every frame contains `v: 1`, `type`, and `seq` (an unsigned 32-bit integer that increments across **all** message types; wraps to zero). Use separate frames for telemetry, heartbeat, RFID and events. This is an example stream, not a real bench capture:

```jsonl
{"v":1,"type":"telemetry","seq":42,"device":"prooflock-uno","firmware":"bench-2.0","motor":"STOPPING","guard_a":"CLOSED","guard_b":"CLOSED","lock":"LOCKED","standstill":"VERIFYING","back_emf_adc":318,"guard_fitted":false,"lock_fitted":false}
{"v":1,"type":"rfid","seq":43,"result":"ACCEPTED","operator_ref":"OP-02"}
{"v":1,"type":"event","seq":44,"code":"STANDSTILL_VERIFIED","severity":"INFO"}
{"v":1,"type":"telemetry","seq":45,"device":"prooflock-uno","firmware":"bench-2.0","motor":"STOPPED","guard_a":"CLOSED","guard_b":"CLOSED","lock":"LOCKED","standstill":"VERIFIED","back_emf_adc":0,"guard_fitted":false,"lock_fitted":false}
{"v":1,"type":"heartbeat","seq":46,"uptime_ms":91760}
```

## Board → dashboard

| Type | Fields | Rules |
| --- | --- | --- |
| `telemetry` | `motor`, `guard_a`, `guard_b`, `standstill` | Required enum values below. Neither transport connectivity nor a low ADC reading is proof of stop. |
| `telemetry` | `lock`, `back_emf_adc` | Lock is optional; default `UNKNOWN`. Report sensed feedback only. ADC is optional or null, otherwise integer 0–1023. |
| `telemetry` | `guard_fitted`, `lock_fitted` | Optional booleans. `false` means the build has no such sensor and its values are placeholder `CLOSED`/`UNKNOWN`; the console then shows a standing "no guard interlock fitted" warning. |
| `rfid` | `result`, `operator_ref` | Result: `ACCEPTED`, `DENIED`, `UNKNOWN`, `NOT_CONFIGURED`. Optional reference must match `OP-` plus 1–6 digits; otherwise it is shown as unrecognised. Do not transmit card UIDs. |
| `event`, `diagnostic` | `code`, `severity` | Codes use uppercase letters, underscores and digits (max 48, initial letter). Severity: `INFO`, `NOTICE`, `WARNING`, `ERROR`. Timing codes `POSSIBLE_BYPASS_PATTERN` / `UNUSUAL_EVENT_TIMING` are presented as unusual timing, not an accusation. |
| `heartbeat` | common fields only | Updates link diagnostics, not telemetry freshness. |
| any | `device`, `firmware`, `uptime_ms` | Optional. First two are 1–40 letters/digits/`_`/`.`/`-`, uptime is unsigned 32-bit milliseconds. |

- Motor: `RUNNING`, `STOPPING`, `STOPPED`, `FAULT`, `UNKNOWN`.
- Both guard channels: `OPEN`, `CLOSED`, `FAULT`, `UNKNOWN`. Disagreement is flagged when one reports open and the other closed.
- Lock feedback: `LOCKED`, `RELEASED`, `FAULT`, `UNKNOWN`.
- Standstill: `NOT_VERIFIED`, `VERIFYING`, `VERIFIED`, `SENSOR_FAULT`, `UNKNOWN`. A standstill **event** is history; only a fresh standstill **telemetry field** changes the current badge.

Malformed and unsupported-version frames are discarded. Unsupported state enums appear as `UNKNOWN` with a protocol warning. Repeated sequence numbers are ignored; forward gaps are counted; a backwards jump invalidates the previous telemetry context until a new telemetry frame arrives. Chart gaps do not become zero samples. Only sanitized fields are stored.

## Command frames (dashboard → board)

The dashboard may send these two frames and nothing else. `backend/protocol.py` builds them from a two-item allow-list, so no other action can reach the port.

```jsonl
{"v":1,"type":"command","seq":1,"action":"MOTOR_ON"}
{"v":1,"type":"command","seq":2,"action":"MOTOR_OFF"}
```

| Action | Meaning | Board behaviour |
| --- | --- | --- |
| `MOTOR_ON` | Start, then keep running | Starts from idle only, and acts as a **run permit**: the frame must keep arriving at least every 2.5 s or the board stops the motor (`LINK_LOST_STOP`). |
| `MOTOR_OFF` | Stop now | Cancels the permit, cuts the relay and runs the stop sequence. |

Rules:

- Commands are only sent while an RFID session is open, the cockpit is showing that session, and the last telemetry frame is fresh. The server re-checks every gate on each request; the browser is never trusted.
- Safety gates live on the board, not in the dashboard. `MOTOR_ON` cannot start a motor whose guard is open or released, and no command can release the lock, clear a fault or change a threshold.
- If the permit stops arriving — page closed, laptop asleep, cable pulled — the motor stops. That is the intended failure direction.
- The board ignores malformed lines, unknown actions and oversized frames. It never answers a command with a reply; state changes are observed through telemetry.

## Operator references

`operator_ref` values are short local identifiers (`OP-01` … `OP-999999`). The dashboard compares them against `config/operators.json` (or `PROOFLOCK_OPERATORS`). An `ACCEPTED` result for a reference that is not registered is logged as **ACCESS DENIED · card not registered**, so a stale firmware table cannot open a session by itself. Successful authentications are written to the attendance table with the operator name, reference and a real timestamp.
