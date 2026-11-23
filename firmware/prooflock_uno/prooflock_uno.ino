/*
  ProofLock — Arduino Uno R3 demonstration firmware (serial protocol v1)

  Read the wiring notes in firmware/README.md before powering the 12 V motor.
  The dashboard only listens on USB; it never sends commands to this sketch.

  This sketch is a bench demonstration, not a certified machine-safety device.
  Verify the relay polarity, the comparator polarity and the standstill
  threshold on your own hardware before trusting any state shown on screen.

  Quick facts
    - Serial: 115200 baud, newline-delimited JSON, one object per line.
    - RFID: MFRC522 on SPI (SS D10, RST D9, SCK D13, MOSI D11, MISO D12).
    - Relay module IN on D7, solenoid gate on D8, comparator DO on D6,
      back-EMF divider midpoint on A0.
    - Card UIDs never leave the board. Only ACCEPTED/DENIED plus a short
      local reference such as OP-02 is transmitted.
*/

#include <SPI.h>
#include <MFRC522.h>
#include <string.h>

// --------------------------------------------------------------------------
// 1. Link and identity
// --------------------------------------------------------------------------
constexpr unsigned long BAUD_RATE = 115200;
constexpr unsigned long TELEMETRY_INTERVAL_MS = 500;
constexpr char FIRMWARE_ID[] = "bench-2.0";
constexpr char DEVICE_ID[] = "prooflock-uno";

// --------------------------------------------------------------------------
// 2. Pins and input/output polarity
//    A pin set to -1 means "not fitted"; that channel reports UNKNOWN.
// --------------------------------------------------------------------------
constexpr uint8_t PIN_RFID_SS = 10;
constexpr uint8_t PIN_RFID_RST = 9;
constexpr uint8_t PIN_RELAY_MOTOR = 7;
constexpr uint8_t PIN_SOLENOID = 8;
constexpr int8_t PIN_STANDSTILL_DO = 6;
constexpr int8_t PIN_BACK_EMF = A0;
constexpr int8_t PIN_GUARD_A = -1;      // fit the guard switch on D2, then set 2
constexpr int8_t PIN_GUARD_B = -1;      // fit the guard switch on D3, then set 3
constexpr int8_t PIN_STOP_BUTTON = -1;  // optional stop button on D4, then set 4

// Most 5 V relay modules energise on a LOW input. Check yours with the motor
// disconnected: the module LED must be OFF while the sketch is idle.
constexpr bool RELAY_ACTIVE_LOW = true;
// IRLB8314 gate through 220 ohm, pulled down by 10 k: HIGH energises.
constexpr bool SOLENOID_ACTIVE_HIGH = true;
// LM393 DO is usually pulled up, so it goes LOW when the motor is stopped.
constexpr bool COMPARATOR_LOW_MEANS_STANDSTILL = true;
// Switches to GND with the internal pull-up: closed reads LOW.
constexpr bool GUARD_CLOSED_WHEN_LOW = true;

// --------------------------------------------------------------------------
// 3. Bench calibration
//    A0 sees the 100 k / 10 k divider, so 12 V becomes about 1.09 V and
//    roughly 223 ADC counts. At rest the divider should read close to zero.
//    Watch the back-EMF chart in the dashboard, then set a threshold a little
//    above the noise floor at standstill and clearly below the decay tail.
//    Until you have done that, keep STANDSTILL_CALIBRATED false: the sketch
//    will report NOT_VERIFIED and will not energise the solenoid, and it will
//    send one CALIBRATION_REQUIRED event. That is deliberate. An uncalibrated
//    sketch must not claim a verified stop.
// --------------------------------------------------------------------------
constexpr int STANDSTILL_ADC_MAX = 20;
// A reading this high means the divider is seeing a live supply, whatever the
// comparator claims. Half of the ~223 counts expected at 12 V.
constexpr int MOTOR_LIVE_ADC = 120;
constexpr uint32_t STANDSTILL_SETTLE_MS = 1500;
constexpr bool STANDSTILL_CALIBRATED = false;

// --------------------------------------------------------------------------
// 4. Sequence timing
// --------------------------------------------------------------------------
constexpr uint32_t MOTOR_RUN_MS = 4000;
constexpr uint32_t STOP_TIMEOUT_MS = 6000;
constexpr uint32_t RELEASE_MS = 3000;
constexpr uint32_t RFID_REPEAT_MS = 2500;
constexpr uint32_t SENSOR_CONFLICT_MS = 1200;

// Set true to print raw card UIDs on the Arduino Serial Monitor so you can
// paste them into AUTHORIZED_TAGS below. Disconnect ProofLock while doing it.
constexpr bool ENROLL_MODE = false;

// --------------------------------------------------------------------------
// 5. Local operator table (4-byte and 7-byte UIDs both work)
//    Add one row per authorised card. The reference must look like OP-01.
// --------------------------------------------------------------------------
struct LocalTag {
  uint8_t length;
  uint8_t uid[7];
  const char *reference;
};

const LocalTag AUTHORIZED_TAGS[] = {
  // Replace this placeholder row with your enrolled cards, for example:
  // {4, {0xDE, 0xAD, 0xBE, 0xEF}, "OP-01"},
  // {7, {0x04, 0xA1, 0x22, 0x33, 0x44, 0x55, 0x66}, "OP-02"},
  {0, {0}, nullptr},
};

// --------------------------------------------------------------------------
// 6. Runtime state
// --------------------------------------------------------------------------
enum Phase { PH_IDLE, PH_RUNNING, PH_STOPPING, PH_RELEASED, PH_FAULT };

MFRC522 mfrc522(PIN_RFID_SS, PIN_RFID_RST);

Phase phase = PH_IDLE;
uint32_t phaseSinceMs = 0;
uint32_t settleSinceMs = 0;
bool settleRunning = false;
uint32_t conflictSinceMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastTagSeenMs = 0;
uint32_t sequence = 0;
uint8_t lastTagUid[7];
uint8_t lastTagLength = 0;

bool readerReady = false;
bool calibrationNoticeSent = false;
// No stop has been verified since boot, so "standstill" must not be claimed yet.
bool stopVerifiedSinceBoot = false;
const char *motorState = "UNKNOWN";
const char *standstillState = "UNKNOWN";
// A timeout does not prove the shaft stopped, so it must not report a
// sensor fault; a self-contradicting sensor pair does.
const char *faultStandstillState = "NOT_VERIFIED";

// --------------------------------------------------------------------------
// 7. Small helpers
// --------------------------------------------------------------------------
uint32_t nextSeq() {
  return sequence++;
}

constexpr uint8_t relayOffLevel() {
  return RELAY_ACTIVE_LOW ? HIGH : LOW;
}

constexpr uint8_t relayOnLevel() {
  return RELAY_ACTIVE_LOW ? LOW : HIGH;
}

constexpr uint8_t solenoidOnLevel() {
  return SOLENOID_ACTIVE_HIGH ? HIGH : LOW;
}

constexpr uint8_t solenoidOffLevel() {
  return SOLENOID_ACTIVE_HIGH ? LOW : HIGH;
}

void relayOff() {
  digitalWrite(PIN_RELAY_MOTOR, relayOffLevel());
}

void relayOn() {
  digitalWrite(PIN_RELAY_MOTOR, relayOnLevel());
}

void solenoidOff() {
  digitalWrite(PIN_SOLENOID, solenoidOffLevel());
}

void solenoidOn() {
  digitalWrite(PIN_SOLENOID, solenoidOnLevel());
}

bool comparatorSaysStandstill() {
  if (PIN_STANDSTILL_DO < 0) {
    return false;
  }
  const int level = digitalRead((uint8_t)PIN_STANDSTILL_DO);
  return COMPARATOR_LOW_MEANS_STANDSTILL ? level == LOW : level == HIGH;
}

int readBackEmf() {
  if (PIN_BACK_EMF < 0) {
    return 0;
  }
  uint16_t sum = 0;
  for (uint8_t i = 0; i < 4; ++i) {
    sum += (uint16_t)analogRead((uint8_t)PIN_BACK_EMF);
  }
  return (int)(sum / 4);
}

bool stopConditionMet(int adc) {
  return comparatorSaysStandstill() && adc <= STANDSTILL_ADC_MAX;
}

// Majority of three samples, so one noisy edge does not flip a guard channel.
const char *readGuard(int8_t pin) {
  if (pin < 0) {
    return "UNKNOWN";
  }
  uint8_t low = 0;
  for (uint8_t i = 0; i < 3; ++i) {
    if (digitalRead((uint8_t)pin) == LOW) {
      ++low;
    }
    delayMicroseconds(800);
  }
  const bool closed = GUARD_CLOSED_WHEN_LOW ? (low >= 2) : (low < 2);
  return closed ? "CLOSED" : "OPEN";
}

bool stopButtonPressed() {
  if (PIN_STOP_BUTTON < 0) {
    return false;
  }
  return digitalRead((uint8_t)PIN_STOP_BUTTON) == LOW;
}

// --------------------------------------------------------------------------
// 8. Protocol v1 frames
// --------------------------------------------------------------------------
void sendEvent(const char *code, const char *severity) {
  Serial.print(F("{\"v\":1,\"type\":\"event\",\"seq\":"));
  Serial.print(nextSeq());
  Serial.print(F(",\"code\":\""));
  Serial.print(code);
  Serial.print(F("\",\"severity\":\""));
  Serial.print(severity);
  Serial.print(F("\",\"device\":\""));
  Serial.print(DEVICE_ID);
  Serial.print(F("\",\"firmware\":\""));
  Serial.print(FIRMWARE_ID);
  Serial.print(F("\",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.println(F("}"));
}

void sendRfid(const char *result, const char *reference) {
  Serial.print(F("{\"v\":1,\"type\":\"rfid\",\"seq\":"));
  Serial.print(nextSeq());
  Serial.print(F(",\"result\":\""));
  Serial.print(result);
  Serial.print('"');
  if (reference != nullptr) {
    Serial.print(F(",\"operator_ref\":\""));
    Serial.print(reference);
    Serial.print('"');
  }
  Serial.print(F(",\"device\":\""));
  Serial.print(DEVICE_ID);
  Serial.print(F("\",\"firmware\":\""));
  Serial.print(FIRMWARE_ID);
  Serial.print(F("\",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.println(F("}"));
}

void sendTelemetry(int adc) {
  Serial.print(F("{\"v\":1,\"type\":\"telemetry\",\"seq\":"));
  Serial.print(nextSeq());
  Serial.print(F(",\"device\":\""));
  Serial.print(DEVICE_ID);
  Serial.print(F("\",\"firmware\":\""));
  Serial.print(FIRMWARE_ID);
  Serial.print(F("\",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.print(F(",\"motor\":\""));
  Serial.print(motorState);
  Serial.print(F("\",\"guard_a\":\""));
  Serial.print(readGuard(PIN_GUARD_A));
  Serial.print(F("\",\"guard_b\":\""));
  Serial.print(readGuard(PIN_GUARD_B));
  // No lock-position sensor is fitted on the demonstration build, so the
  // solenoid command is never reported as sensed lock feedback.
  Serial.print(F("\",\"lock\":\"UNKNOWN\",\"standstill\":\""));
  Serial.print(standstillState);
  Serial.print(F("\",\"back_emf_adc\":"));
  Serial.print(adc);
  Serial.println(F("}"));
}

// --------------------------------------------------------------------------
// 9. Machine sequence (this is the prototype's own control logic)
// --------------------------------------------------------------------------
void startRun(uint32_t now) {
  relayOn();
  motorState = "RUNNING";
  phase = PH_RUNNING;
  phaseSinceMs = now;
  settleRunning = false;
}

void beginStop(uint32_t now) {
  relayOff();
  motorState = "STOPPING";
  phase = PH_STOPPING;
  phaseSinceMs = now;
  settleRunning = false;
  conflictSinceMs = 0;
}

void raiseFault(const char *code) {
  relayOff();
  solenoidOff();
  motorState = "FAULT";
  faultStandstillState = (strcmp(code, "SENSOR_CONFLICT") == 0) ? "SENSOR_FAULT" : "NOT_VERIFIED";
  phase = PH_FAULT;
  phaseSinceMs = millis();
  settleRunning = false;
  sendEvent(code, "ERROR");
}

void releaseLock(uint32_t now) {
  solenoidOn();
  motorState = "STOPPED";
  stopVerifiedSinceBoot = true;
  phase = PH_RELEASED;
  phaseSinceMs = now;
  sendEvent("STANDSTILL_VERIFIED", "INFO");
  sendEvent("SOLENOID_ENERGISED", "INFO");
}

// Standstill is derived from the present phase and the present inputs on every
// pass, instead of latching the last good result. Turn the shaft by hand while
// idle and the report must change; a latched VERIFIED would be a false claim.
void refreshStandstill(int adc) {
  switch (phase) {
    case PH_RUNNING:
      standstillState = "NOT_VERIFIED";
      break;
    case PH_STOPPING:
      standstillState = "VERIFYING";
      break;
    case PH_RELEASED:
      standstillState = "VERIFIED";
      break;
    case PH_FAULT:
      standstillState = faultStandstillState;
      break;
    case PH_IDLE:
      standstillState = (stopVerifiedSinceBoot && STANDSTILL_CALIBRATED && stopConditionMet(adc))
                            ? "VERIFIED"
                            : "NOT_VERIFIED";
      break;
  }
}

// --------------------------------------------------------------------------
// 10. Per-loop services
// --------------------------------------------------------------------------
bool matchesAuthorisedTag(const uint8_t *uid, uint8_t length, const char **reference) {
  for (const LocalTag &tag : AUTHORIZED_TAGS) {
    if (tag.reference == nullptr || tag.length != length) {
      continue;
    }
    if (memcmp(tag.uid, uid, length) == 0) {
      *reference = tag.reference;
      return true;
    }
  }
  return false;
}

bool sameAsPreviousTag(const uint8_t *uid, uint8_t length) {
  return length == lastTagLength && memcmp(uid, lastTagUid, length) == 0;
}

void rememberTag(const uint8_t *uid, uint8_t length, uint32_t now) {
  memcpy(lastTagUid, uid, length);
  lastTagLength = length;
  lastTagSeenMs = now;
}

void printUidForEnrolment(const uint8_t *uid, uint8_t length) {
  Serial.print(F("# card UID: {"));
  for (uint8_t i = 0; i < length; ++i) {
    if (uid[i] < 0x10) {
      Serial.print('0');
    }
    Serial.print(uid[i], HEX);
    if (i + 1 < length) {
      Serial.print(F(", 0x"));
    }
  }
  Serial.println(F("}"));
}

void serviceRfid(uint32_t now) {
  if (!readerReady) {
    return;
  }
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  const uint8_t *uid = mfrc522.uid.uidByte;
  const uint8_t length = mfrc522.uid.size;

  if (ENROLL_MODE) {
    printUidForEnrolment(uid, length);
    mfrc522.PICC_HaltA();
    return;
  }

  if (length > sizeof(lastTagUid)) {
    // Longer UIDs than the local table can hold are rejected, never truncated.
    sendRfid("DENIED", nullptr);
    mfrc522.PICC_HaltA();
    return;
  }

  // Ignore the same card while it stays on the reader, then allow a rescan.
  if (sameAsPreviousTag(uid, length) && (now - lastTagSeenMs) < RFID_REPEAT_MS) {
    mfrc522.PICC_HaltA();
    return;
  }
  rememberTag(uid, length, now);

  const char *reference = nullptr;
  const bool allowed = matchesAuthorisedTag(uid, length, &reference);

  if (allowed) {
    sendRfid("ACCEPTED", reference);
    if (phase == PH_IDLE) {
      startRun(now);
    }
  } else {
    sendRfid("DENIED", nullptr);
  }

  mfrc522.PICC_HaltA();
}

void serviceSensorConflict(uint32_t now, int adc) {
  if (phase != PH_RUNNING) {
    conflictSinceMs = 0;
    return;
  }
  // The comparator must not claim standstill while the divider shows a live
  // motor. If it does, the comparator input or its polarity is wrong.
  const bool impossible = comparatorSaysStandstill() && adc > MOTOR_LIVE_ADC;
  if (!impossible) {
    conflictSinceMs = 0;
    return;
  }
  if (conflictSinceMs == 0) {
    conflictSinceMs = now;
  } else if (now - conflictSinceMs >= SENSOR_CONFLICT_MS) {
    raiseFault("SENSOR_CONFLICT");
  }
}

void servicePhase(uint32_t now, int adc) {
  switch (phase) {
    case PH_RUNNING:
      if (stopButtonPressed() || now - phaseSinceMs >= MOTOR_RUN_MS) {
        beginStop(now);
      }
      break;

    case PH_STOPPING: {
      if (!stopConditionMet(adc)) {
        settleRunning = false;
      } else if (!settleRunning) {
        settleRunning = true;
        settleSinceMs = now;
      }

      if (settleRunning && now - settleSinceMs >= STANDSTILL_SETTLE_MS) {
        if (!STANDSTILL_CALIBRATED) {
          // The settle condition was met, but the threshold is still a guess.
          // Report the truth and return to idle without releasing the lock.
          motorState = "UNKNOWN";
          phase = PH_IDLE;
          phaseSinceMs = now;
          settleRunning = false;
          if (!calibrationNoticeSent) {
            calibrationNoticeSent = true;
            sendEvent("CALIBRATION_REQUIRED", "WARNING");
          }
        } else {
          settleRunning = false;
          releaseLock(now);
        }
      } else if (now - phaseSinceMs >= STOP_TIMEOUT_MS) {
        raiseFault("STOP_TIMEOUT");
      }
      break;
    }

    case PH_RELEASED:
      if (!stopConditionMet(adc)) {
        // The shaft moved during the release window: retract immediately
        // instead of holding an unlock that is no longer justified.
        solenoidOff();
        motorState = "UNKNOWN";
        phase = PH_IDLE;
        phaseSinceMs = now;
        sendEvent("RELEASE_ABORTED", "WARNING");
      } else if (now - phaseSinceMs >= RELEASE_MS) {
        solenoidOff();
        motorState = "UNKNOWN";   // relay off; nothing senses the shaft
        phase = PH_IDLE;
        phaseSinceMs = now;
      }
      break;

    case PH_IDLE:
    case PH_FAULT:
      // Nothing to stop here. A fault needs a reset; this sketch never
      // clears a fault on its own.
      break;
  }
}

// --------------------------------------------------------------------------
// 11. Setup and loop
// --------------------------------------------------------------------------
void setup() {
  // Drive the safe level into the port latch *before* the pin becomes an
  // output, so the relay and the solenoid never pulse on during start-up.
  digitalWrite(PIN_RELAY_MOTOR, relayOffLevel());
  pinMode(PIN_RELAY_MOTOR, OUTPUT);
  digitalWrite(PIN_SOLENOID, solenoidOffLevel());
  pinMode(PIN_SOLENOID, OUTPUT);

  if (PIN_STANDSTILL_DO >= 0) {
    pinMode((uint8_t)PIN_STANDSTILL_DO, INPUT_PULLUP);
  }
  if (PIN_BACK_EMF >= 0) {
    pinMode((uint8_t)PIN_BACK_EMF, INPUT);
  }
  if (PIN_GUARD_A >= 0) {
    pinMode((uint8_t)PIN_GUARD_A, INPUT_PULLUP);
  }
  if (PIN_GUARD_B >= 0) {
    pinMode((uint8_t)PIN_GUARD_B, INPUT_PULLUP);
  }
  if (PIN_STOP_BUTTON >= 0) {
    pinMode((uint8_t)PIN_STOP_BUTTON, INPUT_PULLUP);
  }

  Serial.begin(BAUD_RATE);

  SPI.begin();
  mfrc522.PCD_Init();
  delay(50);
  const uint8_t version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  readerReady = !(version == 0x00 || version == 0xFF);
  if (!readerReady) {
    // Reader missing: say so instead of pretending a scan is possible.
    sendRfid("NOT_CONFIGURED", nullptr);
  }

  const uint32_t now = millis();
  phaseSinceMs = now;
  lastTelemetryMs = now;
  const int adc = readBackEmf();
  refreshStandstill(adc);
  sendEvent("FIRMWARE_STARTED", "INFO");
  sendTelemetry(adc);
}

void loop() {
  const uint32_t now = millis();
  const int adc = readBackEmf();

  serviceRfid(now);
  serviceSensorConflict(now, adc);
  servicePhase(now, adc);
  refreshStandstill(adc);

  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetry(adc);
  }
}
