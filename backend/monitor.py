import math
import sqlite3
import time
from collections import deque

from .access import Access
from .protocol import parse

STALE_AFTER = 3


class Monitor:
    def __init__(self, store, registry=None):
        self.store = store
        self.registry = registry
        self.source = 'live'
        self.storage_error = ''
        self.revision = 0
        self.access = None
        self.last_unauthorised = ''
        self.last_command = None
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
        self.last_parse_error = ''
        self.rx_bytes = 0
        self.tx_commands = 0
        self.permits = 0
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

    # ------------------------------------------------------------------
    # Access sessions
    # ------------------------------------------------------------------
    def session(self, now=None):
        """The live session, or None once it has expired."""
        if self.access and not self.access.alive(now):
            self.access = None
        return self.access

    def sign_out(self, reason='operator signed out'):
        self.last_unauthorised = ''
        if self.access:
            ref, self.access = self.access.ref, None
            self.event('access', 'SESSION_ENDED', details=f'{ref} · {reason}')
            self.revision += 1

    def _rfid(self, packet, at):
        result, ref = packet['result'], packet['operator_ref']
        name = self.registry.name_for(ref) if (self.registry and ref) else None
        if result == 'ACCEPTED' and name:
            self.access = Access(ref, name, at)
            self.save('attendance_event', at, self.source, ref, name, 'ACCEPTED')
            self.event('access', 'ACCESS_GRANTED', details=f'{ref} · {name}', at=at)
            self.last_unauthorised = ''
        else:
            self.sign_out('card denied at the reader')
            why = ('card not registered' if result == 'ACCEPTED'
                   else 'reader not configured' if result == 'NOT_CONFIGURED'
                   else 'denied by reader')
            self.event('access', 'ACCESS_DENIED', 'WARNING',
                       f'{ref} · {why}' if ref else why, at=at)
            self.last_unauthorised = why
        self.revision += 1

    # ------------------------------------------------------------------
    # Control
    # ------------------------------------------------------------------
    def readiness(self, now=None):
        """Why MOTOR_ON is allowed or refused. Every check fails closed.

        Freshness is measured on monotonic clocks, so this deliberately calls
        ``status()`` without a wall-clock argument.
        """
        latest = self.latest
        if not self.connected or latest is None:
            return False, 'Machine feedback is not current'
        if not self.status()['fresh']:
            return False, 'Machine feedback is not current'
        if latest['motor'] == 'RUNNING':
            return False, 'Motor is already running'
        if latest['motor'] == 'STOPPING':
            return False, 'Motor is still stopping'
        if latest['motor'] == 'FAULT' or latest['standstill'] == 'SENSOR_FAULT':
            return False, 'Safety system fault'
        fitted = self.latest.get('guard_fitted')
        if fitted:
            if latest['guard_a'] != 'CLOSED' or latest['guard_b'] != 'CLOSED':
                return False, 'Both guard inputs must report CLOSED'
        elif fitted is not False:
            if latest['guard_a'] not in ('CLOSED',) or latest['guard_b'] not in ('CLOSED',):
                return False, 'Guard inputs are not reported'
        lock_fitted = self.latest.get('lock_fitted')
        if lock_fitted is not False:
            if latest['lock'] == 'RELEASED':
                return False, 'Guard lock is released'
            if latest['lock'] != 'LOCKED':
                return False, 'Guard lock is not confirmed'
        return True, 'All checks passed'

    def command(self, action, now=None, permit=False):
        """Validate one motor command. Returns (accepted, reason, payload).

        MOTOR_ON runs every safety gate. MOTOR_OFF only needs a signed-in
        operator and current feedback: stopping must stay available whenever
        the machine is actually running.

        ``permit`` refreshes the board's run permit for a motor that is already
        running. It is a keepalive, not an operator action: it is never saved
        as a command, never replaces the last operation and cannot start
        anything.
        """
        now = time.time() if now is None else now
        session = self.session(now)
        status = self.status(now)
        latest = status['latest']
        ok, why = False, 'Sign in with an RFID card first'
        if action not in ('MOTOR_ON', 'MOTOR_OFF') or (permit and action != 'MOTOR_ON'):
            ok, why = False, 'Unsupported action'
        elif session:
            if not status['fresh'] or not latest:
                ok, why = False, 'Machine feedback is not current'
            elif permit:
                ok, why = ((True, 'Run permit refreshed') if latest['motor'] == 'RUNNING'
                           else (False, 'Motor is not running'))
            elif action == 'MOTOR_ON':
                ok, why = self.readiness(now)
            elif latest['motor'] == 'STOPPING':
                ok, why = False, 'Motor is already stopping'
            elif latest['motor'] != 'RUNNING':
                ok, why = False, 'Motor is not running'
            else:
                ok, why = True, 'Stop requested'
        payload = {'action': action, 'accepted': ok, 'reason': why,
                   'operator': {'ref': session.ref, 'name': session.name} if session else None,
                   'at': now}
        if permit:
            if ok:
                self.permits += 1
            return ok, why, payload
        if ok:
            self.last_command = payload
            self.tx_commands += 1
            self.event('control', 'COMMAND_SENT', details=f'{action} · {session.ref}', at=now)
        else:
            self.event('control', 'COMMAND_REFUSED', 'WARNING', f'{action} · {why}', at=now)
        self.save('command', now, self.source, session.ref if session else '',
                  session.name if session else '', action, ok, why)
        self.revision += 1
        return ok, why, payload

    # ------------------------------------------------------------------
    # Ingest
    # ------------------------------------------------------------------
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
            self.last_parse_error = str(exc)
            self.warning(self.last_parse_error, at)
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
            self._rfid(packet, at)
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
        session = self.session()
        return dict(source=self.source, connected=self.connected, fresh=fresh, port=self.port, baud=self.baud,
                    since=self.since, error=self.error, packet_age=age(packet), telemetry_age=telemetry_age,
                    latest=self.latest, meta=self.meta,
                    guard_fitted=bool(self.latest.get('guard_fitted')) if self.latest else None,
                    lock_fitted=bool(self.latest.get('lock_fitted')) if self.latest else None, valid=self.valid, invalid=self.invalid, missing=self.missing,
                    unknown=self.unknown, rx_bytes=self.rx_bytes, last_parse_error=self.last_parse_error, last_warning=self.last_warning, mismatch=self.mismatch(self.latest),
                    sequence=list(self.sequence), revision=self.revision, storage_error=self.storage_error,
                    access=session.public() if session else None, last_unauthorised=self.last_unauthorised,
                    last_command=self.last_command, tx_commands=self.tx_commands,
                    operator=self.registry.public() if self.registry else {'configured': False, 'count': 0,
                                                                            'error': 'No registry', 'operators': []})

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
