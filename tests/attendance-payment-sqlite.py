"""SQLite schema and financial SQL checks against isolated in-memory data."""
import re
import sqlite3
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

class AttendancePaymentSQLite(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((ROOT / 'src-tauri/src/db/schema.sql').read_text())
        self.db.execute('ALTER TABLE payments ADD COLUMN school_year_id INTEGER REFERENCES school_years(id)')
        self.db.executescript("""
        INSERT INTO school_years(id,label,start_date,end_date,is_active) VALUES(1,'2020','2020-01-01','2020-12-31',1),(2,'2021','2021-01-01','2021-12-31',0);
        INSERT INTO students(id,full_name,guardian_name,guardian_phone,cin_tuteur,nom_pere,nom_mere) VALUES(1,'Salma','Parent','0712345678','AB12','Père','Mère');
        INSERT INTO subjects(id,name) VALUES(1,'Maths'); INSERT INTO levels(id,name) VALUES(1,'Niveau');
        INSERT INTO groups(id,name,subject_id,level_id,school_year_id,monthly_fee_cents,capacity) VALUES(1,'Atlas',1,1,1,10000,10),(2,'Rif',1,1,1,20000,10);
        INSERT INTO enrollments(id,student_id,group_id,start_date,status) VALUES(1,1,1,'2020-01-01','actif'),(2,1,2,'2020-01-01','actif');
        INSERT INTO invoices(id,enrollment_id,period_month,period_year,amount_cents,paid_amount_cents,status,due_date) VALUES(1,1,1,2020,10000,10000,'payé','2020-01-01'),(2,2,1,2020,20000,5000,'partiel','2020-01-01');
        INSERT INTO payments(id,student_id,invoice_id,amount_cents,batch_id,school_year_id) VALUES(1,1,1,10000,1,1),(2,1,2,5000,1,1);
        INSERT INTO receipts(id,payment_id,receipt_number,amount_cents) VALUES(1,1,'TEST',15000);
        """)
        self.db.commit()

    def test_absences_schema_queries_fk_and_scope(self):
        self.assertEqual(self.db.execute('SELECT cin_tuteur,nom_pere,nom_mere FROM students WHERE id=1').fetchone(), ('AB12','Père','Mère'))
        src = (ROOT / 'src-tauri/src/commands/absences.rs').read_text()
        insert = re.search(r'"(INSERT INTO absences\(student_id.*?\))"', src).group(1)
        self.db.execute(insert, (1,1,'2020-01-12','Malade',1))
        query = re.search(r'conn.prepare\("(SELECT a.id,a.student_id.*?ORDER BY a.absence_date DESC,a.id DESC)"\)', src).group(1)
        row = self.db.execute(query,(1,)).fetchone()
        self.assertEqual((row[3],row[4],row[5],row[6]), ('Atlas','2020-01-12','Malade',1))
        self.db.execute('UPDATE school_years SET is_active=(id=2)')
        self.assertEqual(self.db.execute(query,(1,)).fetchall(), [])
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute(insert, (99,1,'2020-01-12',None,0))
        self.db.execute('DELETE FROM groups WHERE id=1')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM absences').fetchone()[0], 0)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_payment_history_join_and_atomic_reversal(self):
        src = (ROOT / 'src-tauri/src/commands/payments.rs').read_text()
        query = re.search(r'"(SELECT p.id, p.student_id, s.full_name, p.invoice_id, p.amount_cents,.*?LIMIT \?4 OFFSET \?5)"', src, re.S).group(1)
        query = query.replace('{where_clause}', 'WHERE p.school_year_id=1 AND (?1 IS NULL OR p.student_id=?1) AND (?2 IS NULL OR (i.period_month=?2 AND i.period_year=?3))')
        rows = self.db.execute(query,(1,1,2020,20,0)).fetchall()
        self.assertEqual({r[10] for r in rows}, {'Atlas','Rif'})
        self.assertTrue(all(r[8:10] == (1,2020) for r in rows))
        self.db.execute('BEGIN')
        for invoice, amount in self.db.execute('SELECT invoice_id,amount_cents FROM payments WHERE batch_id=1').fetchall():
            paid, due = self.db.execute('SELECT paid_amount_cents,amount_cents FROM invoices WHERE id=?',(invoice,)).fetchone()
            paid -= amount
            self.db.execute('UPDATE invoices SET paid_amount_cents=?,status=? WHERE id=?',(paid,'payé' if paid>=due else 'partiel' if paid>0 else 'impayé',invoice))
        self.db.execute('DELETE FROM payments WHERE batch_id=1')
        self.db.commit()
        self.assertEqual(self.db.execute('SELECT paid_amount_cents,status FROM invoices ORDER BY id').fetchall(), [(0,'impayé'),(0,'impayé')])
        self.assertEqual(self.db.execute('SELECT count(*) FROM receipts').fetchone()[0],0)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_idempotent_optional_columns_upgrade(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE students(id INTEGER PRIMARY KEY, full_name TEXT NOT NULL)')
        db.execute("INSERT INTO students VALUES(1,'Salma')")
        source = (ROOT / 'src-tauri/src/db/mod.rs').read_text()
        self.assertIn('for column in ["cin_tuteur", "nom_pere", "nom_mere"]', source)
        for _ in range(2):
            for name in ('cin_tuteur','nom_pere','nom_mere'):
                if name not in [r[1] for r in db.execute('PRAGMA table_info(students)')]: db.execute(f'ALTER TABLE students ADD COLUMN {name} TEXT')
        self.assertEqual(db.execute('SELECT full_name,cin_tuteur,nom_pere,nom_mere FROM students').fetchone(), ('Salma',None,None,None))
        db.close()

    def test_real_rebuild_preserves_legacy_rows_references_and_fees(self):
        source = (ROOT / 'src-tauri/src/db/mod.rs').read_text()
        block = source.split('fn upgrade_student_columns',1)[1].split('fn migrate_group_schedules',1)[0]
        template = re.search(r'conn.execute_batch\(&format!\(r#"(.*?)"#\)\)',block,re.S).group(1)
        definitions = re.findall(r'let (\w+) = expr\(&\[(.*?)\], "(.*?)"\)\?;', block)
        with tempfile.TemporaryDirectory() as directory:
            for has_fee in (False, True):
                path = Path(directory) / f'{has_fee}.db'
                shutil.copyfile(ROOT / 'test-data/centremanager-charge.db',path)
                db = sqlite3.connect(path)
                db.execute('PRAGMA foreign_keys=ON')
                db.execute('ALTER TABLE students ADD COLUMN father_name TEXT')
                db.execute("UPDATE students SET father_name='Père',phone='0611111111',guardian_phone='0722222222' WHERE id=1")
                if has_fee:
                    db.execute('ALTER TABLE students ADD COLUMN enrollment_fee_cents INTEGER NOT NULL DEFAULT 0')
                    db.execute('UPDATE students SET enrollment_fee_cents=12345 WHERE id=1')
                db.commit()
                original = db.execute('SELECT count(*) FROM enrollments').fetchone()[0]
                expected = 12345 if has_fee else db.execute('SELECT COALESCE((SELECT amount FROM enrollment_fees WHERE student_id=1 ORDER BY id DESC LIMIT 1),0)').fetchone()[0]
                columns = {r[1] for r in db.execute('PRAGMA table_info(students)')}
                substitutions = {}
                for name, candidates, fallback in definitions:
                    present = [c for c in re.findall(r'"(.*?)"',candidates) if c in columns]
                    substitutions[name] = f"COALESCE({', '.join(present)}, {fallback})" if present else fallback
                sql = template.format(**substitutions)
                db.execute('PRAGMA foreign_keys=OFF')
                db.executescript('BEGIN IMMEDIATE;' + sql)
                db.execute('PRAGMA foreign_keys=ON')
                row = db.execute('SELECT phone,guardian_phone,nom_pere,enrollment_fee_cents FROM students WHERE id=1').fetchone()
                self.assertEqual(row,('0611111111','0722222222','Père',expected))
                self.assertEqual(db.execute('SELECT count(*) FROM enrollments').fetchone()[0],original)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertTrue({'idx_students_name','idx_students_level','idx_students_branch','idx_students_status'} <= {r[1] for r in db.execute('PRAGMA index_list(students)')})
                db.close()

    def tearDown(self): self.db.close()

if __name__ == '__main__': unittest.main()
