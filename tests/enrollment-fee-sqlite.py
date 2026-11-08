"""Exercise actual fee/invoice SQL on SQLite independently of the Rust toolchain."""
import importlib.util
import re
import sqlite3
import unittest
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location('fixture', here / 'year-import-sqlite.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
commands = here.parent / 'src-tauri/src/commands'
def literal(file, fragment):
    source = (commands / file).read_text()
    return next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', source, re.S) if fragment in s)

class EnrollmentFeeSqlTests(base.YearImportTests):
    def test_legacy_backfill_and_first_enrollment_decision_survive_group_deletion(self):
        db = self.db
        source = (here.parent / 'src-tauri/src/db/mod.rs').read_text()
        migration = next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', source, re.S) if 'INSERT OR IGNORE INTO enrollment_fee_attempts(student_id,school_year_id) SELECT e.student_id' in s)
        db.executescript(migration)
        self.assertEqual(db.execute('SELECT student_id,school_year_id FROM enrollment_fee_attempts').fetchall(), [(1,1)])
        decision = literal('enrollments.rs', 'INSERT OR IGNORE INTO enrollment_fee_attempts(student_id,school_year_id) VALUES')
        self.assertEqual(db.execute(decision,(2,1)).rowcount,1)
        self.assertEqual(db.execute(decision,(2,1)).rowcount,0)
        db.execute('DELETE FROM groups WHERE id=1')
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fee_attempts').fetchone()[0],2)
        db.execute('DELETE FROM students WHERE id=2')
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fee_attempts').fetchone()[0],1)

    def test_legacy_invoice_type_backfill(self):
        db = self.db
        invoice = db.execute("INSERT INTO invoices(amount_cents,type) VALUES(20000,'groupe')").lastrowid
        db.execute('INSERT INTO enrollment_fees(student_id,school_year_id,amount,invoice_id) VALUES(1,1,20000,?)',(invoice,))
        source = (here.parent / 'src-tauri/src/db/mod.rs').read_text()
        backfill = next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', source, re.S) if s.startswith("UPDATE invoices SET type='frais_inscription'"))
        db.execute(backfill)
        self.assertEqual(db.execute('SELECT type FROM invoices WHERE id=?',(invoice,)).fetchone(),('frais_inscription',))

    def test_fee_sql_ownership_receipt_export_and_year_scope(self):
        db = self.db
        insert_invoice = literal('enrollments.rs', 'INSERT INTO invoices(enrollment_id, period_month')
        insert_fee = literal('enrollments.rs', 'INSERT INTO enrollment_fees(student_id')
        fee_invoice = db.execute(insert_invoice, (9, 2024, 20000, '2024-09-01')).lastrowid
        db.execute(insert_fee, (1, 1, 20000, fee_invoice))
        self.assertEqual(db.execute('SELECT amount_cents,type FROM invoices WHERE id=?', (fee_invoice,)).fetchone(), (20000,'frais_inscription'))
        with self.assertRaises(sqlite3.IntegrityError): db.execute(insert_fee, (1, 1, 20000, fee_invoice))
        student_sql = literal('invoices.rs', 'CASE WHEN f.id IS NOT NULL THEN \'enrollment_fee\'')
        rows = db.execute(student_sql, (1,)).fetchall()
        self.assertEqual(rows[0][11:], ('enrollment_fee', '2024-2025'))
        ownership = literal('payments.rs', 'SELECT EXISTS(\n                    SELECT 1 FROM invoices i')
        self.assertEqual(db.execute(ownership, (fee_invoice, 1)).fetchone()[0], 1)
        self.assertEqual(db.execute(ownership, (fee_invoice, 2)).fetchone()[0], 0)
        db.execute("INSERT INTO payments(student_id, invoice_id, amount_cents) VALUES (1,?,5000)", (fee_invoice,))
        self.assertEqual(db.execute('SELECT school_year_id FROM payments').fetchone()[0], 1)
        items = literal('payments.rs', "SELECT p.amount_cents, p.invoice_id, COALESCE(s.name,'')")
        self.assertEqual(db.execute(items, (1,)).fetchone(), (5000, fee_invoice, '', '', '', 9, 2024, '2024-2025', ''))
        export = literal('year_export.rs', 'AS invoice_kind')
        self.assertEqual(db.execute(export, (1,)).fetchone()[3], 'enrollment_fee')
        theoretical = literal('dashboard.rs', 'SELECT COALESCE(SUM(i.amount_cents), 0) FROM invoices i LEFT JOIN')
        self.assertEqual(db.execute(theoretical, (9, 2024)).fetchone()[0], 20000)
        alert = literal('invoices.rs', 'SELECT s.id,\n                    s.full_name,')
        self.assertEqual(len(db.execute(alert, (9, 2024)).fetchall()), 1)
        # The fee remains payable after the group is deleted, but belongs only to its year.
        db.execute('DELETE FROM groups WHERE id=1')
        self.assertEqual(db.execute(ownership, (fee_invoice, 1)).fetchone()[0], 1)
        db.execute('UPDATE school_years SET is_active=(id=2)')
        self.assertEqual(db.execute(ownership, (fee_invoice, 1)).fetchone()[0], 0)
        self.assertEqual(db.execute(student_sql, (1,)).fetchall(), [])
        fee2 = db.execute(insert_invoice, (9, 2025, 30000, '2025-09-01')).lastrowid
        db.execute(insert_fee, (1, 2, 30000, fee2))
        self.assertEqual(db.execute(student_sql, (1,)).fetchone()[7], 30000)
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        # Existing fee is explicitly removed with its invoice when a year is deleted.
        remove = literal('school_years.rs', 'DELETE FROM invoices WHERE id IN (SELECT invoice_id FROM enrollment_fees')
        db.execute(remove, (1,))
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fees WHERE school_year_id=1').fetchone()[0], 0)
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fees WHERE school_year_id=2').fetchone()[0], 1)
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

if __name__ == '__main__': unittest.main()
