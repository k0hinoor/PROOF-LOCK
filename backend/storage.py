import json
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=.02)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, at REAL, source TEXT, origin TEXT, category TEXT,
                code TEXT, severity TEXT, details TEXT, seq INTEGER, snapshot TEXT);
            CREATE TABLE IF NOT EXISTS samples (
                id INTEGER PRIMARY KEY, at REAL, source TEXT, adc INTEGER, seq INTEGER);
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY, at REAL, source TEXT, operator_ref TEXT,
                operator_name TEXT, result TEXT);
            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY, at REAL, source TEXT, operator_ref TEXT,
                operator_name TEXT, action TEXT, accepted INTEGER, reason TEXT);
            CREATE INDEX IF NOT EXISTS event_lookup ON events(source, at DESC);
            CREATE INDEX IF NOT EXISTS sample_lookup ON samples(source, at DESC);
            CREATE INDEX IF NOT EXISTS attendance_lookup ON attendance(source, at DESC);
            CREATE INDEX IF NOT EXISTS command_lookup ON commands(source, at DESC);
        ''')

    def event(self, at, source, origin, category, code, severity, details, seq, snapshot):
        with self.db:
            self.db.execute('INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?,?,?)',
                            (at, source, origin, category, code, severity, details, seq, json.dumps(snapshot)))

    def sample(self, at, source, adc, seq):
        with self.db:
            self.db.execute('INSERT INTO samples VALUES(NULL,?,?,?,?)', (at, source, adc, seq))

    def attendance_event(self, at, source, operator_ref, operator_name, result):
        with self.db:
            self.db.execute('INSERT INTO attendance VALUES(NULL,?,?,?,?,?)',
                            (at, source, operator_ref, operator_name, result))

    def command(self, at, source, operator_ref, operator_name, action, accepted, reason):
        with self.db:
            self.db.execute('INSERT INTO commands VALUES(NULL,?,?,?,?,?,?,?)',
                            (at, source, operator_ref, operator_name, action, int(accepted), reason))

    def rows(self, table, source, since=0, category='', severity='', search='', limit=100, offset=0, until=None):
        assert table in ('events', 'samples', 'attendance', 'commands')
        filters = ['source=?', 'at>=?']
        args = [source, since]
        if until is not None:
            filters.append('at<=?')
            args.append(until)
        if table == 'events':
            for key, value in [('category', category), ('severity', severity)]:
                if value:
                    filters.append(f'{key}=?')
                    args.append(value)
            if search:
                filters.append("instr(lower(replace(code,'_',' ') || ' ' || details), lower(?)) > 0")
                args.append(search)
        elif table in ('attendance', 'commands'):
            if search:
                filters.append('(instr(lower(operator_name), lower(?)) > 0'
                               " OR instr(lower(operator_ref), lower(?)) > 0)")
                args.extend([search, search])
            if table == 'commands' and category:
                filters.append('action=?')
                args.append(category)
        query = f'SELECT * FROM {table} WHERE ' + ' AND '.join(filters) + ' ORDER BY at DESC,id DESC'
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            args.extend([limit, offset])
        for row in self.db.execute(query, args):
            yield dict(row)

    def attendance_today(self, source, start):
        """Used for the console header count; bounded, not a full table scan."""
        row = self.db.execute('SELECT COUNT(*) FROM attendance WHERE source=? AND at>=?',
                              (source, start)).fetchone()
        return row[0] if row else 0

    def prune(self, cutoff):
        with self.db:
            self.db.execute('DELETE FROM events WHERE at < ?', (cutoff,))
            self.db.execute('DELETE FROM samples WHERE at < ?', (cutoff,))
