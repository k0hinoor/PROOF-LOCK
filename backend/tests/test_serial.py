"""Run the production serial reader against an OS pseudo-terminal on POSIX."""
import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

from backend.main import Connect, Runtime
from backend.tests.test_monitor import telemetry


@unittest.skipUnless(os.name == 'posix', 'Pseudo-terminal test requires POSIX')
class SerialTests(unittest.IsolatedAsyncioTestCase):
    async def wait_for(self, predicate):
        async with asyncio.timeout(5):
            while not predicate():
                await asyncio.sleep(.025)

    async def test_read_unplug_and_reconnect(self):
        import pty

        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'PROOFLOCK_DB': tmp+'/db.sqlite'}):
            master, slave = pty.openpty()
            alias = tmp+'/serial'
            os.symlink(os.ttyname(slave), alias)
            runtime = Runtime()
            config = Connect(port=alias, baud=115200, timeout=.05)
            runtime.task = asyncio.create_task(runtime.serial_reader(config))
            try:
                await self.wait_for(lambda: runtime.monitor.connected)
                os.write(master, b'broken\n'+telemetry()+b'\n')
                await self.wait_for(lambda: runtime.monitor.status()['fresh'])
                self.assertEqual(runtime.monitor.invalid, 1)
                self.assertEqual(runtime.monitor.status()["last_parse_error"], "Invalid JSON frame")
                os.close(master)
                master = None
                await self.wait_for(lambda: not runtime.monitor.connected)
                self.assertFalse(runtime.monitor.status()['fresh'])
                os.close(slave)
                slave = None
                master, slave = pty.openpty()
                os.unlink(alias)
                os.symlink(os.ttyname(slave), alias)
                await self.wait_for(lambda: runtime.monitor.connected)
                self.assertEqual(runtime.monitor.status()['latest'], None)
                os.write(master, telemetry(seq=0)+b'\r\n')
                await self.wait_for(lambda: runtime.monitor.status()['fresh'])
            finally:
                await runtime.halt()
                runtime.monitor.store.db.close()
                for fd in (master, slave):
                    if fd is not None:
                        os.close(fd)

    async def test_burst_corruption_fragmentation_and_idle_latency(self):
        import pty
        import time

        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'PROOFLOCK_DB': tmp+'/db.sqlite'}):
            master, slave = pty.openpty()
            runtime = Runtime()
            m = runtime.monitor
            runtime.task = asyncio.create_task(runtime.serial_reader(Connect(
                port=os.ttyname(slave), baud=115200, timeout=1, reconnect=False)))
            try:
                await self.wait_for(lambda: m.connected)
                frame = telemetry(seq=0, standstill='VERIFYING')
                os.write(master, frame[:30])
                await asyncio.sleep(.06)
                self.assertIsNone(m.latest)
                self.assertEqual(m.status()["rx_bytes"], 30)
                started = time.monotonic()
                os.write(master, frame[30:]+b'\r\n')
                await self.wait_for(lambda: m.latest is not None)
                elapsed = time.monotonic() - started
                self.assertLess(elapsed, .5, 'A short frame should not wait for the 1 s read timeout')
                print(f'\nShort PTY frame ingestion: {elapsed*1000:.0f} ms (includes test polling)')
                burst = bytearray()
                for seq in range(1, 1001):
                    if seq % 25 == 0:
                        burst.extend(b'{' + b'x'*2048 + b'\n')
                        burst.extend(b'bad utf8 \xff\n')
                    burst.extend(telemetry(seq=seq)+b'\n')
                def send_burst():
                    view = memoryview(burst)
                    while view:
                        view = view[os.write(master, view[:1024]):]
                await asyncio.wait_for(asyncio.to_thread(send_burst), timeout=8)
                await self.wait_for(lambda: m.latest['seq'] == 1000)
                self.assertEqual((m.valid, m.invalid, m.missing), (1001, 80, 0))
                self.assertEqual(len(list(m.store.rows('samples', 'live', limit=None))), 1001)
                os.write(master, b'{"v":1,"type":"heartbeat","seq":1001}\n')
                await self.wait_for(lambda: m.last_seq == 1001)
                await self.wait_for(lambda: not m.status()['fresh'])
                self.assertTrue(m.connected)
                os.write(master, telemetry(seq=1002, motor='STOPPED', standstill='VERIFIED')+b'\n')
                await self.wait_for(lambda: m.status()['fresh'])
                self.assertEqual(m.latest['standstill'], 'VERIFIED')
            finally:
                await runtime.halt()
                m.store.db.close()
                os.close(master)
                os.close(slave)

    async def test_commands_reach_the_wire_as_v1_frames(self):
        """MOTOR_ON / keepalive / MOTOR_OFF are the only bytes written."""
        import json
        import pty
        from backend.protocol import Framer

        def rfid(seq=1):
            return json.dumps({'v': 1, 'type': 'rfid', 'seq': seq,
                               'result': 'ACCEPTED', 'operator_ref': 'OP-01'}).encode()

        with tempfile.TemporaryDirectory() as tmp:
            registry = tmp + '/operators.json'
            with open(registry, 'w', encoding='utf-8') as fh:
                json.dump({'operators': [{'ref': 'OP-01', 'name': 'Engineer A'}]}, fh)
            self._environ = patch.dict(os.environ, {'PROOFLOCK_DB': tmp+'/db.sqlite',
                                                    'PROOFLOCK_OPERATORS': registry})
            self._environ.start()
            self.addCleanup(self._environ.stop)
            master, slave = pty.openpty()
            os.set_blocking(master, False)
            runtime = Runtime()
            m = runtime.monitor
            runtime.task = asyncio.create_task(runtime.serial_reader(Connect(
                port=os.ttyname(slave), baud=115200, timeout=.05, reconnect=False)))
            framer = Framer()

            def read_written():
                out = []
                while True:
                    try:
                        chunk = os.read(master, 4096)
                    except (BlockingIOError, OSError):
                        return out
                    if not chunk:
                        return out
                    out.extend(framer.feed(chunk))
            try:
                await self.wait_for(lambda: m.connected)
                # One scan opens the session every command is checked against.
                m.ingest(rfid(), at=__import__('time').time())
                m.ingest(telemetry(seq=0, motor='STOPPED', standstill='VERIFIED'),
                         at=__import__('time').time())
                await self.wait_for(lambda: m.status()['fresh'])
                payload = await runtime.command('MOTOR_ON')
                self.assertTrue(payload['accepted'], payload['reason'])
                self.assertTrue(payload['delivered'])
                # The inbound parser is receive-only, so decode the frames the
                # wire actually carried instead of feeding them back in.
                frames = [json.loads(frame) for frame in read_written()]
                self.assertEqual([f['type'] for f in frames], ['command'])
                self.assertEqual(frames[0]['action'], 'MOTOR_ON')


                # The board reports the motor running; keepalives go out and
                # leave no command history behind.
                m.ingest(telemetry(seq=1, motor='RUNNING', standstill='NOT_VERIFIED'),
                         at=__import__('time').time())
                before = len(list(m.store.rows('commands', 'live')))
                permit = await runtime.command('MOTOR_ON', permit=True)
                self.assertTrue(permit['delivered'])
                self.assertEqual([json.loads(f)['action'] for f in read_written()], ['MOTOR_ON'])
                self.assertEqual(len(list(m.store.rows('commands', 'live'))), before)

                payload = await runtime.command('MOTOR_OFF')
                self.assertTrue(payload['accepted'], payload['reason'])
                self.assertEqual([json.loads(f)['action'] for f in read_written()], ['MOTOR_OFF'])
            finally:
                await runtime.halt()
                m.store.db.close()
                os.close(master)
                os.close(slave)
