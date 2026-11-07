"""Exercise the exact payment, attribution, export and purge SQL without Tauri."""
import re, sqlite3, unittest
from pathlib import Path
root = Path(__file__).resolve().parents[1]
def source(name): return (root / 'src-tauri/src/commands' / name).read_text()
def literal(src, fragment): return next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', src, re.S) if fragment in s)
class Payments(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((root/'src-tauri/src/db/schema.sql').read_text())
        self.db.executescript('''CREATE TABLE teacher_school_years(teacher_id INTEGER,school_year_id INTEGER,deleted_at TEXT);
          INSERT INTO school_years(id,label,start_date,end_date,is_active) VALUES(1,'one','2024-09-01','2025-06-30',1),(2,'two','2025-09-01','2026-06-30',0);
          INSERT INTO teachers(id,full_name) VALUES(1,'Test'); INSERT INTO teacher_school_years VALUES(1,1,NULL),(1,2,NULL);''')
        self.src = source('teacher_payments.rs')
        self.match = literal(self.src, '(ts.school_year_id=y.id')
    def query(self, key):
        return literal(self.src,key).replace('{}',self.match)
    def test_manual_legacy_isolation_and_purge(self):
        db=self.db
        self.assertEqual(db.execute(literal(self.src,'SELECT y.id FROM school_years y JOIN teachers'),(1,)).fetchone(),(1,))
        insert=literal(self.src,'INSERT INTO teacher_settlements(teacher_id,amount_cents')
        db.execute(insert,(1,12000,'virement','note',11,2026,'2026-11-07',1))
        db.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,payment_method,month,year,created_at) VALUES(1,9000,'chèque',10,2025,'2025-11-01')")
        list_sql=self.query('SELECT ts.id, COALESCE(ts.amount_cents')
        self.assertEqual(db.execute(list_sql,(1,1)).fetchone()[1:5],(12000,'2026-11-07','virement','note'))
        self.assertEqual(db.execute(list_sql,(1,2)).fetchone()[1:4],(9000,'2025-11-01','chèque'))
        db.execute(insert,(1,23000,'espèces',None,11,2026,'2026-11-07',2))
        year_sql=literal(source('year_export.rs'),'SELECT COALESCE(sum(ts.amount_cents),0)')
        self.assertEqual(db.execute(year_sql,(1,)).fetchone(),(12000,))
        self.assertEqual(db.execute(year_sql,(2,)).fetchone(),(32000,))
        dash=literal(source('dashboard.rs'),'SELECT COALESCE(SUM(ts.amount_cents),0)').replace('{}',self.match)
        self.assertEqual(db.execute(dash,(11,2026)).fetchone(),(12000,))
        purge=literal(source('school_years.rs'),'DELETE FROM teacher_settlements WHERE EXISTS')
        db.execute(purge,(2,))
        self.assertEqual(db.execute('SELECT amount_cents FROM teacher_settlements').fetchall(),[(12000,)])
    def test_ambiguous_legacy_is_not_guessed(self):
        db=self.db
        db.execute("INSERT INTO school_years(id,label,start_date,end_date) VALUES(3,'overlap','2025-09-01','2026-06-30')")
        db.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,month,year) VALUES(1,500,10,2025)")
        self.assertEqual(db.execute(self.query('SELECT ts.id, COALESCE(ts.amount_cents'),(1,2)).fetchall(),[])
        unattributed = literal(self.src, 'WHERE ts.teacher_id=?1 AND ts.school_year_id IS NULL')
        self.assertEqual(db.execute(unattributed,(1,)).fetchone()[1],500)
        db.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,month,year) VALUES(1,700,NULL,NULL)")
        self.assertEqual(sorted(row[1] for row in db.execute(unattributed,(1,)).fetchall()),[500,700])
        purge=literal(source('school_years.rs'),'DELETE FROM teacher_settlements WHERE EXISTS')
        db.execute(purge,(2,)); self.assertEqual(db.execute('SELECT count(*) FROM teacher_settlements').fetchone(),(2,))
if __name__ == '__main__': unittest.main()
