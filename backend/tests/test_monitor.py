import json
import tempfile
import unittest
from pathlib import Path

from backend.main import csv_row, same_origin
from backend.monitor import Monitor
from backend.protocol import Framer, parse
from backend.storage import Store


def telemetry(**values):
    return json.dumps(dict(v=1, type='telemetry', seq=1, motor='RUNNING', guard_a='CLOSED',
                           guard_b='CLOSED', lock='LOCKED', standstill='NOT_VERIFIED',
                           back_emf_adc=0) | values).encode()


class ProtocolTests(unittest.TestCase):
    def test_framer_preserves_partials_and_drops_overflow(self):
        framer = Framer()
        self.assertEqual(list(framer.feed(b'{')), [])
        self.assertEqual(list(framer.feed(b'}\r\n' + b'x'*513 + b'\n{}\n')), [b'{}', None, b'{}'])

    def test_rejects_bad_packets(self):
        for frame in (b'[]', b'{', b'\xff', telemetry(v=True), telemetry(v=2), telemetry(seq=-1),
                      telemetry(back_emf_adc=True), telemetry(back_emf_adc=1024), telemetry(motor=None)):
            with self.subTest(frame=frame), self.assertRaises(ValueError):
                parse(frame)

    def test_unknown_values_are_not_guessed(self):
        packet, warnings, _ = parse(telemetry(standstill='probably', motor='ON'))
        self.assertEqual((packet['standstill'], packet['motor']), ('UNKNOWN', 'UNKNOWN'))
        self.assertEqual(len(warnings), 2)

    def test_identifier_is_not_retained(self):
        packet, _, _ = parse(b'{"v":1,"type":"rfid","seq":1,"result":"DENIED","operator_ref":"AABBCCDDEE","uid":"123456"}')
        self.assertIsNone(packet['operator_ref'])
        self.assertNotIn('uid', packet)

    def test_csv_and_origin(self):
        self.assertIn("'=SUM", csv_row(['=SUM(1)']))
        self.assertTrue(same_origin('http://127.0.0.1:8000', '127.0.0.1:8000'))
        self.assertFalse(same_origin('https://other.test', '127.0.0.1:8000'))


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'db.sqlite'
        self.store = Store(self.path)
        self.addCleanup(self.store.db.close)
        self.m = Monitor(self.store)

    def test_no_inference_from_zero_disconnect_or_heartbeat(self):
        self.assertFalse(self.m.status()['fresh'])
        self.m.connected = True
        self.m.ingest(telemetry(), 20)
        self.assertTrue(self.m.status(21)['fresh'])
        self.assertEqual(self.m.latest['standstill'], 'NOT_VERIFIED')
        self.m.ingest(b'{"v":1,"type":"heartbeat","seq":2}', 25)
        self.assertFalse(self.m.status(25)['fresh'])
        self.assertEqual(self.m.status(25)['packet_age'], 0)
        self.m.ingest(telemetry(seq=3, motor='STOPPED', standstill='VERIFIED'), 26)
        self.assertEqual(self.m.latest['standstill'], 'VERIFIED')
        self.assertIsNone(list(self.m.samples)[1]['adc'])
        self.m.connected = False
        self.assertFalse(self.m.status(26)['fresh'])
        self.m.reset()
        self.assertIsNone(self.m.latest)

    def test_mismatch_gap_and_no_event_flood(self):
        self.m.ingest(telemetry(seq=1, guard_b='OPEN'), 10)
        self.m.ingest(telemetry(seq=4, guard_b='OPEN'), 11)
        self.m.ingest(b'bad', 12)
        self.assertTrue(self.m.status()['mismatch'])
        self.assertEqual((self.m.missing, self.m.invalid), (2, 1))
        warnings = list(self.store.rows('events', 'live', category='state', severity='WARNING'))
        self.assertEqual([row['code'] for row in warnings], ['GUARD_CHANNEL_MISMATCH'])

    def test_history_survives_and_sources_are_isolated(self):
        self.m.ingest(telemetry(), 10)
        self.m.reset()
        self.m.source = 'simulator'
        self.m.ingest(telemetry(), 20)
        reopened = Store(self.path)
        self.addCleanup(reopened.db.close)
        self.assertEqual(list(reopened.rows('samples', 'live'))[0]['at'], 10)
        self.assertEqual(list(reopened.rows('samples', 'simulator'))[0]['at'], 20)
        self.assertEqual(len(list(reopened.rows('events', 'live', search='motor running'))), 1)
        reopened.prune(15)
        self.assertEqual(list(reopened.rows('samples', 'live')), [])

    def test_storage_failure_does_not_block_live_telemetry(self):
        m = Monitor(None)
        m.connected = True
        m.ingest(telemetry(), 10)
        self.assertTrue(m.status(10)['fresh'])
        self.assertTrue(m.storage_error)

    def test_monotonic_freshness_survives_wall_clock_jump(self):
        from unittest.mock import patch

        self.m.connected = True
        with patch('backend.monitor.time.time', return_value=100), patch('backend.monitor.time.monotonic', return_value=10):
            self.m.ingest(telemetry())
        with patch('backend.monitor.time.time', return_value=5), patch('backend.monitor.time.monotonic', return_value=14):
            self.m.tick()
            self.assertFalse(self.m.status()['fresh'])
            self.assertEqual(self.m.status()['telemetry_age'], 4)

    def test_locked_database_does_not_stall_or_hide_logging_failure(self):
        import time

        other = Store(self.path)
        self.addCleanup(other.db.close)
        other.db.execute('BEGIN IMMEDIATE')
        started = time.monotonic()
        self.m.ingest(telemetry())
        self.assertLess(time.monotonic() - started, .75)
        self.assertTrue(self.m.storage_error)
        self.assertIsNotNone(self.m.latest)

    def test_ambiguous_json_never_updates_telemetry(self):
        self.m.ingest(telemetry().replace(b'"RUNNING"', b'"RUNNING", "motor": "STOPPED"'))
        self.m.ingest(telemetry().replace(b'"back_emf_adc": 0', b'"back_emf_adc": NaN'))
        self.assertEqual(self.m.invalid, 2)
        self.assertIsNone(self.m.latest)
