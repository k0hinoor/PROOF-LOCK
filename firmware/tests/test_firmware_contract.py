#!/usr/bin/env python3
"""Check that the docs' sample frames and pin table still match the sketch.

Runs on any machine with Python 3.11 and no third-party packages, so CI can
verify the firmware contract without an Arduino toolchain.
"""
import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.protocol import command_line, parse  # noqa: E402

SKETCH = ROOT / 'firmware' / 'prooflock_uno' / 'prooflock_uno.ino'
FIRMWARE_DOC = ROOT / 'firmware' / 'README.md'
PROTOCOL_DOC = ROOT / 'docs' / 'protocol.md'


class FirmwareContract(unittest.TestCase):
    @property
    def source(self):
        return SKETCH.read_text(encoding='utf-8')

    def test_sketch_uses_the_documented_link_settings(self):
        source = self.source
        self.assertIn('Serial.begin(BAUD_RATE)', source)
        self.assertIn('constexpr unsigned long BAUD_RATE = 115200;', source)
        # Both actions the dashboard can send are matched by the sketch.
        for action in ('MOTOR_ON', 'MOTOR_OFF'):
            self.assertIn(f'\\"action\\":\\"{action}\\"', source)

    def test_command_frames_match_what_the_sketch_matches(self):
        for action in ('MOTOR_ON', 'MOTOR_OFF'):
            frame = command_line(action, seq=7).decode('utf-8')
            self.assertTrue(frame.endswith('\n'))
            # The sketch matches these exact substrings, so the serialiser must
            # keep emitting compact JSON with no spaces.
            self.assertIn('"v":1', frame)
            self.assertIn('"type":"command"', frame)
            self.assertIn(f'"action":"{action}"', frame)
            # Inbound validation is receive-only: an outbound command frame is
            # never accepted back as telemetry.
            with self.assertRaises(ValueError):
                parse(frame.encode())

    def test_no_other_write_path_to_the_machine(self):
        source = self.source
        # Exactly one inbound channel, one relay-on call and one solenoid-on
        # call: everything else can only ever de-energise.
        self.assertEqual(source.count('Serial.available()'), 1)
        self.assertLessEqual(source.count('relayOn();'), 1)
        self.assertEqual(source.count('solenoidOn();'), 1)
        self.assertEqual(source.count('startRun(now);'), 1)   # only one caller

    def test_unknown_and_malformed_frames_are_ignored(self):
        source = self.source
        # The handler validates the version, the type and the action pair
        # before touching the relay, and drops oversized lines whole.
        self.assertIn('"\\"v\\":1"', source)
        self.assertIn('"\\"type\\":\\"command\\""', source)
        self.assertIn('if (start == stop)', source)
        self.assertIn('commandOverflow = true;', source)

    def test_optional_channels_are_not_invented(self):
        source = self.source
        self.assertIn('PIN_GUARD_A = -1', source)
        self.assertIn('PIN_GUARD_B = -1', source)
        self.assertIn('\\"lock\\":\\"UNKNOWN\\"', source)

    def test_uncalibrated_build_never_unlocks(self):
        source = self.source
        self.assertIn('constexpr bool STANDSTILL_CALIBRATED = false;', source)
        self.assertIn('sendEvent("CALIBRATION_REQUIRED", "WARNING");', source)

    def test_link_loss_and_timeout_stop_the_motor(self):
        source = self.source
        # A run permit expires, and a missing permit stops a running motor.
        self.assertIn('RUN_PERMIT_TIMEOUT_MS = 2500', source)
        self.assertIn('if (stopButtonPressed() || !linkAlive(now))', source)
        self.assertIn('raiseFault("STOP_TIMEOUT");', source)

    def test_baud_agrees_with_docs(self):
        for path in (FIRMWARE_DOC, PROTOCOL_DOC):
            text = path.read_text(encoding='utf-8')
            if '115200' not in text:
                self.fail(f'{path.name} never mentions the 115200 baud setting')

    def test_documented_frames_validate(self):
        text = FIRMWARE_DOC.read_text(encoding='utf-8')
        frames = re.findall(r'^\s*(\{"v":1,.*\})\s*$', text, re.MULTILINE)
        self.assertTrue(frames, 'no sample frame found in firmware/README.md')
        samples = [f for f in frames if '"type":"telemetry"' in f]
        commands = [f for f in frames if '"type":"command"' in f]
        self.assertTrue(samples, 'no telemetry sample in firmware/README.md')
        self.assertTrue(commands, 'no command sample in firmware/README.md')
        for frame in samples:
            packet, warnings, extra = parse(frame.encode())
            self.assertEqual(packet['type'], 'telemetry')
            self.assertEqual(warnings, [])
            self.assertEqual(extra, 0)
            self.assertLessEqual(len(frame.encode()), 512)
        for frame in commands:
            action = re.search(r'"action":"(MOTOR_ON|MOTOR_OFF)"', frame).group(1)
            seq = int(re.search(r'"seq":(\d+)', frame).group(1))
            # The documented command must be byte-identical to what the
            # dashboard actually transmits.
            self.assertEqual(frame + '\n', command_line(action, seq).decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
