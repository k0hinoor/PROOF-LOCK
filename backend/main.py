"""Local, same-origin monitoring API. Run with one Uvicorn worker."""
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

from .monitor import Monitor, demonstration
from .protocol import Framer
from .storage import Store

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = os.getenv('PROOFLOCK_PREVIEW') == '1'


class Runtime:
    def __init__(self):
        try:
            store = Store(os.getenv('PROOFLOCK_DB', ROOT / 'data' / 'prooflock.sqlite3'))
        except (OSError, sqlite3.Error):
            store = None
        self.monitor = Monitor(store)
        if not store:
            self.monitor.storage_error = 'Local database could not be opened.'
        self.task = None
        self.stop = asyncio.Event()
        self.lock = asyncio.Lock()

    async def halt(self):
        if self.task:
            self.stop.set()
            await self.task
            self.task = None
        if self.monitor.connected:
            self.monitor.event('connection', 'MONITOR_DISCONNECTED')
        self.monitor.connected = False
        self.monitor.since = None
        self.monitor.error = ''

    def start_demo(self):
        m = self.monitor
        m.reset()
        m.source, m.connected, m.since = 'simulator', True, time.time()
        start = m.since - 119
        m.event('connection', 'SIMULATOR_STARTED', at=start)
        for step in range(85, 205):
            self.demo_frame(step, start+step-85)
        self.stop = asyncio.Event()
        self.task = asyncio.create_task(self.demo(205))

    def demo_frame(self, step, at):
        m = self.monitor
        m.ingest(json.dumps(demonstration(step)).encode(), at)
        if step % 180 in (12, 47, 82):
            m.ingest(json.dumps(dict(v=1, type='rfid', seq=step*2+1,
                                     result='DENIED' if step % 180 == 47 else 'ACCEPTED', operator_ref='OP-02')).encode(), at)
        else:
            m.ingest(json.dumps(dict(v=1, type='heartbeat', seq=step*2+1)).encode(), at)

    async def demo(self, step):
        while not self.stop.is_set():
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=1)
            except TimeoutError:
                self.demo_frame(step, time.time())
                step += 1

    async def serial_reader(self, config):
        m = self.monitor
        while not self.stop.is_set():
            device = None
            try:
                device = await asyncio.to_thread(serial.Serial, config.port, config.baud, timeout=config.timeout)
                m.reset()
                m.port, m.baud, m.connected, m.since = config.port, config.baud, True, time.time()
                m.event('connection', 'SERIAL_OPENED', details=f'{config.port} · {config.baud} baud')
                framer = Framer()
                while not self.stop.is_set():
                    chunk = await asyncio.to_thread(device.read, 256)
                    for line in framer.feed(chunk):
                        m.ingest(line)
            except (serial.SerialException, OSError, ValueError) as exc:
                m.connected = False
                m.since = None
                error = f'Serial link unavailable ({type(exc).__name__}). Check USB and close other serial monitors.'
                if config.reconnect:
                    error += ' Retrying every 2 seconds.'
                if m.error != error:
                    m.error = error
                    m.event('connection', 'SERIAL_UNAVAILABLE', 'WARNING', error)
            finally:
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


app = FastAPI(title='ProofLock', version='1.0.0', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def same_origin(origin, host):
    try:
        parsed = urlsplit(origin)
        return parsed.scheme in ('http', 'https') and parsed.netloc == host
    except ValueError:
        return False


@app.middleware('http')
async def local_boundary(request, call_next):
    if not PREVIEW and request.url.hostname not in ('localhost', '127.0.0.1', '::1'):
        return JSONResponse({'detail': 'Local dashboard only'}, 403)
    if request.method not in ('GET', 'HEAD') and not same_origin(
            request.headers.get('origin', ''), request.headers.get('host')):
        return JSONResponse({'detail': 'Same-origin request required'}, 403)
    if PREVIEW and request.method not in ('GET', 'HEAD'):
        return JSONResponse({'detail': 'Preview is simulator-only and read-only'}, 403)
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
    return {**status(), 'samples': list(monitor().samples)}


@app.websocket('/ws/live')
async def live(ws: WebSocket):
    if not same_origin(ws.headers.get('origin', ''), ws.headers.get('host')) or (
            not PREVIEW and ws.url.hostname not in ('127.0.0.1', 'localhost', '::1')):
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        while True:
            await ws.send_json(await snapshot())
            try:
                if (await asyncio.wait_for(ws.receive(), timeout=.7))['type'] == 'websocket.disconnect':
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


def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def csv_row(values):
    buf = io.StringIO(newline='')
    csv.writer(buf).writerow(["'" + val if isinstance(val, str) and val.lstrip().startswith(('=', '+', '-', '@')) else val for val in values])
    return buf.getvalue()


@app.get('/api/events/export')
@app.get('/api/telemetry/export')
async def export(request: Request, source: str = 'live', since: float = Query(0, ge=0), category: str = '',
                 severity: str = '', search: str = Query('', max_length=100), until: float = Query(4102444800, ge=0)):
    check_source(source)
    db = database()
    table = 'events' if 'events' in request.url.path else 'samples'
    fields = ['id', 'at', 'source', 'origin', 'category', 'code', 'severity', 'details', 'seq'] if table == 'events' else ['id', 'at', 'source', 'adc', 'seq']
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
