# ProofLock Arduino Uno firmware (demonstration build)

Bench firmware for the wiring layout in the project schematic. It reads the
MFRC522 reader, the relay and solenoid outputs, the LM393 comparator and the
100 k / 10 k back-EMF divider, then streams **newline-delimited JSON v1**
telemetry to the dashboard over USB.

> **Not a safety device.** This is a student demonstration. It is not
> certified, it has no redundancy, and the guard inputs are not fitted on the
> current build. Never use it as the only safeguard on machinery that can
> injure someone.

| Item | Value |
| --- | --- |
| Board | Arduino Uno R3 (ATmega328P) |
| Serial | `115200` baud, 8N1, one JSON object per line |
| Libraries | `MFRC522` by GithubCommunity (Library Manager), `SPI` (bundled) |
| Telemetry rate | 2 Hz |
| Reader | MFRC522 on SPI: SS `D10`, RST `D9`, SCK `D13`, MOSI `D11`, MISO `D12` |
| Outputs | Relay IN `D7`, solenoid gate `D8` (IRLB8314 through 220 Ω) |
| Inputs | Comparator DO `D6`, divider midpoint `A0` |
| Guard switches | `D2` / `D3` — **not fitted**, reported `UNKNOWN` until configured |

## Test each component first

`firmware/component_test/component_test.ino` checks one part at a time from the
Serial Monitor, before you run the full firmware. Upload it, open Serial Monitor
at **115200**, and press a key:

| Key | Test | What to watch |
| --- | --- | --- |
| `1` | USB serial and board | The text appears, and `F_CPU` reads 16000000 Hz |
| `2` | MFRC522 reader | `VersionReg` is not `0x00`/`0xFF`, then tap a card and note the UID |
| `3` | Relay D7 / motor | One click on, one click off after 2 s; the motor runs only with 12 V connected |
| `4` | Solenoid D8 | A 0.5 s pulse; listen for the solenoid |
| `5` | Comparator D6 | The D6 level changes when you turn the shaft by hand |
| `6` | Back-EMF A0 | Resting noise floor and the reading with 12 V applied |
| `7` | Guard inputs D2/D3 | The level changes when you short the pin to GND |
| `s` | Stop outputs | Relay and solenoid are forced off immediately |
| `r` | Summary | The pass/fail line for every test so far |

**No stop switch is needed.** The sketch never holds an output on: the relay is
a 2 s pulse and the solenoid a 0.5 s pulse, and any key, the board's **RESET**
button, closing Serial Monitor, or uploading a different sketch switches both
off. Keep one hand on the 12 V supply the first time you use `3` or `4` anyway.

The sketch prints **plain text**, not protocol JSON. Disconnect ProofLock first,
or its Diagnostics page will count these lines as rejected frames. When you
finish, upload `prooflock_uno.ino` again and reconnect the dashboard at
`115200` baud.

## Upload

1. Install the **MFRC522** library: Arduino IDE → *Tools → Manage Libraries* →
   search `MFRC522` → install the GithubCommunity version.
2. Open `firmware/prooflock_uno/prooflock_uno.ino`.
3. Select **Tools → Board → Arduino AVR Boards → Arduino Uno** and the Uno's
   COM port. A CH340 cable shows up as `USB-SERIAL CH340`, which is the USB
   adapter, not the board model.
4. Disconnect ProofLock and close Serial Monitor before uploading.
5. Click **Upload**. "Done uploading" means the sketch is on the board; the
   IDE does not display live readings.

If the upload fails with `access is denied`, another program still holds the
port. If it fails with `not in sync`, see [Upload troubleshooting](#upload-troubleshooting).

## First run, without the motor connected

Keep the 12 V supply **off** and the motor disconnected for these steps.

1. Open Serial Monitor at **115200** baud. You should see one telemetry line
   every half second, for example:

   ```json
   {"v":1,"type":"telemetry","seq":7,"device":"prooflock-uno","firmware":"bench-2.0","uptime_ms":3500,"motor":"UNKNOWN","guard_a":"UNKNOWN","guard_b":"UNKNOWN","lock":"UNKNOWN","standstill":"UNKNOWN","back_emf_adc":3}
   ```

   `UNKNOWN` is the correct value for every channel that has no sensor.
2. Close Serial Monitor and start ProofLock, then **Settings → USB serial** →
   COM port → **115200** → **Connect USB**.
3. **Diagnostics** should show increasing *Valid packets* and the age of the
   last telemetry under one second.

If the reader is missing or wired wrong, the board sends
`result: NOT_CONFIGURED` once at boot and then keeps the rest of the sketch
running. That is reported in **Operators**, not hidden.

## Enrol your cards

Card UIDs never leave the board, so authorised cards are stored in the sketch.

1. Set `ENROLL_MODE` to `true` and upload again.
2. Open Serial Monitor at 115200 and tap each card. The board prints:

   ```text
   # card UID: {0xDE, 0xAD, 0xBE, 0xEF}
   ```

3. Copy the values into the table, one row per card, using a reference in the
   form `OP-01`:

   ```cpp
   const LocalTag AUTHORIZED_TAGS[] = {
     {4, {0xDE, 0xAD, 0xBE, 0xEF}, "OP-01"},
     {7, {0x04, 0xA1, 0x22, 0x33, 0x44, 0x55, 0x66}, "OP-02"},
     {0, {0}, nullptr},   // keep this terminator row last
   };
   ```

4. Set `ENROLL_MODE` back to `false`, upload, and test again. Leave it `false`
   during normal use: the enrolment lines are plain text, not JSON, so the
   dashboard would count them as rejected frames. An authorised
   card produces `RFID_ACCEPTED` in **Operators**; any other card produces
   `RFID_DENIED`. The dashboard never sees the UID.

> **3.3 V reader warning.** The MFRC522 is a 3.3 V part. Power it from the
> Uno's **3.3 V** pin only, never from 5 V. The layout calls for a 4-channel
> level shifter on `SDA`, `SCK`, `MOSI` and `RST`, and marks it as missing from
> the parts list. Do not connect 5 V logic straight to the reader: fit the
> shifter (or a resistor divider on each 5 V line) first. `MISO` is driven by
> the reader and is fine as-is.

## Relay and solenoid polarity — check before connecting 12 V

With the motor disconnected, power the Uno over USB only:

- The relay module's indicator LED must be **off** while the sketch is idle.
- If it is on, your module is active-HIGH: set `RELAY_ACTIVE_LOW = false`.

For the solenoid, `SOLENOID_ACTIVE_HIGH = true` matches the IRLB8314 gate
through 220 Ω with the 10 k pull-down. The solenoid only energises after a
verified standstill.

During the bootloader window the Uno's pins are inputs, so the relay module's
IN pin floats until `setup()` runs. On the bench, add a **10 kΩ pull-up from
relay IN to 5 V** if your module does not already have one, so the relay cannot
chatter while the board resets.

## Guard switches (optional, not fitted)

The schematic reserves `D2`/`D3` and marks guard switches as unavailable. If you
fit switches wired to GND:

```cpp
constexpr int8_t PIN_GUARD_A = 2;
constexpr int8_t PIN_GUARD_B = 3;
```

Both channels must agree; one open and one closed is reported as
`GUARD_CHANNEL_MISMATCH` and **that is not a safe condition**. Until then both
channels stay `UNKNOWN`, which the dashboard shows as unverified rather than
as safe.

## Standstill calibration (required before the lock can be released)

The default sketch reports `NOT_VERIFIED` and never energises the solenoid,
because an uncalibrated threshold cannot prove a stop. If the settle condition
is met while `STANDSTILL_CALIBRATED` is `false`, the board sends one
`CALIBRATION_REQUIRED` event and returns to idle instead of unlocking.

1. Power the motor circuit and run the sequence with the dashboard open.
   Set `STANDSTILL_CALIBRATED = false` still.
2. Watch **Overview → back-EMF** and the `back_emf_adc` values in the chart
   while the motor coasts to rest.
3. Note the resting noise floor (ideally under 10 counts) and the smallest
   reading that still looks like a spinning motor. Set
   `STANDSTILL_ADC_MAX` between them, closer to the noise floor.
4. Check the comparator: with the motor stopped, `D6` should read `LOW`.
   If it reads the opposite, set `COMPARATOR_LOW_MEANS_STANDSTILL = false`.
5. Only when both checks pass on your hardware, set
   `STANDSTILL_CALIBRATED = true` and re-upload.

The 100 k / 10 k divider gives roughly 223 counts at 12 V. **Do not connect `A0`
to a voltage above 5 V**; confirm the divider and its tolerances, and check for
inductive spikes before wiring the motor.

## Command channel

The dashboard sends newline-delimited JSON v1 commands. Only these two frames
are acted on; everything else is ignored without a reply:

```json
{"v":1,"type":"command","seq":1,"action":"MOTOR_ON"}
{"v":1,"type":"command","seq":2,"action":"MOTOR_OFF"}
```

`MOTOR_ON` is a **run permit**: it starts the motor from idle and must keep
arriving at least every `RUN_PERMIT_TIMEOUT_MS` (2.5 s) for the motor to stay
energised. If the permit stops — the dashboard closes, the cable is pulled, the
laptop sleeps — the sketch cuts the relay and runs the normal stop sequence. The
dashboard resends the permit about once a second while the motor runs.

The command channel cannot bypass safety:

- `MOTOR_ON` only reaches the relay through `startRun()`, which runs only from
  idle, so a released guard or a fault blocks a start.
- The unlock is still decided on the board by the comparator and divider.
- There is no command that releases the lock, clears a fault or changes a
  threshold.

## What the sketch does

| Step | Behaviour |
| --- | --- |
| Idle | Relay off. Nothing is claimed about the shaft; `standstill` is `NOT_VERIFIED` until a stop has been verified since boot. |
| Start | On `MOTOR_ON` from idle: relay on, state `RUNNING`, standstill `NOT_VERIFIED`. |
| Run | Stays energised while the permit keeps arriving, until `MOTOR_OFF` or the optional stop button (`D4`, not fitted) is pressed. |
| Stop | Relay off, state `STOPPING`, standstill `VERIFYING`; the lock stays locked. |
| Verify | The comparator must show standstill and `A0` must stay below `STANDSTILL_ADC_MAX` for `STANDSTILL_SETTLE_MS`. |
| Release | With `STANDSTILL_CALIBRATED = true`, `VERIFIED` is reported and the solenoid pulses for `RELEASE_MS` (3 s). |
| Re-latch | The shaft is expected to be turned off the release window; any movement aborts the release immediately (`RELEASE_ABORTED`). |
| Fault | `STOP_TIMEOUT` if no standstill within 6 s; `SENSOR_CONFLICT` if the comparator claims standstill while the divider reads above `MOTOR_LIVE_ADC` (half of the 12 V reading); `LINK_LOST_STOP` when a running motor loses its permit. A fault de-energises both outputs. Press the Uno's **RESET** button to clear it; the sketch never clears a fault by itself. |

A card scan only reports the access decision. It never starts the motor on its
own: an authorised scan opens the dashboard session, and the engineer still has
to press **MOTOR ON**.

## Upload troubleshooting

| Arduino IDE message | Meaning | Action |
| --- | --- | --- |
| `ser_open(): can't open device` / `Access is denied` | Another program holds the port | Stop ProofLock (`Ctrl+C` in its terminal), close Serial Monitor/Plotter, unplug and replug the Uno |
| `avrdude: stk500_recv(): programmer is not responding` | The uploader never reached the bootloader | Use a **data** USB cable, try another port, and remove anything from `D0`/`D1` |
| `avrdude: stk500_getsync(): not in sync` | Port selected may be another device | Reselect the CH340 port; on clones try *Processor → ATmega328P (Old Bootloader)* |
| `avrdude: programmer is not responding` after a failed upload | Bootloader timing | Press and hold **RESET**, click Upload, release when the IDE says *Uploading* |
| `Done uploading` but nothing on the port | Sketch runs but sends nothing, or baud differs | Open Serial Monitor at 115200 and confirm telemetry lines. If the board is from a clone batch, also try *Processor → ATmega328P (Old Bootloader)* |
| Port disappears during upload | Power or cable problem | Use a powered USB hub, avoid long/frayed cables |

## Known limitations

- No guard switches, lock-position sensor or motor-current sensing on the
  current build: those channels stay `UNKNOWN` and are never inferred.
- The solenoid command is not the same as confirmed lock feedback; the sketch
  reports `lock: UNKNOWN`.
- The settle threshold is a single ADC window plus one comparator input; there
  is no independent verification.
- Blocking calls in library reads (`PICC_IsNewCardPresent`) can delay one
  telemetry frame by a few milliseconds. The dashboard's 3 s freshness window
  tolerates this.
