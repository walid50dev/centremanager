"""The bundled browser data and the bundled SQLite fixture must stay in sync."""
import json, sqlite3, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
class FixtureParity(unittest.TestCase):
    def test_browser_sqlite_parity(self):
        data=json.loads((ROOT/'test-data/centremanager-charge.json').read_text())
        db=sqlite3.connect(f"file:{ROOT/'test-data/centremanager-charge.db'}?mode=ro",uri=True)
        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(),('ok',))
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
        for table,key in [('students','students'),('groups','groups'),('teachers','teachers'),('enrollments','enrollments'),('invoices','invoices'),('payments','payments'),('monthly_expenses','expenses'),('teacher_settlements','teacherSettlements')]:
            rows=data[key]; self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0],len(rows),table)
            cols={row[1] for row in db.execute(f'PRAGMA table_info({table})')}
            for item in rows:
                keys=[k for k in item if k in cols]
                actual=db.execute(f"SELECT {','.join(keys)} FROM {table} WHERE id=?",(item['id'],)).fetchone()
                self.assertEqual(actual,tuple(item[k] for k in keys),(table,item['id']))
        self.assertEqual(db.execute("SELECT count(*) FROM settings WHERE key='admin_password_hash'").fetchone()[0],0)
        self.assertEqual(db.execute('SELECT count(*) FROM students').fetchone()[0],200)
        self.assertEqual(db.execute('SELECT count(*) FROM groups').fetchone()[0],14)
        self.assertEqual(db.execute('SELECT count(*) FROM teachers').fetchone()[0],6)
        db.close()
if __name__=='__main__': unittest.main()
