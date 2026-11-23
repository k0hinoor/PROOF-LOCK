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

from backend.protocol import parse  # noqa: E402

SKETCH = ROOT / 'firmware' / 'prooflock_uno' / 'prooflock_uno.ino'
FIRMWARE_DOC = ROOT / 'firmware' / 'README.md'
PROTOCOL_DOC = ROOT / 'docs' / 'protocol.md'


class FirmwareContract(unittest.TestCase):
    def test_sketch_is_present_and_read_only(self):
        source = SKETCH.read_text(encoding='utf-8')
        self.assertIn('Serial.begin(BAUD_RATE)', source)
        self.assertIn('constexpr unsigned long BAUD_RATE = 115200;', source)
        # The dashboard must never be asked to act on the machine.
        for forbidden in ('Serial.read', 'Serial.available'):
            self.assertNotIn(forbidden, source)

    def test_optional_channels_are_not_invented(self):
        source = SKETCH.read_text(encoding='utf-8')
        self.assertIn('PIN_GUARD_A = -1', source)
        self.assertIn('PIN_GUARD_B = -1', source)
        self.assertIn('\\"lock\\":\\"UNKNOWN\\"', source)
        # The solenoid may only be pulsed through the verified stop path.
        self.assertEqual(source.count('solenoidOn();'), 1)

    def test_uncalibrated_build_never_unlocks(self):
        source = SKETCH.read_text(encoding='utf-8')
        self.assertIn('constexpr bool STANDSTILL_CALIBRATED = false;', source)
        self.assertIn('sendEvent("CALIBRATION_REQUIRED", "WARNING");', source)

    def test_baud_agrees_with_docs(self):
        for path in (FIRMWARE_DOC, PROTOCOL_DOC):
            text = path.read_text(encoding='utf-8')
            if '115200' not in text:
                self.fail(f'{path.name} never mentions the 115200 baud setting')

    def test_documented_telemetry_example_validates(self):
        text = FIRMWARE_DOC.read_text(encoding='utf-8')
        frames = re.findall(r'^\s*(\{"v":1,.*\})\s*$', text, re.MULTILINE)
        self.assertTrue(frames, 'no sample frame found in firmware/README.md')
        for frame in frames:
            packet, warnings, extra = parse(frame.encode())
            self.assertEqual(packet['type'], 'telemetry')
            self.assertEqual(warnings, [])
            self.assertEqual(extra, 0)
            self.assertLessEqual(len(frame.encode()), 512)


if __name__ == '__main__':
    unittest.main()
