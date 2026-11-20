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
