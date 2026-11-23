/*
  ProofLock — component test bench (Arduino IDE + Serial Monitor)

  Use this sketch to check each part of the build on its own, before running
  the full firmware. It prints PLAIN TEXT, not protocol JSON, so keep
  ProofLock disconnected while you use it: the dashboard would otherwise
  count every line as a rejected frame.

  No stop switch is fitted yet, so this sketch never leaves an output on:
    - the relay is pulsed for a fixed time and then switched off,
    - any key typed in Serial Monitor stops the pulse immediately,
    - pressing the board's RESET button stops it,
    - uploading another sketch stops it; opening Serial Monitor resets the
      board and stops it.

  Fit a 10 kΩ pull-up from relay IN (D7) to 5 V before connecting the motor.
  Without it, a floating IN pin during reset can switch an active-LOW relay
  module on for a moment.

  Serial Monitor: 115200 baud, "Newline" or "No line ending" both work.
*/

#include <SPI.h>
#include <MFRC522.h>

// --------------------------------------------------------------------------
// Pins — same wiring as the build
// --------------------------------------------------------------------------
constexpr uint8_t PIN_RELAY = 7;
constexpr uint8_t PIN_SOLENOID = 8;
constexpr int8_t PIN_COMPARATOR = 6;
constexpr int8_t PIN_BACK_EMF = A0;
constexpr int8_t PIN_GUARD_A = 2;
constexpr int8_t PIN_GUARD_B = 3;
constexpr uint8_t PIN_RFID_SS = 10;
constexpr uint8_t PIN_RFID_RST = 9;

// Polarity: check the relay module with the motor disconnected. If the module
// LED is on while idle, change RELAY_ACTIVE_LOW to false.
constexpr bool RELAY_ACTIVE_LOW = true;
constexpr bool SOLENOID_ACTIVE_HIGH = true;
constexpr bool COMPARATOR_LOW_MEANS_STANDSTILL = true;
constexpr bool GUARD_CLOSED_WHEN_LOW = true;

// --------------------------------------------------------------------------
// Test timing
// --------------------------------------------------------------------------
constexpr uint32_t MOTOR_TEST_MS = 2000;
constexpr uint32_t MOTOR_MAX_MS = 5000;   // hard cap, even if a test misbehaves
constexpr uint32_t SOLENOID_TEST_MS = 500;
constexpr uint32_t WINDOW_MS = 10000;     // streaming tests
constexpr uint32_t RFID_WINDOW_MS = 20000;

#ifndef F_CPU
#define F_CPU 16000000UL
#endif

MFRC522 mfrc522(PIN_RFID_SS, PIN_RFID_RST);

// --------------------------------------------------------------------------
// Results
// --------------------------------------------------------------------------
enum State : uint8_t { NOT_RUN, PASSED, FAILED, OBSERVE };

struct Result {
  const char *name;
  State state;
};

Result results[] = {
  {"USB serial", NOT_RUN},
  {"MFRC522 reader", NOT_RUN},
  {"Relay D7 / motor", NOT_RUN},
  {"Solenoid D8", NOT_RUN},
  {"Comparator D6", NOT_RUN},
  {"Back-EMF A0", NOT_RUN},
  {"Guard D2 / D3", NOT_RUN},
};
constexpr uint8_t RESULT_COUNT = sizeof(results) / sizeof(results[0]);

const char *stateName(State state) {
  switch (state) {
    case PASSED: return "PASS";
    case FAILED: return "FAIL";
    case OBSERVE: return "CHECK BY HAND";
    default: return "not run";
  }
}

void setResult(uint8_t index, State state) {
  if (index < RESULT_COUNT) {
    results[index].state = state;
  }
}

void printSummary() {
  Serial.println();
  Serial.println(F("--- summary ------------------------------------"));
  for (uint8_t i = 0; i < RESULT_COUNT; ++i) {
    Serial.print(F("  "));
    Serial.print(results[i].name);
    Serial.print(F(": "));
    Serial.println(stateName(results[i].state));
  }
  Serial.println(F("------------------------------------------------"));
  Serial.println(F("CHECK BY HAND means the sketch cannot judge it: listen for the"));
  Serial.println(F("relay click, watch the motor, or measure the divider by hand."));
}

// --------------------------------------------------------------------------
// Outputs
// --------------------------------------------------------------------------
uint8_t relayOffLevel() {
  return RELAY_ACTIVE_LOW ? HIGH : LOW;
}

uint8_t relayOnLevel() {
  return RELAY_ACTIVE_LOW ? LOW : HIGH;
}

uint8_t solenoidOnLevel() {
  return SOLENOID_ACTIVE_HIGH ? HIGH : LOW;
}

uint8_t solenoidOffLevel() {
  return SOLENOID_ACTIVE_HIGH ? LOW : HIGH;
}

void allOff() {
  digitalWrite(PIN_RELAY, relayOffLevel());
  digitalWrite(PIN_SOLENOID, solenoidOffLevel());
}

// Wait for the given time; returns true if a key was pressed instead.
bool waitOrAbort(uint32_t ms) {
  const uint32_t start = millis();
  while (millis() - start < ms) {
    if (Serial.available()) {
      Serial.read();
      return true;
    }
    delay(5);
  }
  return false;
}

void printUid() {
  for (uint8_t i = 0; i < mfrc522.uid.size; ++i) {
    if (mfrc522.uid.uidByte[i] < 0x10) {
      Serial.print('0');
    }
    Serial.print(mfrc522.uid.uidByte[i], HEX);
    if (i + 1 < mfrc522.uid.size) {
      Serial.print(' ');
    }
  }
}

// --------------------------------------------------------------------------
// 1. USB serial
// --------------------------------------------------------------------------
void testSerial() {
  Serial.println();
  Serial.println(F("[1] USB serial and board"));
  Serial.print(F("    F_CPU = "));
  Serial.print((unsigned long)F_CPU);
  Serial.println(F(" Hz"));
  Serial.print(F("    Uptime when you asked: "));
  Serial.print(millis());
  Serial.println(F(" ms"));
  Serial.println(F("    If you can read this line, the USB cable, the CH340 chip,"));
  Serial.println(F("    the board and this sketch are all working."));
  Serial.println(F("    RESULT: PASS"));
  setResult(0, PASSED);
}

// --------------------------------------------------------------------------
// 2. MFRC522 reader
// --------------------------------------------------------------------------
void testReader() {
  Serial.println();
  Serial.println(F("[2] MFRC522 RFID reader"));
  const uint8_t version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print(F("    VersionReg = 0x"));
  if (version < 0x10) {
    Serial.print('0');
  }
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println(F("    The reader did not answer on SPI."));
    Serial.println(F("    Check: 3.3 V on the reader (never 5 V), GND common,"));
    Serial.println(F("    SS D10, RST D9, SCK D13, MOSI D11, MISO D12,"));
    Serial.println(F("    and the 3.3 V level shifter on SDA/SCK/MOSI/RST."));
    Serial.println(F("    RESULT: FAIL"));
    setResult(1, FAILED);
    return;
  }

  Serial.println(F("    Reader answered. Tap a card during the next 20 s."));
  Serial.println(F("    Press any key to stop early."));
  const uint32_t end = millis() + RFID_WINDOW_MS;
  uint8_t cards = 0;
  while ((int32_t)(end - millis()) > 0) {
    if (Serial.available()) {
      Serial.read();
      break;
    }
    if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
      continue;
    }
    ++cards;
    Serial.print(F("    card "));
    Serial.print(cards);
    Serial.print(F(": "));
    printUid();
    Serial.print(F("  ("));
    Serial.print(mfrc522.uid.size);
    Serial.println(F(" bytes)"));
    mfrc522.PICC_HaltA();
    delay(300);   // do not read the same card twice in a row
  }

  if (cards == 0) {
    Serial.println(F("    No card was read."));
    Serial.println(F("    Reader talks on SPI, so the antenna or the card is the"));
    Serial.println(F("    problem. Try a different card, closer to the coil."));
    Serial.println(F("    RESULT: FAIL"));
    setResult(1, FAILED);
  } else {
    Serial.print(F("    Cards read: "));
    Serial.println(cards);
    Serial.println(F("    RESULT: PASS"));
    setResult(1, PASSED);
  }
}

// --------------------------------------------------------------------------
// 3. Relay and motor
// --------------------------------------------------------------------------
void testMotor() {
  Serial.println();
  Serial.println(F("[3] Relay D7 and motor"));
  Serial.println(F("    First test: leave the 12 V supply unplugged. You should"));
  Serial.println(F("    hear a click and see the relay LED, but the motor stays off."));
  Serial.println(F("    With 12 V connected the motor runs for 2 s and then stops."));
  Serial.println(F("    Any key in Serial Monitor stops it sooner."));
  if (waitOrAbort(2500)) {
    Serial.println(F("    Cancelled before switching on."));
    return;
  }

  digitalWrite(PIN_RELAY, relayOnLevel());
  const uint32_t start = millis();
  bool aborted = false;
  while (millis() - start < MOTOR_TEST_MS && millis() - start < MOTOR_MAX_MS) {
    if (Serial.available()) {
      Serial.read();
      aborted = true;
      break;
    }
    delay(5);
  }
  digitalWrite(PIN_RELAY, relayOffLevel());
  allOff();

  Serial.print(F("    Relay was on for "));
  Serial.print(millis() - start);
  Serial.print(F(" ms"));
  Serial.println(aborted ? F(" (stopped by key).") : F(" (timed stop)."));
  Serial.println(F("    Did you hear one click on and one click off?"));
  Serial.println(F("    No click: check the module's VCC/GND, IN on D7, and"));
  Serial.println(F("    the relay jumper. LED always on: set RELAY_ACTIVE_LOW"));
  Serial.println(F("    to false. Clicks but no motor: check the 12 V feed, the"));
  Serial.println(F("    COM/NO contacts and the fuse."));
  Serial.println(F("    RESULT: CHECK BY HAND"));
  setResult(2, OBSERVE);
}

// --------------------------------------------------------------------------
// 4. Solenoid driver
// --------------------------------------------------------------------------
void testSolenoid() {
  Serial.println();
  Serial.println(F("[4] Solenoid driver (IRLB8314 on D8)"));
  Serial.println(F("    The solenoid gets a 0.5 s pulse. Keep the 12 V feed ready to"));
  Serial.println(F("    unplug and do not hold it energised: the coil is not rated for"));
  Serial.println(F("    continuous use. The 1N5408 must be across the coil."));
  if (waitOrAbort(2500)) {
    Serial.println(F("    Cancelled before switching on."));
    return;
  }

  digitalWrite(PIN_SOLENOID, solenoidOnLevel());
  const uint32_t start = millis();
  bool aborted = false;
  while (millis() - start < SOLENOID_TEST_MS) {
    if (Serial.available()) {
      Serial.read();
      aborted = true;
      break;
    }
    delay(5);
  }
  digitalWrite(PIN_SOLENOID, solenoidOffLevel());
  allOff();

  Serial.print(F("    Pulse length: "));
  Serial.print(millis() - start);
  Serial.print(F(" ms"));
  Serial.println(aborted ? F(" (stopped by key).") : F("."));
  Serial.println(F("    A single click or a short movement means the MOSFET,"));
  Serial.println(F("    the gate resistor and the flyback diode are working."));
  Serial.println(F("    Nothing happens: check D8, the 220 ohm gate resistor,"));
  Serial.println(F("    the 10 k pull-down and the solenoid supply."));
  Serial.println(F("    RESULT: CHECK BY HAND"));
  setResult(3, OBSERVE);
}

// --------------------------------------------------------------------------
// 5. LM393 comparator
// --------------------------------------------------------------------------
void testComparator() {
  Serial.println();
  Serial.println(F("[5] LM393 comparator on D6 (standstill input)"));
  Serial.println(F("    Reading D6 for 10 s. Turn the motor shaft by hand while it"));
  Serial.println(F("    runs: the level should change if the comparator is working."));
  Serial.println(F("    Expected with the motor at rest: LOW (0)."));

  const uint32_t end = millis() + WINDOW_MS;
  uint32_t changes = 0;
  int last = -1;
  while ((int32_t)(end - millis()) > 0) {
    if (Serial.available()) {
      Serial.read();
      break;
    }
    const int level = digitalRead(PIN_COMPARATOR);
    if (level != last) {
      if (last >= 0) {
        ++changes;
      }
      last = level;
      Serial.print(F("    D6 = "));
      Serial.print(level);
      Serial.println(level == LOW ? F(" (LOW)") : F(" (HIGH)"));
    }
    delay(100);
  }

  Serial.print(F("    Transitions seen: "));
  Serial.println(changes);
  if (changes > 0) {
    Serial.println(F("    RESULT: PASS"));
    setResult(4, PASSED);
  } else {
    Serial.println(F("    A constant level can be correct at rest, but it also means"));
    Serial.println(F("    a dead comparator. Check LM393 VCC on 5 V, GND, and that the"));
    Serial.println(F("    module's DO pin goes to D6 (not A0/AO)."));
    Serial.println(F("    RESULT: CHECK BY HAND"));
    setResult(4, OBSERVE);
  }
}

// --------------------------------------------------------------------------
// 6. Back-EMF divider
// --------------------------------------------------------------------------
void testBackEmf() {
  Serial.println();
  Serial.println(F("[6] Back-EMF divider on A0 (100k / 10k)"));
  Serial.println(F("    Reading A0 for 10 s. Expect near 0 at rest and roughly 220"));
  Serial.println(F("    counts while 12 V is across the divider (1.09 V at A0)."));
  Serial.println(F("    Run the motor during this test to see the decay."));

  const uint32_t end = millis() + WINDOW_MS;
  int low = 1023;
  int high = 0;
  int last = -1;
  while ((int32_t)(end - millis()) > 0) {
    if (Serial.available()) {
      Serial.read();
      break;
    }
    uint16_t sum = 0;
    for (uint8_t i = 0; i < 4; ++i) {
      sum += (uint16_t)analogRead(PIN_BACK_EMF);
    }
    const int value = sum / 4;
    low = min(low, value);
    high = max(high, value);
    const int change = value > last ? value - last : last - value;
    if (last < 0 || change >= 4) {
      Serial.print(F("    A0 = "));
      Serial.println(value);
      last = value;
    }
    delay(150);
  }

  Serial.print(F("    min = "));
  Serial.print(low);
  Serial.print(F(", max = "));
  Serial.println(high);
  if (high == 0) {
    Serial.println(F("    Always zero: check the divider midpoint really reaches A0."));
    Serial.println(F("    RESULT: FAIL"));
    setResult(5, FAILED);
  } else {
    Serial.println(F("    Use these numbers to set STANDSTILL_ADC_MAX in the main"));
    Serial.println(F("    sketch, a little above the resting noise floor."));
    Serial.println(F("    RESULT: PASS"));
    setResult(5, PASSED);
  }
}

// --------------------------------------------------------------------------
// 7. Guard inputs
// --------------------------------------------------------------------------
void testGuards() {
  Serial.println();
  Serial.println(F("[7] Guard inputs D2 / D3 (not fitted on this build)"));
  Serial.println(F("    Nothing connected reads OPEN, which is the safe report."));
  Serial.println(F("    Wire one switch at a time from the pin to GND, then press it."));

  const uint32_t end = millis() + WINDOW_MS;
  int lastA = -1;
  int lastB = -1;
  while ((int32_t)(end - millis()) > 0) {
    if (Serial.available()) {
      Serial.read();
      break;
    }
    const int a = digitalRead(PIN_GUARD_A);
    const int b = digitalRead(PIN_GUARD_B);
    if (a != lastA || b != lastB) {
      Serial.print(F("    D2 = "));
      Serial.print(a);
      Serial.print(F(" ("));
      Serial.print(a == LOW ? F("CLOSED") : F("OPEN"));
      Serial.print(F("), D3 = "));
      Serial.print(b);
      Serial.print(b == LOW ? F(" (CLOSED)") : F(" (OPEN)"));
      Serial.println();
      lastA = a;
      lastB = b;
    }
    delay(100);
  }

  Serial.println(F("    Both channels must agree in the main sketch; disagreement"));
  Serial.println(F("    is reported as UNKNOWN/mismatch, never as safe."));
  Serial.println(F("    RESULT: CHECK BY HAND"));
  setResult(6, OBSERVE);
}

// --------------------------------------------------------------------------
// Menu
// --------------------------------------------------------------------------
void printMenu() {
  Serial.println();
  Serial.println(F("--- ProofLock component tests ------------------"));
  Serial.println(F("  1  USB serial and board"));
  Serial.println(F("  2  MFRC522 RFID reader (20 s card scan)"));
  Serial.println(F("  3  Relay D7 / motor (2 s pulse, key stops it)"));
  Serial.println(F("  4  Solenoid D8 (0.5 s pulse)"));
  Serial.println(F("  5  Comparator D6 (10 s)"));
  Serial.println(F("  6  Back-EMF A0 (10 s)"));
  Serial.println(F("  7  Guard inputs D2 / D3 (10 s)"));
  Serial.println(F("  s  Stop both outputs now"));
  Serial.println(F("  r  Print the summary again"));
  Serial.println(F("  ?  Show this menu again"));
  Serial.println(F("------------------------------------------------"));
  Serial.println(F("Outputs never stay on: opening Serial Monitor, pressing RESET,"));
  Serial.println(F("uploading or typing a key all switch them off."));
  Serial.println(F("ProofLock must be disconnected: this sketch prints text,"));
  Serial.println(F("not protocol JSON. Inputs (D2, D3) have pull-ups enabled."));
}

void runCommand(char command) {
  switch (command) {
    case '1': testSerial(); break;
    case '2': testReader(); break;
    case '3': testMotor(); break;
    case '4': testSolenoid(); break;
    case '5': testComparator(); break;
    case '6': testBackEmf(); break;
    case '7': testGuards(); break;
    case 's':
    case 'S':
      allOff();
      Serial.println(F("[s] Relay and solenoid are OFF."));
      break;
    case 'r':
    case 'R':
      printSummary();
      break;
    case '?':
      printMenu();
      break;
    default:
      if (command == '\r' || command == '\n' || command == ' ') {
        return;
      }
      Serial.print(F("Unknown command: "));
      Serial.println(command);
      printMenu();
      break;
  }
}

// --------------------------------------------------------------------------
// Setup and loop
// --------------------------------------------------------------------------
void setup() {
  // Safe levels into the port latch before the pins become outputs.
  digitalWrite(PIN_RELAY, relayOffLevel());
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_SOLENOID, solenoidOffLevel());
  pinMode(PIN_SOLENOID, OUTPUT);

  pinMode(PIN_COMPARATOR, INPUT_PULLUP);
  pinMode(PIN_GUARD_A, INPUT_PULLUP);
  pinMode(PIN_GUARD_B, INPUT_PULLUP);
  pinMode(PIN_BACK_EMF, INPUT);

  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println(F("ProofLock component test bench"));
  Serial.println(F("Relay and solenoid are OFF at start-up."));

  SPI.begin();
  mfrc522.PCD_Init();
  delay(50);

  printMenu();
  printSummary();
}

void loop() {
  if (Serial.available()) {
    const char command = (char)Serial.read();
    if (command != '\r' && command != '\n') {
      setResult(0, PASSED);   // a command arriving proves the USB link
    }
    runCommand(command);
  }
}
