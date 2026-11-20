"""Validate the receive-only v1 wire contract; never persist raw packets."""
import json
import re

MAX_LINE = 512
ENUMS = {
    'motor': 'RUNNING STOPPING STOPPED UNKNOWN FAULT',
    'guard_a': 'CLOSED OPEN FAULT UNKNOWN', 'guard_b': 'CLOSED OPEN FAULT UNKNOWN',
    'lock': 'LOCKED RELEASED FAULT UNKNOWN',
    'standstill': 'NOT_VERIFIED VERIFYING VERIFIED SENSOR_FAULT UNKNOWN',
    'result': 'ACCEPTED DENIED UNKNOWN NOT_CONFIGURED',
    'severity': 'INFO NOTICE WARNING ERROR',
}


def unique_object(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError('Duplicate JSON field')
    return obj


def reject_constant(value):
    raise ValueError('Non-JSON number')


def parse(line):
    if len(line) > MAX_LINE:
        raise ValueError('Frame exceeds 512 bytes')
    try:
        obj = json.loads(line.decode('utf-8'), object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, RecursionError) as exc:
        raise ValueError('Invalid JSON frame') from exc
    if not isinstance(obj, dict) or type(obj.get('v')) is not int or obj['v'] != 1:
        raise ValueError('Expected protocol v1')
    kind = obj.get('type')
    if kind not in ('telemetry', 'rfid', 'event', 'heartbeat', 'diagnostic'):
        raise ValueError('Unsupported message type')
    seq = obj.get('seq')
    if type(seq) is not int or not 0 <= seq <= 4294967295:
        raise ValueError('Expected uint32 sequence')
    packet = {'v': 1, 'type': kind, 'seq': seq}
    warnings = []
    fields = {'telemetry': ('motor', 'guard_a', 'guard_b', 'lock', 'standstill'),
              'rfid': ('result',), 'event': ('severity',), 'diagnostic': ('severity',)}.get(kind, ())
    for key in fields:
        value = obj.get(key, 'UNKNOWN' if key == 'lock' else None)
        if not isinstance(value, str):
            raise ValueError(f'Missing or invalid {key}')
        if value not in ENUMS[key].split():
            warnings.append(f'Unsupported {key} enum')
            value = 'WARNING' if key == 'severity' else 'UNKNOWN'
        packet[key] = value
    if kind == 'telemetry':
        adc = obj.get('back_emf_adc')
        if adc is not None and (type(adc) is not int or not 0 <= adc <= 1023):
            raise ValueError('Invalid ADC count')
        packet['back_emf_adc'] = adc
    if kind == 'rfid':
        ref = obj.get('operator_ref')
        packet['operator_ref'] = ref if isinstance(ref, str) and re.fullmatch(r'OP-[0-9]{1,6}', ref) else None
    if kind in ('diagnostic', 'event'):
        code = obj.get('code')
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z][A-Z_0-9]{0,47}', code):
            raise ValueError('Invalid event code')
        packet['code'] = code
    for key in ('device', 'firmware'):
        value = obj.get(key)
        if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,40}', value):
            packet[key] = value
    if type(obj.get('uptime_ms')) is int and 0 <= obj['uptime_ms'] <= 4294967295:
        packet['uptime_ms'] = obj['uptime_ms']
    return packet, warnings, len(set(obj) - set(packet))


class Framer:
    def __init__(self):
        self.buffer = bytearray()
        self.overflow = False

    def feed(self, chunk):
        for byte in chunk:
            if byte == 10:
                yield None if self.overflow else bytes(self.buffer).rstrip(b'\r')
                self.buffer.clear()
                self.overflow = False
            elif len(self.buffer) >= MAX_LINE:
                self.overflow = True
            elif not self.overflow:
                self.buffer.append(byte)
