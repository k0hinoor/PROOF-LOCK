# ProofLock serial protocol v1

**Proposed dashboard integration contract.** Confirm it with the firmware owner before connecting the bench prototype. No pin assignments, thresholds, calibrated voltages, or safety decisions are defined here.

Use compact UTF-8 JSON objects, one per line (`LF`, or `CRLF`), with a maximum frame of 512 bytes before the newline. Use 8 data bits, no parity, 1 stop bit and no flow control. Set the same baud in firmware and Settings. Aim for telemetry at least once per second; machine state becomes stale after three seconds without a valid telemetry frame. The dashboard sends no serial commands or request/response handshake.

Every frame contains `v: 1`, `type`, and `seq` (an unsigned 32-bit integer that increments across **all** message types; wraps to zero). Use separate frames for telemetry, heartbeat, RFID and events. This is an example stream, not a real bench capture:

```jsonl
{"v":1,"type":"telemetry","seq":42,"device":"prooflock-uno","firmware":"0.1.0","motor":"STOPPING","guard_a":"CLOSED","guard_b":"CLOSED","lock":"LOCKED","standstill":"VERIFYING","back_emf_adc":318}
{"v":1,"type":"rfid","seq":43,"result":"ACCEPTED","operator_ref":"OP-02"}
{"v":1,"type":"event","seq":44,"code":"STANDSTILL_VERIFIED","severity":"INFO"}
{"v":1,"type":"telemetry","seq":45,"motor":"STOPPED","guard_a":"CLOSED","guard_b":"CLOSED","lock":"LOCKED","standstill":"VERIFIED","back_emf_adc":0}
{"v":1,"type":"heartbeat","seq":46,"uptime_ms":91760}
```

| Type | Fields | Rules |
| --- | --- | --- |
| `telemetry` | `motor`, `guard_a`, `guard_b`, `standstill` | Required enum values below. Neither transport connectivity nor ADC is proof of stop. |
| `telemetry` | `lock`, `back_emf_adc` | Lock is optional; default `UNKNOWN`. Report sensed feedback only. ADC is optional or null, otherwise integer 0–1023. |
| `rfid` | `result`, `operator_ref` | Result: `ACCEPTED`, `DENIED`, `UNKNOWN`, `NOT_CONFIGURED`. Optional reference must match `OP-` plus 1–6 digits; otherwise shown as unknown. Do not transmit card UIDs. |
| `event`, `diagnostic` | `code`, `severity` | Codes use uppercase letters, underscores and digits (max 48, initial letter). Severity: `INFO`, `NOTICE`, `WARNING`, `ERROR`. Timing warning codes `POSSIBLE_BYPASS_PATTERN` / `UNUSUAL_EVENT_TIMING` are presented as unusual timing, not an accusation. |
| `heartbeat` | common fields only | Updates link diagnostics, not telemetry freshness. |
| any | `device`, `firmware`, `uptime_ms` | Optional. First two are 1–40 letters/digits/`_`/`.`/`-`, uptime is unsigned 32-bit milliseconds. |

- Motor: `RUNNING`, `STOPPING`, `STOPPED`, `FAULT`, `UNKNOWN`.
- Both guard channels: `OPEN`, `CLOSED`, `FAULT`, `UNKNOWN`. Disagreement is flagged when one reports open and the other closed.
- Lock feedback: `LOCKED`, `RELEASED`, `FAULT`, `UNKNOWN`.
- Standstill: `NOT_VERIFIED`, `VERIFYING`, `VERIFIED`, `SENSOR_FAULT`, `UNKNOWN`. A standstill **event** is history; only a fresh standstill **telemetry field** changes the current badge.

Malformed and unsupported-version frames are discarded. Unsupported state enums appear as `UNKNOWN` with a protocol warning. Repeated sequence numbers are ignored; forward gaps are counted; a backwards jump invalidates the previous telemetry context until a new telemetry frame arrives. Chart gaps do not become zero samples. Only sanitized fields are stored.
