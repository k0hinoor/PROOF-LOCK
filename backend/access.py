"""Local operator registry and access sessions.

RFID in ProofLock is an *access control* mechanism, not merely a log line: the
dashboard will not issue a motor command unless a known operator is signed in.

Design constraints:

* The browser never sees or sends a card UID. The board compares the UID with
  its own local table (see ``firmware/prooflock_uno``) and reports only
  ``ACCEPTED``/``DENIED`` plus a short ``OP-nn`` reference.
* An accepted card creates a short-lived session here. Motor commands are
  refused without one, even if the request is forged.
* Sessions expire so an unattended console locks itself again.
"""
import json
import os
import re
import time
from pathlib import Path

REFERENCE = re.compile(r'OP-[0-9]{1,6}')
# Name is a display label from a local file, never echoed into SQL or HTML.
NAME = re.compile(r'[^<>"\'\\\x00-\x1f]{1,60}')
DEFAULT_TTL = 15 * 60


def default_registry_path():
    root = Path(__file__).resolve().parents[1]
    return Path(os.getenv('PROOFLOCK_OPERATORS', root / 'config' / 'operators.json'))


class OperatorRegistry:
    """Reads ``ref`` -> display name from a local JSON file.

    The file is optional: with no registry every card is ``DENIED`` and the
    dashboard says so plainly instead of pretending authentication works.
    """

    def __init__(self, path=None):
        self.path = Path(path) if path is not None else default_registry_path()
        self.error = ''
        self.operators = {}
        self.loaded_at = 0
        self.reload()

    def ensure(self):
        """Create operators.json from the example if it is missing. Never overwrite."""
        if self.path.exists():
            self.reload()
            return False
        example = self.path.with_name('operators.example.json')
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            content = example.read_text(encoding='utf-8') if example.exists() else (
                '{\n  "operators": [\n'
                '    { "ref": "OP-01", "name": "Engineer A" },\n'
                '    { "ref": "OP-02", "name": "Engineer B" }\n'
                '  ]\n}\n')
            self.path.write_text(content, encoding='utf-8')
        except OSError as exc:
            self.error = f'Could not write {self.path} ({type(exc).__name__})'
            return False
        self.reload()
        return True

    def reload(self):
        self.loaded_at = time.time()
        self.error = ''
        self.operators = {}
        try:
            raw = json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            self.error = f'No operator registry at {self.path}'
            return
        except (OSError, ValueError) as exc:
            self.error = f'Operator registry unreadable ({type(exc).__name__})'
            return
        entries = raw.get('operators') if isinstance(raw, dict) else raw
        if not isinstance(entries, list):
            self.error = 'Operator registry must be a list of operators'
            return
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            ref, name = entry.get('ref'), entry.get('name')
            if not isinstance(ref, str) or not REFERENCE.fullmatch(ref):
                continue
            if not isinstance(name, str) or not NAME.fullmatch(name):
                continue
            self.operators[ref] = name

    def name_for(self, ref):
        return self.operators.get(ref)

    def public(self):
        """Only display data; never includes card identifiers."""
        return {
            'configured': bool(self.operators),
            'count': len(self.operators),
            'error': self.error,
            'operators': [{'ref': ref, 'name': name} for ref, name in sorted(self.operators.items())],
        }


class Access:
    """One authenticated console session."""

    def __init__(self, ref, name, at=None, ttl=DEFAULT_TTL):
        self.ref = ref
        self.name = name
        self.since = time.time() if at is None else at
        self.expires = self.since + ttl
        self.ttl = ttl

    def alive(self, now=None):
        return (time.time() if now is None else now) < self.expires

    def public(self, now=None):
        now = time.time() if now is None else now
        return {'operator': {'ref': self.ref, 'name': self.name}, 'since': self.since,
                'expires': self.expires, 'remaining': max(0, round(self.expires - now))}
