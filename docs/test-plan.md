# ProofLock verification checklist

## Software checks

- `npm --prefix frontend run build` — type-check and production bundle.
- `python -m unittest discover -s backend/tests -v` — run using the environment that contains the backend requirements.
- Launch the app with an unused database path and confirm the app starts disconnected. Enable the simulator, wait for plotted samples, then inspect the chart range controls, timeline and all five routes.
- Search for `OP-02` in Operators, open an event drawer, export the filtered records and check their simulator source and UTC timestamps. Disable the simulator and verify the live history contains no simulated events.
- Stop the service while the web page is open. Within the stream timeout, verify the page reports the service unavailable, marks readings unknown and retains prior samples only as stale context. Restart and check previously saved events remain available.
- Try a narrow viewport and keyboard navigation, including Escape to close the event drawer. Disconnect Internet access after installation and confirm the simulator and history still work.

## Physical Arduino acceptance — not run in Arena

Use a **low-energy bench setup**, not operational machinery. This checklist tests display/integration only; it does not validate a safety circuit.

| Test | Pass condition |
| --- | --- |
| Port discovery and serial connection | Correct COM port can be selected; valid v1 telemetry increments the packet counter. |
| Firmware contract | Record approved baud, real sample packets, update rate and firmware version; confirm how lock feedback, standstill and ADC fields are generated. |
| Standstill sequence | Report `STOPPING`, then `VERIFYING`, then explicit `VERIFIED`. Check the order. A zero ADC without explicit verification must not display `VERIFIED`. |
| Guard feedback | Report A/B disagreement and individual fault values; confirm warning and channel labels. If lock position is not sensed, confirm it stays `UNKNOWN`. |
| Data freshness | Pause telemetry while sending heartbeats. Machine values become stale after three seconds; the link still reports packet activity. |
| Unplug/replug | While live, unplug USB and confirm old values are not shown as current. Replug and confirm the session resumes only on fresh telemetry. |
| Protocol recovery | Insert malformed, oversized or unknown-enum test frames using a benign bench feed. Confirm warnings and continued reading of the next valid frame. |
| RFID and export | Test accepted and denied references without UIDs; confirm privacy in the interface, database records and CSV. |

Keep physical safeguard validation and risk assessment separate from these dashboard checks. Do not rely on the console to interpret safe access.
