import math
import sqlite3
import time
from collections import deque

from .protocol import parse

STALE_AFTER = 3


class Monitor:
    def __init__(self, store):
        self.store = store
        self.source = 'live'
        self.storage_error = ''
        self.revision = 0
        self.reset()

    def reset(self):
        self.connected = False
        self.port = None
        self.baud = None
        self.since = None
        self.error = ''
        self.latest = None
        self.samples = deque(maxlen=3600)
        self.sequence = deque(maxlen=6)
        self.last_packet = self.last_telemetry = self.last_seq = None
        self.packet_clock = self.telemetry_clock = None
        self.session_clock = time.monotonic()
        self.meta = {}
        self.valid = self.invalid = self.missing = self.unknown = 0
        self.last_warning = ''
        self.warned_at = float('-inf')
        self.stale_logged = False
        self.revision += 1

    def save(self, method, *args):
        try:
            if not self.store:
                raise sqlite3.OperationalError()
            getattr(self.store, method)(*args)
        except sqlite3.Error:
            self.storage_error = 'Local logging unavailable. Records may not have been saved.'

    def event(self, category, code, severity='INFO', details='', origin='dashboard', seq=None, at=None):
        self.save('event', time.time() if at is None else at, self.source, origin, category, code,
                  severity, details, seq, self.latest)
        self.revision += 1

    def warning(self, message, at):
        self.last_warning = message
        if at - self.warned_at >= 5:
            self.event('protocol', 'PROTOCOL_WARNING', 'WARNING', message, at=at)
            self.warned_at = at

    def ingest(self, line, at=None):
        wall = time.time()
        at = wall if at is None else at
        received = time.monotonic() - max(0, wall - at)
        try:
            if line is None:
                raise ValueError('Oversized serial frame dropped')
            packet, warnings, unknown = parse(line)
        except ValueError as exc:
            self.invalid += 1
            self.warning(str(exc), at)
            return
        self.valid += 1
        self.unknown += unknown
        seq = packet['seq']
        if self.last_seq is not None:
            delta = (seq - self.last_seq) % 2**32
            if delta == 0:
                self.warning('Duplicate packet ignored', at)
                return
            if 1 < delta < 2**31:
                self.missing += delta - 1
                self.warning(f'{delta - 1} missing packet(s)', at)
            elif delta >= 2**31:
                self.warning('Sequence restarted or moved backwards', at)
                self.samples.append({'at': at, 'adc': None})
                self.sequence.clear()
                self.latest = None
                self.last_telemetry = self.telemetry_clock = None
        self.last_seq = seq
        self.last_packet = at
        self.packet_clock = received
        for key in ('device', 'firmware', 'uptime_ms', 'v'):
            if key in packet:
                self.meta[key] = packet[key]
        if warnings:
            self.warning('; '.join(warnings), at)
        kind = packet['type']
        if kind == 'rfid':
            ref = packet['operator_ref'] or 'Unknown operator'
            self.event('rfid', 'RFID_' + packet['result'], 'NOTICE' if packet['result'] == 'DENIED' else 'INFO',
                       ref, 'device', seq, at)
        elif kind in ('diagnostic', 'event'):
            unusual = packet['code'] in ('POSSIBLE_BYPASS_PATTERN', 'UNUSUAL_EVENT_TIMING')
            self.event(kind, 'UNUSUAL_EVENT_TIMING' if unusual else packet['code'],
                       'WARNING' if unusual else packet['severity'],
                       'Device-reported timing warning; not proof of bypass' if unusual else '', 'device', seq, at)
        elif kind == 'telemetry':
            old = self.latest
            if self.last_telemetry is not None and (received - self.telemetry_clock > STALE_AFTER or at < self.last_telemetry):
                self.samples.append({'at': (at + self.last_telemetry) / 2, 'adc': None})
            self.latest = {**packet, 'at': at}
            self.last_telemetry = at
            self.telemetry_clock = received
            if self.stale_logged:
                self.event('connection', 'TELEMETRY_RESUMED', at=at)
                self.stale_logged = False
            self.samples.append({'at': at, 'adc': packet['back_emf_adc']})
            self.save('sample', at, self.source, packet['back_emf_adc'], seq)
            for key in ('motor', 'standstill', 'lock', 'guard_a', 'guard_b'):
                if not old or old[key] != packet[key]:
                    self.event('state', f'{key.upper()}_{packet[key]}',
                               'WARNING' if 'FAULT' in packet[key] else 'INFO',
                               f'{old[key]} → {packet[key]}' if old else 'First reported state', 'device', seq, at)
                    if key == 'standstill':
                        self.sequence.appendleft({'state': packet[key], 'at': at})
            if self.mismatch(packet) and not self.mismatch(old):
                self.event('state', 'GUARD_CHANNEL_MISMATCH', 'WARNING', 'Guard inputs disagree', seq=seq, at=at)

    @staticmethod
    def mismatch(packet):
        return bool(packet and {packet['guard_a'], packet['guard_b']} == {'OPEN', 'CLOSED'})

    def status(self, now=None):
        packet, telemetry = (self.last_packet, self.last_telemetry) if now is not None else (self.packet_clock, self.telemetry_clock)
        now = time.monotonic() if now is None else now
        age = lambda stamp: None if stamp is None else max(0, now - stamp)
        telemetry_age = age(telemetry)
        fresh = self.connected and telemetry_age is not None and telemetry_age <= STALE_AFTER
        return dict(source=self.source, connected=self.connected, fresh=fresh, port=self.port, baud=self.baud,
                    since=self.since, error=self.error, packet_age=age(packet), telemetry_age=telemetry_age,
                    latest=self.latest, meta=self.meta, valid=self.valid, invalid=self.invalid, missing=self.missing,
                    unknown=self.unknown, last_warning=self.last_warning, mismatch=self.mismatch(self.latest),
                    sequence=list(self.sequence), revision=self.revision, storage_error=self.storage_error)

    def tick(self):
        if self.connected and not self.status()['fresh'] and not self.stale_logged:
            reference = self.telemetry_clock if self.telemetry_clock is not None else self.session_clock
            if time.monotonic() - reference > STALE_AFTER:
                self.stale_logged = True
                self.event('connection', 'TELEMETRY_STALE', 'WARNING', 'No fresh telemetry')


def demonstration(step):
    phase = step % 180
    motor, standstill = ('RUNNING', 'NOT_VERIFIED') if phase < 120 else (
        ('STOPPING', 'VERIFYING') if phase < 138 else ('STOPPED', 'VERIFIED'))
    adc = round(610 + 54 * math.sin(step*.21) + 22 * math.sin(step*1.71)) if phase < 120 else (
        round(610 * math.exp(-(phase-120)/5.3)) if phase < 138 else 4 + step % 4)
    guard = 'OPEN' if 145 <= phase < 165 else 'CLOSED'
    return dict(v=1, type='telemetry', seq=step*2, device='prooflock-uno-sim', firmware='demo-1.0',
                motor=motor, standstill=standstill, guard_a=guard, guard_b=guard,
                lock='RELEASED' if 143 <= phase < 170 else 'LOCKED', back_emf_adc=adc)
