"""The simulator must mirror the firmware's interlock sequence exactly."""
import json
import unittest

from backend.simulator import DemoMachine


def telemetry(frames):
    return [f for f in frames if f['type'] == 'telemetry'][0]


class SimulatorSequence(unittest.TestCase):
    def setUp(self):
        self.m = DemoMachine()

    def run_for(self, seconds, start=0.0, step=0.25):
        at = start
        end = start + seconds
        last = None
        while at < end:
            at += step
            last = telemetry(self.m.step(at, step))
        return at, last

    def test_start_locks_and_runs(self):
        ok, _ = self.m.command('MOTOR_ON', 0)
        self.assertTrue(ok)
        _, frame = self.run_for(1)
        self.assertEqual(frame['motor'], 'RUNNING')
        self.assertEqual(frame['lock'], 'LOCKED')
        self.assertEqual(frame['standstill'], 'NOT_VERIFIED')
        self.assertEqual({frame['guard_a'], frame['guard_b']}, {'CLOSED'})

    def test_guard_stays_locked_until_standstill_is_verified(self):
        self.m.command('MOTOR_ON', 0)
        at, _ = self.run_for(2)
        self.m.command('MOTOR_OFF', at)
        _, coasting = self.run_for(1, at)
        self.assertEqual(coasting['motor'], 'STOPPING')
        self.assertEqual(coasting['standstill'], 'VERIFYING')
        self.assertEqual(coasting['lock'], 'LOCKED')
        self.assertEqual(coasting['guard_a'], 'CLOSED')

        _, stopped = self.run_for(8, at)
        self.assertEqual(stopped['motor'], 'STOPPED')
        self.assertEqual(stopped['standstill'], 'VERIFIED')
        self.assertEqual(stopped['lock'], 'RELEASED')

    def test_no_start_while_the_guard_is_released(self):
        self.m.command('MOTOR_ON', 0)
        at, _ = self.run_for(2)
        self.m.command('MOTOR_OFF', at)
        at, released = self.run_for(8, at)
        self.assertEqual(released['lock'], 'RELEASED')
        ok, _ = self.m.command('MOTOR_ON', at)
        self.assertFalse(ok)
        self.assertEqual(self.m.lock, 'RELEASED')

    def test_guard_relatches_after_the_release_window(self):
        self.m.command('MOTOR_ON', 0)
        at, _ = self.run_for(2)
        self.m.command('MOTOR_OFF', at)
        at, relatched = self.run_for(20, at)
        self.assertEqual(relatched['motor'], 'STOPPED')
        self.assertEqual(relatched['lock'], 'LOCKED')
        self.assertEqual(relatched['guard_a'], 'CLOSED')
        ok, _ = self.m.command('MOTOR_ON', at)
        self.assertTrue(ok)


class SimulatorCommandFrame(unittest.TestCase):
    def test_outbound_command_frame_is_compact_json(self):
        from backend.protocol import command_line
        frame = command_line('MOTOR_OFF', 12)
        self.assertEqual(json.loads(frame), {'v': 1, 'type': 'command', 'seq': 12,
                                             'action': 'MOTOR_OFF'})
        self.assertTrue(frame.endswith(b'\n'))
        self.assertEqual(len(frame), len(frame.decode('utf-8').encode('utf-8')))


if __name__ == '__main__':
    unittest.main()
