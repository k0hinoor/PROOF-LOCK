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
            CREATE INDEX IF NOT EXISTS event_lookup ON events(source, at DESC);
            CREATE INDEX IF NOT EXISTS sample_lookup ON samples(source, at DESC);
        ''')

    def event(self, at, source, origin, category, code, severity, details, seq, snapshot):
        with self.db:
            self.db.execute('INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?,?,?)',
                            (at, source, origin, category, code, severity, details, seq, json.dumps(snapshot)))

    def sample(self, at, source, adc, seq):
        with self.db:
            self.db.execute('INSERT INTO samples VALUES(NULL,?,?,?,?)', (at, source, adc, seq))

    def rows(self, table, source, since=0, category='', severity='', search='', limit=100, offset=0):
        assert table in ('events', 'samples')
        filters = ['source=?', 'at>=?']
        args = [source, since]
        if table == 'events':
            for key, value in [('category', category), ('severity', severity)]:
                if value:
                    filters.append(f'{key}=?')
                    args.append(value)
            if search:
                filters.append("instr(lower(replace(code,'_',' ') || ' ' || details), lower(?)) > 0")
                args.append(search)
        query = f'SELECT * FROM {table} WHERE ' + ' AND '.join(filters) + ' ORDER BY at DESC,id DESC'
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            args.extend([limit, offset])
        for row in self.db.execute(query, args):
            yield dict(row)

    def prune(self, cutoff):
        with self.db:
            self.db.execute('DELETE FROM events WHERE at < ?', (cutoff,))
            self.db.execute('DELETE FROM samples WHERE at < ?', (cutoff,))
