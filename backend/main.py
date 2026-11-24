"""Local, same-origin control API for the bench. Run with one Uvicorn worker."""
import asyncio
import csv
import io
import json
import os
import sqlite3
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import serial
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from serial.tools.list_ports import comports

from .access import OperatorRegistry
from .monitor import Monitor
from .protocol import Framer, command_line
from .simulator import DemoMachine
from .storage import Store

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = os.getenv('PROOFLOCK_PREVIEW') == '1'
# In preview the runtime always drives the simulator and no serial port can be
# opened, so these calls cannot reach hardware. Everything else stays blocked.
PREVIEW_WRITES = ('/api/access/simulate', '/api/access/logout', '/api/access/expire',
                  '/api/control')


def read_available(device):
    """Wait for one byte when idle, never for a full fixed-size frame."""
    return device.read(max(1, min(device.in_waiting, 1024)))


class Runtime:
    def __init__(self):
        try:
            store = Store(os.getenv('PROOFLOCK_DB', ROOT / 'data' / 'prooflock.sqlite3'))
        except (OSError, sqlite3.Error):
            store = None
        self.registry = OperatorRegistry()
        self.monitor = Monitor(store, self.registry)
        if not store:
            self.monitor.storage_error = 'Local database could not be opened.'
        self.task = None
        self.stop = asyncio.Event()
        self.lock = asyncio.Lock()
        self.device = None          # open pyserial handle while live
        self.writer = None          # serialises writes to that handle
        self.command_seq = 0
        self.demo = None            # DemoMachine while the simulator runs

    async def halt(self):
        if self.task:
            self.stop.set()
            await self.task
            self.task = None
        self.device = self.writer = None
        if self.monitor.connected:
            self.monitor.event('connection', 'MONITOR_DISCONNECTED')
        self.monitor.connected = False
        self.monitor.since = None
        self.monitor.error = ''
        self.monitor.access = None

    # -- simulator -----------------------------------------------------
    def start_demo(self):
        m = self.monitor
        m.reset()
        m.source, m.connected, m.since = 'simulator', True, time.time()
        self.demo = DemoMachine()
        now = time.time()
        # Warm a short trail so the console does not open empty.
        for offset in range(90, 0, -1):
            self.demo_at(now - offset)
        m.event('connection', 'SIMULATOR_STARTED')
        self.stop = asyncio.Event()
        self.task = asyncio.create_task(self.simulate())

    def demo_at(self, at):
        if not self.demo:
            return
        for frame in self.demo.step(at, .25):
            self.monitor.ingest(json.dumps(frame).encode(), at)

    async def simulate(self):
        while not self.stop.is_set():
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=.25)
            except TimeoutError:
                self.demo_at(time.time())

    async def command(self, action, permit=False):
        """Validate, then deliver to the simulator or the serial port."""
        m = self.monitor
        ok, _, payload = m.command(action, permit=permit)
        if permit:
            # A keepalive carries no history and cannot start anything. It only
            # refreshes the run permit the board expects while already running.
            # The simulator has no permit to refresh, so nothing is written.
            if ok and m.source != 'simulator':
                await self.deliver(payload)
            return payload
        if not ok:
            return payload
        if m.source == 'simulator' and self.demo:
            applied, message = self.demo.command(action, payload['at'])
            payload['delivered'] = applied
            payload['reason'] = message if applied else message
            if applied:
                self.demo_at(time.time())
        else:
            await self.deliver(payload)
        m.last_command = payload
        return payload

    async def deliver(self, payload):
        """Write one command frame to the open serial port, if any."""
        m = self.monitor
        if self.device and self.writer:
            self.command_seq += 1
            frame = command_line(payload['action'], self.command_seq % 2**32)
            try:
                async with self.writer:
                    await asyncio.to_thread(self.device.write, frame)
                payload['delivered'] = True
            except (serial.SerialException, OSError) as exc:
                payload['delivered'] = False
                payload['reason'] = f'Could not write to the serial port ({type(exc).__name__})'
                m.event('control', 'COMMAND_FAILED', 'ERROR', payload['reason'])
        else:
            payload['delivered'] = False
            payload['reason'] = 'No serial link is open'
        return payload

    # -- serial --------------------------------------------------------
    async def serial_reader(self, config):
        m = self.monitor
        while not self.stop.is_set():
            device = None
            try:
                device = await asyncio.to_thread(serial.Serial, config.port, config.baud, timeout=config.timeout)
                m.reset()
                m.port, m.baud, m.connected, m.since = config.port, config.baud, True, time.time()
                m.event('connection', 'SERIAL_OPENED', details=f'{config.port} · {config.baud} baud')
                self.device = device
                self.writer = asyncio.Lock()
                framer = Framer()
                while not self.stop.is_set():
                    chunk = await asyncio.to_thread(read_available, device)
                    if self.stop.is_set():
                        break
                    m.rx_bytes += len(chunk)
                    for line in framer.feed(chunk):
                        m.ingest(line)
            except (serial.SerialException, OSError, ValueError) as exc:
                m.connected = False
                m.since = None
                error = ('Port is in use. Close the Arduino Serial Monitor (or any other app) '
                         'and try again.' if 'Permission' in type(exc).__name__ or 'Access' in str(exc)
                         else f'Could not open {config.port} ({type(exc).__name__}). '
                              'Check the USB cable, the driver (CH340) and the selected port.')
                if config.reconnect:
                    error += ' Retrying every 2 seconds.'
                if m.error != error:
                    m.error = error
                    m.event('connection', 'SERIAL_UNAVAILABLE', 'WARNING', error)
            finally:
                self.device = self.writer = None
                if device is not None:
                    with suppress(OSError, serial.SerialException):
                        await asyncio.to_thread(device.close)
            if not config.reconnect:
                break
            with suppress(TimeoutError):
                await asyncio.wait_for(self.stop.wait(), timeout=2)



@asynccontextmanager
async def lifespan(app):
    runtime = app.state.runtime = Runtime()
    if PREVIEW:
        runtime.start_demo()
    async def tick():
        while True:
            runtime.monitor.tick()
            await asyncio.sleep(.5)
    ticker = asyncio.create_task(tick())
    try:
        yield
    finally:
        await runtime.halt()
        ticker.cancel()
        with suppress(asyncio.CancelledError):
            await ticker
        if runtime.monitor.store:
            runtime.monitor.store.db.close()


app = FastAPI(title='ProofLock', version='2.0.0', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def same_origin(origin, host):
    try:
        parsed = urlsplit(origin)
        return parsed.scheme in ('http', 'https') and parsed.netloc == host
    except ValueError:
        return False


def loopback(request):
    return request.url.hostname in ('localhost', '127.0.0.1', '::1') or request.url.hostname is None


@app.middleware('http')
async def local_boundary(request, call_next):
    if not PREVIEW and not loopback(request):
        return JSONResponse({'detail': 'Local dashboard only'}, 403)
    if request.method not in ('GET', 'HEAD') and not same_origin(
            request.headers.get('origin', ''), request.headers.get('host')):
        return JSONResponse({'detail': 'Same-origin request required'}, 403)
    if PREVIEW and request.method not in ('GET', 'HEAD') and request.url.path.startswith('/api/operators'):
        return JSONResponse({'detail': 'Preview keeps a fixed operator list'}, 403)
    if PREVIEW and request.method not in ('GET', 'HEAD') and request.url.path not in PREVIEW_WRITES:
        return JSONResponse({'detail': 'Preview only accepts simulator input'}, 403)
    # The browser is the only client this service has. Requiring the JSON
    # content type on writes blocks simple cross-site form posts.
    if request.method == 'POST' and request.url.path.startswith('/api/'):
        if not request.headers.get('content-type', '').startswith('application/json'):
            return JSONResponse({'detail': 'JSON content type required'}, 415)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') else 'no-cache'
    return response


class Connect(BaseModel):
    port: str = Field(min_length=1, max_length=256)
    baud: int = Field(ge=300, le=1000000)
    timeout: float = Field(default=.25, ge=.05, le=1)
    reconnect: bool = True


class Mode(BaseModel):
    enabled: bool


class Cleanup(BaseModel):
    days: int = Field(ge=1, le=3650)


class Command(BaseModel):
    action: str
    permit: bool = False


class SimulatedCard(BaseModel):
    ref: str = Field(min_length=3, max_length=9)


def monitor():
    return app.state.runtime.monitor


def status():
    return {**monitor().status(), 'preview': PREVIEW}


@app.get('/api/health')
async def health():
    return {'status': 'available', 'preview': PREVIEW}


@app.get('/api/ports')
async def ports():
    return [] if PREVIEW else [{'port': p.device, 'description': p.description} for p in await asyncio.to_thread(comports)]


@app.get('/api/operators')
async def operators():
    """Display names only. Card identifiers never reach the browser."""
    return monitor().registry.public()


@app.post('/api/operators/reload')
async def reload_operators():
    monitor().registry.reload()
    monitor().revision += 1
    return monitor().registry.public()


@app.post('/api/operators/create')
async def create_operators():
    """Seed config/operators.json from the example, never overwriting one."""
    registry = monitor().registry
    if registry.path.exists():
        raise HTTPException(409, 'config/operators.json already exists')
    example = registry.path.with_name('operators.example.json')
    try:
        registry.path.parent.mkdir(parents=True, exist_ok=True)
        content = example.read_text(encoding='utf-8') if example.exists() else (
            '{\n  "operators": [\n'
            '    { "ref": "OP-01", "name": "Engineer A" },\n'
            '    { "ref": "OP-02", "name": "Engineer B" }\n'
            '  ]\n}\n')
        registry.path.write_text(content, encoding='utf-8')
    except OSError as exc:
        raise HTTPException(503, 'Could not write config/operators.json') from exc
    registry.reload()
    monitor().revision += 1
    return registry.public()


@app.post('/api/access/logout')
async def logout():
    monitor().sign_out('operator signed out')
    return status()


@app.post('/api/access/expire')
async def expire():
    """Lock the console without touching the machine (session lock)."""
    monitor().sign_out('console locked')
    return status()


@app.post('/api/access/simulate')
async def simulate_card(card: SimulatedCard):
    """Present a card at the *simulator* reader. Refused on live hardware."""
    runtime = app.state.runtime
    if runtime.monitor.source != 'simulator' or not runtime.demo:
        raise HTTPException(409, 'Card simulation is only available while the simulator runs')
    runtime.demo.present_card(card.ref)
    return {'status': 'presented'}


@app.post('/api/control')
async def control(command: Command):
    if command.action not in ('MOTOR_ON', 'MOTOR_OFF'):
        raise HTTPException(400, 'Unsupported command')
    payload = await app.state.runtime.command(command.action, command.permit)
    return {**payload, 'status': status()}


@app.post('/api/device/connect')
async def connect(config: Connect):
    runtime = app.state.runtime
    async with runtime.lock:
        if config.port not in {p['port'] for p in await ports()}:
            raise HTTPException(400, 'Select an available serial port')
        await runtime.halt()
        m = monitor()
        m.reset()
        m.source, m.port, m.baud, m.error = 'live', config.port, config.baud, 'Opening serial port…'
        runtime.stop = asyncio.Event()
        runtime.task = asyncio.create_task(runtime.serial_reader(config))
    # Try the port before answering, so the gate can say *why* it failed
    # instead of silently staying disconnected.
    await asyncio.sleep(0)
    if m.connected:
        return status()
    for _ in range(40):
        if m.connected or m.error != 'Opening serial port…':
            break
        await asyncio.sleep(.1)
    return status()


@app.post('/api/device/disconnect')
async def disconnect():
    runtime = app.state.runtime
    async with runtime.lock:
        await runtime.halt()
        if monitor().source == 'simulator':
            monitor().reset()
            monitor().source = 'live'
    return status()


@app.post('/api/simulator')
async def simulator(mode: Mode):
    runtime = app.state.runtime
    async with runtime.lock:
        await runtime.halt()
        if mode.enabled:
            runtime.start_demo()
        else:
            monitor().reset()
            monitor().source = 'live'
    return status()


@app.get('/api/device/status')
@app.get('/api/telemetry/latest')
async def snapshot():
    samples = monitor().samples
    cutoff = samples[-1]['at'] - 300 if samples else 0
    return {**status(), 'samples': [row for row in samples if row['at'] >= cutoff]}


@app.websocket('/ws/live')
async def live(ws: WebSocket):
    if not same_origin(ws.headers.get('origin', ''), ws.headers.get('host')) or (
            not PREVIEW and ws.url.hostname not in ('127.0.0.1', 'localhost', '::1')):
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        previous = None
        last_send = 0
        while True:
            m = monitor()
            summary = m.status()
            signature = (m.revision, m.valid, m.invalid, m.rx_bytes, m.connected, m.error,
                         m.storage_error, summary['fresh'],
                         *(int(summary[k]) if summary[k] is not None else None
                           for k in ('packet_age', 'telemetry_age')))
            if signature != previous or time.monotonic() - last_send >= 1:
                await ws.send_json(await snapshot())
                previous = signature
                last_send = time.monotonic()
            try:
                if (await asyncio.wait_for(ws.receive(), timeout=.15))['type'] == 'websocket.disconnect':
                    return
            except TimeoutError:
                pass
    except (WebSocketDisconnect, RuntimeError, OSError):
        return


def database():
    if not monitor().store:
        raise HTTPException(503, 'Local database unavailable')
    return monitor().store


def check_source(source):
    if source not in ('live', 'simulator') or (PREVIEW and source != 'simulator'):
        raise HTTPException(400, 'Unavailable data source')


@app.get('/api/events')
async def events(source: str = 'live', since: float = Query(0, ge=0), category: str = '', severity: str = '',
                 search: str = Query('', max_length=100), offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
    check_source(source)
    try:
        data = list(database().rows('events', source, since, category, severity, search, limit+1, offset))
    except sqlite3.Error as exc:
        raise HTTPException(503, 'Could not read local history') from exc
    for event in data:
        event['snapshot'] = json.loads(event['snapshot'])
    return {'rows': data[:limit], 'more': len(data) > limit}


@app.get('/api/attendance')
async def attendance(source: str = 'live', since: float = Query(0, ge=0), search: str = Query('', max_length=100),
                     offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)):
    check_source(source)
    try:
        rows = list(database().rows('attendance', source, since, search=search, limit=limit+1, offset=offset))
    except sqlite3.Error as exc:
        raise HTTPException(503, 'Could not read attendance') from exc
    for row in rows:
        row['result'] = 'ACCEPTED' if row['result'] == 'ACCEPTED' else 'DENIED'
    return {'rows': rows[:limit], 'more': len(rows) > limit}


@app.get('/api/commands')
async def commands(source: str = 'live', since: float = Query(0, ge=0), offset: int = Query(0, ge=0),
                   limit: int = Query(25, ge=1, le=100)):
    check_source(source)
    try:
        rows = list(database().rows('commands', source, since, limit=limit+1, offset=offset))
    except sqlite3.Error as exc:
        raise HTTPException(503, 'Could not read command history') from exc
    return {'rows': rows[:limit], 'more': len(rows) > limit}


def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def csv_row(values):
    buf = io.StringIO(newline='')
    csv.writer(buf).writerow(["'" + val if isinstance(val, str) and val.lstrip().startswith(('=', '+', '-', '@')) else val for val in values])
    return buf.getvalue()


@app.get('/api/events/export')
@app.get('/api/telemetry/export')
@app.get('/api/attendance/export')
async def export(request: Request, source: str = 'live', since: float = Query(0, ge=0), category: str = '',
                 severity: str = '', search: str = Query('', max_length=100), until: float = Query(4102444800, ge=0)):
    check_source(source)
    db = database()
    path = request.url.path
    table = 'events' if 'events' in path else 'attendance' if 'attendance' in path else 'samples'
    fields = {'events': ['id', 'at', 'source', 'origin', 'category', 'code', 'severity', 'details', 'seq'],
              'attendance': ['id', 'at', 'source', 'operator_ref', 'operator_name', 'result'],
              'samples': ['id', 'at', 'source', 'adc', 'seq']}[table]
    options = dict(source=source, since=since, category=category, severity=severity, search=search, limit=None)
    async def stream():
        exported = utc(time.time())
        yield csv_row([('timestamp_utc' if field == 'at' else field) for field in fields] + ['exported_at_utc', 'filters'])
        filters = json.dumps({**options, 'until': until}, ensure_ascii=True)
        for index, row in enumerate(db.rows(table, **options)):
            if row['at'] > until:
                continue
            row['at'] = utc(row['at'])
            yield csv_row([row.get(field) for field in fields] + [exported, filters])
            if index % 100 == 0:
                await asyncio.sleep(0)
    return StreamingResponse(stream(), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="prooflock-{source}-{table}.csv"'})


@app.post('/api/data/prune')
async def prune(config: Cleanup):
    database().prune(time.time() - config.days * 86400)
    monitor().revision += 1
    return {'status': 'complete'}


if (ROOT / 'frontend' / 'dist').is_dir():
    app.mount('/', StaticFiles(directory=ROOT / 'frontend' / 'dist', html=True), name='dashboard')
