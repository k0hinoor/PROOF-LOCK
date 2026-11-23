import json
import tempfile
import unittest
from pathlib import Path

from backend.access import Access, OperatorRegistry
from backend.monitor import Monitor
from backend.protocol import command_line, parse
from backend.storage import Store


def telemetry(**values):
    base = dict(v=1, type='telemetry', seq=1, motor='STOPPED', guard_a='CLOSED', guard_b='CLOSED',
                lock='LOCKED', standstill='VERIFIED', back_emf_adc=3, guard_fitted=True, lock_fitted=True)
    return json.dumps(base | values).encode()


def rfid(result='ACCEPTED', ref='OP-01', seq=2):
    return json.dumps(dict(v=1, type='rfid', seq=seq, result=result, operator_ref=ref)).encode()


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        registry = root/'operators.json'
        registry.write_text(json.dumps({'operators': [
            {'ref': 'OP-01', 'name': 'Engineer A'},
            {'ref': 'OP-02', 'name': 'Engineer B'},
        ]}), encoding='utf-8')
        self.store = Store(root/'db.sqlite')
        self.addCleanup(self.store.db.close)
        self.m = Monitor(self.store, OperatorRegistry(registry))
        self.m.connected = True

    def sign_in(self, ref='OP-01'):
        self.m.ingest(rfid(ref=ref))
        return self.m.access

    def test_registry_ignores_html_and_bad_refs(self):
        path = Path(self.temp.name)/'bad.json'
        path.write_text(json.dumps({'operators': [
            {'ref': 'OP-1', 'name': 'fine'},
            {'ref': 'CARD-1', 'name': 'wrong reference'},
            {'ref': 'OP-09', 'name': '<script>'},
        ]}), encoding='utf-8')
        registry = OperatorRegistry(path)
        self.assertEqual(registry.operators, {'OP-1': 'fine'})
        self.assertNotIn('<script>', json.dumps(registry.public()))

    def test_missing_registry_denies_every_card(self):
        m = Monitor(self.store, OperatorRegistry(Path(self.temp.name)/'missing.json'))
        m.connected = True
        m.ingest(rfid())
        self.assertIsNone(m.access)
        self.assertIn('card not registered', m.last_unauthorised)

    def test_command_requires_session(self):
        self.m.ingest(telemetry())
        ok, why, _ = self.m.command('MOTOR_ON')
        self.assertFalse(ok)
        self.assertIn('Sign in', why)

    def test_unknown_reference_denies_and_clears_session(self):
        self.sign_in()
        self.assertIsNotNone(self.m.access)
        self.m.ingest(rfid(ref='OP-99', seq=9))
        self.assertIsNone(self.m.access)
        codes = [e['code'] for e in self._events()]
        self.assertIn('ACCESS_DENIED', codes)
        self.assertIn('SESSION_ENDED', codes)

    def test_denied_card_ends_existing_session(self):
        self.sign_in()
        self.m.ingest(rfid(result='DENIED', seq=7))
        self.assertIsNone(self.m.access)

    def test_session_expires(self):
        access = self.sign_in()
        self.assertFalse(access.alive(access.expires + 1))
        self.m.latest = None
        self.assertIsNone(self.m.session(access.expires + 1))

    def test_start_blocked_by_open_guard_and_by_stale_feedback(self):
        self.sign_in()
        self.m.ingest(telemetry(guard_a='OPEN'))
        ok, why, _ = self.m.command('MOTOR_ON')
        self.assertFalse(ok)
        self.assertIn('guard', why.lower())
        self.m.ingest(telemetry(seq=5, guard_a='CLOSED', guard_b='CLOSED'))
        self.assertTrue(self.m.command('MOTOR_ON')[0])
        # Feedback ages out: the same command must now be refused.
        self.m.telemetry_clock -= 10
        ok, why, _ = self.m.command('MOTOR_ON')
        self.assertFalse(ok)
        self.assertIn('not current', why)

    def test_lock_released_and_faults_block_start(self):
        self.sign_in()
        self.m.ingest(telemetry(lock='RELEASED'))
        self.assertFalse(self.m.command('MOTOR_ON')[0])
        self.m.ingest(telemetry(seq=3, lock='LOCKED', motor='FAULT'))
        self.assertFalse(self.m.command('MOTOR_ON')[0])
        self.m.ingest(telemetry(seq=4, motor='STOPPED', standstill='SENSOR_FAULT'))
        self.assertFalse(self.m.command('MOTOR_ON')[0])

    def test_stop_allowed_while_running_and_refused_when_idle(self):
        self.sign_in()
        self.m.ingest(telemetry(motor='RUNNING', standstill='NOT_VERIFIED'))
        self.assertFalse(self.m.command('MOTOR_ON')[0])
        self.assertTrue(self.m.command('MOTOR_OFF')[0])
        self.m.ingest(telemetry(seq=8, motor='STOPPED'))
        ok, why, _ = self.m.command('MOTOR_OFF')
        self.assertFalse(ok)
        self.assertIn('not running', why)

    def test_run_permit_never_starts_and_leaves_no_history(self):
        self.sign_in()
        self.m.ingest(telemetry(lock='LOCKED', standstill='VERIFIED'))
        before = len(list(self.store.rows('commands', 'live')))
        # A keepalive cannot start a motor that is not running.
        ok, _, _ = self.m.command('MOTOR_ON', permit=True)
        self.assertFalse(ok)
        self.assertTrue(self.m.command('MOTOR_ON')[0])
        self.m.ingest(telemetry(seq=4, motor='RUNNING', standstill='NOT_VERIFIED'))
        before = len(list(self.store.rows('commands', 'live')))
        ok, why, payload = self.m.command('MOTOR_ON', permit=True)
        self.assertTrue(ok, why)
        self.assertEqual(payload['action'], 'MOTOR_ON')
        self.assertEqual(self.m.permits, 1)
        self.assertEqual(len(list(self.store.rows('commands', 'live'))), before)
        self.assertEqual(list(self.store.rows('attendance', 'live'))[0]['result'], 'ACCEPTED')
        # Only MOTOR_ON may be sent as a permit.
        self.assertFalse(self.m.command('MOTOR_OFF', permit=True)[0])

    def test_verified_standstill_alone_does_not_prove_release(self):
        self.sign_in()
        # Locked and closed: a verified standstill is simply the idle state.
        self.m.ingest(telemetry(lock='LOCKED', standstill='VERIFIED'))
        self.assertTrue(self.m.command('MOTOR_ON')[0])
        # Released lock with an open guard must refuse a start even though the
        # standstill is verified. Release is never inferred from the standstill.
        self.m.ingest(telemetry(seq=2, lock='RELEASED', standstill='VERIFIED', guard_a='OPEN',
                                guard_b='OPEN'))
        ok, why, _ = self.m.command('MOTOR_ON')
        self.assertFalse(ok)
        self.assertIn('guard', why.lower())

    def test_unfitted_guard_inputs_are_not_treated_as_safe(self):
        self.sign_in()
        self.m.ingest(telemetry(guard_a='UNKNOWN', guard_b='UNKNOWN', guard_fitted=None))
        self.assertFalse(self.m.command('MOTOR_ON')[0])
        # The shipped firmware reports CLOSED with guard_fitted=false. Start is
        # allowed, but the console must show that no interlock is fitted.
        self.m.ingest(telemetry(seq=3, guard_fitted=False, lock_fitted=False, lock='UNKNOWN'))
        self.assertTrue(self.m.command('MOTOR_ON')[0])
        self.assertFalse(self.m.status()['guard_fitted'])

    def test_commands_and_attendance_are_recorded(self):
        self.sign_in()
        self.m.ingest(telemetry())
        self.m.command('MOTOR_ON')
        attendance = list(self.store.rows('attendance', 'live'))
        commands = list(self.store.rows('commands', 'live'))
        self.assertEqual(attendance[0]['operator_ref'], 'OP-01')
        self.assertEqual(attendance[0]['result'], 'ACCEPTED')
        self.assertEqual(commands[0]['action'], 'MOTOR_ON')
        self.assertEqual(commands[0]['accepted'], 1)

    def test_denied_presentation_is_not_attendance(self):
        self.m.ingest(rfid(result='DENIED'))
        self.assertEqual(list(self.store.rows('attendance', 'live')), [])

    def test_signal_registry_has_no_card_identifiers(self):
        public = self.m.registry.public()
        text = json.dumps(public)
        self.assertNotIn('uid', text.lower())
        self.assertIn('Engineer A', text)

    def test_outbound_command_frame_is_whitelisted(self):
        frame = command_line('MOTOR_ON', 3)
        self.assertEqual(json.loads(frame), {'v': 1, 'type': 'command', 'seq': 3, 'action': 'MOTOR_ON'})
        self.assertTrue(frame.endswith(b'\n'))
        for bad in ('RELAY_OFF', 'LOCK_RELEASE', 'motor_on', ''):
            with self.subTest(action=bad), self.assertRaises(ValueError):
                command_line(bad, 1)
        # The inbound validator stays receive-only: a command frame cannot be
        # mistaken for telemetry.
        with self.assertRaises(ValueError):
            parse(frame[:-1])

    def _events(self):
        rows = list(self.store.rows('events', 'live'))
        return rows


class AccessRecordTests(unittest.TestCase):
    def test_access_public_shape(self):
        access = Access('OP-02', 'Engineer B', at=1000)
        public = access.public(1010)
        self.assertEqual(public['operator'], {'ref': 'OP-02', 'name': 'Engineer B'})
        self.assertEqual(public['remaining'], 890)


if __name__ == '__main__':
    unittest.main()
