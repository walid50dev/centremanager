"""Run the real deletion/migration SQL against SQLite (no Tauri required)."""
import importlib.util
import re
import sqlite3
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('year_fixture', root / 'tests/year-import-sqlite.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def literal(filename, fragment):
    src = (root / 'src-tauri/src/commands' / filename).read_text().split('#[cfg(test)]')[0]
    return next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', src, re.S) if fragment in s)

class DestructiveSqlTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript((root / 'src-tauri/src/db/schema.sql').read_text())
        self.db.executescript("""INSERT INTO school_years(id,label,start_date,end_date,is_active) VALUES
          (1,'2024-2025','2024-09-01','2025-06-30',1), (2,'2025-2026','2025-09-01','2026-06-30',0);
          INSERT INTO students(id,full_name) VALUES(1,'S'),(2,'Other');
          INSERT INTO teachers(id,full_name) VALUES(1,'T');
          INSERT INTO groups(id,teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES(1,1,1,100,10),(2,1,2,100,10);
          INSERT INTO enrollments(id,student_id,group_id,start_date) VALUES(1,1,1,'2024-09-01'),(2,2,2,'2025-09-01');
          INSERT INTO invoices(id,enrollment_id,amount_cents) VALUES(1,1,100),(2,2,100);
          INSERT INTO payments(id,student_id,invoice_id,amount_cents) VALUES(1,1,1,100),(2,2,2,100);
          INSERT INTO receipts(id,payment_id) VALUES(1,1),(2,2);
          INSERT INTO group_schedules(group_id,day_of_week,start_time,end_time) VALUES(1,'Lundi','09:00','10:00'),(2,'Lundi','09:00','10:00');
          INSERT INTO teacher_settlements(teacher_id,amount_cents,month,year) VALUES(1,100,10,2025);
        """)
        fixture.migrate(self.db)

    def test_scoped_trash_and_shared_teacher(self):
        db = self.db
        db.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,month,year) VALUES(1,200,1,2025)")
        db.execute("UPDATE groups SET deleted_at='2025-01-01'")
        db.execute("UPDATE teacher_school_years SET deleted_at='2025-01-01' WHERE teacher_id=1 AND school_year_id=1")
        query = literal('trash.rs', "SELECT 'teacher', t.id")
        self.assertEqual({row[:2] for row in db.execute(query,(1,))}, {('group',1),('teacher',1)})
        self.assertEqual({row[:2] for row in db.execute(query,(2,))}, {('group',2)})
        db.execute(literal('trash.rs','DELETE FROM receipts WHERE payment_id IN'),(1,))
        db.execute(literal('trash.rs','DELETE FROM payments WHERE invoice_id IN'),(1,))
        db.execute(literal('trash.rs','DELETE FROM groups WHERE id=?1'),(1,))
        for sql in ('DELETE FROM teacher_settlements WHERE teacher_id=?2', 'DELETE FROM teacher_compensation WHERE teacher_id=?2', 'DELETE FROM teacher_activities WHERE teacher_id=?2'):
            db.execute(literal('trash.rs',sql),(1,1))
        db.execute(literal('trash.rs','UPDATE groups SET teacher_id=NULL WHERE teacher_id=?1 AND school_year_id=?2'),(1,1))
        db.execute(literal('trash.rs','DELETE FROM teacher_school_years WHERE teacher_id=?1 AND school_year_id=?2 AND deleted_at'),(1,1))
        db.execute(literal('trash.rs','DELETE FROM teachers WHERE id=?1 AND NOT EXISTS'),(1,))
        self.assertEqual(db.execute('SELECT id FROM groups').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT id FROM payments').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT id FROM receipts').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT teacher_id FROM groups WHERE id=2').fetchone(),(1,))
        self.assertEqual(db.execute('SELECT count(*) FROM teacher_settlements').fetchone(),(1,))
        self.assertEqual(db.execute('SELECT school_year_id FROM teacher_school_years').fetchall(),[(2,)])
        # Reopening/migrating must not reattach the removed teacher to year 1.
        fixture.migrate(db)
        self.assertEqual(db.execute('SELECT school_year_id FROM teacher_school_years').fetchall(),[(2,)])

    def test_legacy_teacher_trash_is_converted_without_hiding_other_rows(self):
        db = self.db
        db.execute("UPDATE teachers SET deleted_at='2025-01-01' WHERE id=1")
        fixture.migrate(db)
        self.assertIsNone(db.execute('SELECT deleted_at FROM teachers WHERE id=1').fetchone()[0])
        self.assertEqual(db.execute('SELECT school_year_id,deleted_at FROM teacher_school_years ORDER BY school_year_id').fetchall(), [(1,'2025-01-01'),(2,'2025-01-01')])
        fixture.migrate(db)
        self.assertEqual(db.execute('SELECT count(*) FROM teacher_school_years').fetchone(),(2,))

    def test_overlapping_salary_period_is_preserved(self):
        db = self.db
        db.execute("INSERT INTO school_years(id,label,start_date,end_date,is_active) VALUES(3,'overlap','2025-09-01','2026-06-30',0)")
        db.execute(literal('school_years.rs', 'DELETE FROM teacher_settlements WHERE EXISTS'),(2,))
        self.assertEqual(db.execute('SELECT count(*) FROM teacher_settlements').fetchone(),(1,))

    def test_student_delete_cascades_and_rolls_back(self):
        db = self.db
        db.commit()
        payment_sql = literal('students.rs', 'DELETE FROM payments WHERE student_id=?1 OR invoice_id IN')
        audit_sql = literal('students.rs', "DELETE FROM audit_log WHERE entity_type='student'")
        related_audit_sql = literal('students.rs', "DELETE FROM audit_log WHERE (entity_type='enrollment'")
        student_sql = literal('students.rs', 'DELETE FROM students WHERE id=?1')
        db.executescript("CREATE TRIGGER block_delete BEFORE DELETE ON students BEGIN SELECT RAISE(ABORT,'blocked'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                db.execute(related_audit_sql,(1,)); db.execute(payment_sql,(1,)); db.execute(audit_sql,(1,)); db.execute(student_sql,(1,))
        self.assertEqual(db.execute('SELECT count(*) FROM payments').fetchone(),(2,))
        db.execute('DROP TRIGGER block_delete')
        with db:
            db.execute(related_audit_sql,(1,)); db.execute(payment_sql,(1,)); db.execute(audit_sql,(1,)); db.execute(student_sql,(1,))
        for table in ('students','enrollments','invoices','payments','receipts'):
            self.assertEqual(db.execute(f'SELECT id FROM {table}').fetchall(),[(2,)], table)

    def test_student_trash_scope_restore_and_expiry_with_fees(self):
        db = self.db
        db.execute("UPDATE students SET guardian_phone='0612345678' WHERE id=1")
        db.execute("INSERT INTO invoices(id,amount_cents,type) VALUES(3,20000,'frais_inscription')")
        db.execute("INSERT INTO enrollment_fees(student_id,school_year_id,invoice_id,amount) VALUES(1,1,3,20000)")
        db.execute(literal('trash.rs', "UPDATE students SET deleted_at=datetime('now'), trash_school_year_id"),(1,1))
        query = literal('trash.rs', "SELECT 'student', st.id")
        row = next(r for r in db.execute(query,(1,)) if r[0] == 'student')
        self.assertEqual(row[2], 'S'); self.assertEqual(row[4], '0612345678')
        self.assertFalse(any(r[0] == 'student' for r in db.execute(query,(2,))))
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fees').fetchone()[0],1)
        db.execute(literal('trash.rs', 'UPDATE students SET deleted_at=NULL, trash_school_year_id=NULL'),(1,1))
        self.assertIsNone(db.execute('SELECT deleted_at FROM students WHERE id=1').fetchone()[0])
        db.execute(literal('trash.rs', "UPDATE students SET deleted_at=datetime('now'), trash_school_year_id"),(1,1))
        db.execute("UPDATE students SET deleted_at=datetime('now','-31 days') WHERE id=1")
        db.execute("UPDATE students SET deleted_at=datetime('now','-31 days') WHERE id=2")
        self.assertEqual(db.execute(literal('trash.rs', 'SELECT id FROM students WHERE deleted_at IS NOT NULL AND trash_school_year_id IS NOT NULL')).fetchall(),[(1,)])
        db.execute(literal('students.rs', "DELETE FROM audit_log WHERE (entity_type='enrollment'"),(1,))
        db.execute(literal('students.rs', 'DELETE FROM payments WHERE student_id=?1 OR invoice_id IN'),(1,))
        db.execute(literal('students.rs', 'DELETE FROM invoices WHERE id IN (SELECT invoice_id FROM enrollment_fees'),(1,))
        db.execute(literal('students.rs', "DELETE FROM audit_log WHERE entity_type='student'"),(1,))
        db.execute(literal('students.rs', 'DELETE FROM students WHERE id=?1'),(1,))
        self.assertEqual(db.execute('SELECT id FROM students').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT count(*) FROM enrollment_fees').fetchone()[0],0)
        self.assertEqual(db.execute('SELECT id FROM invoices').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT id FROM payments').fetchall(),[(2,)])
        self.assertEqual(db.execute('SELECT id FROM receipts').fetchall(),[(2,)])

    def test_year_delete_rolls_back_on_failure(self):
        db = self.db
        db.commit()
        db.executescript("CREATE TRIGGER block_group BEFORE DELETE ON groups WHEN OLD.school_year_id=2 BEGIN SELECT RAISE(ABORT,'blocked'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                db.execute(literal('school_years.rs','DELETE FROM payments WHERE school_year_id=?1 OR invoice_id IN'),(2,))
                db.execute(literal('school_years.rs','DELETE FROM teacher_settlements WHERE EXISTS'),(2,))
                db.execute(literal('school_years.rs','DELETE FROM groups WHERE school_year_id=?1'),(2,))
        self.assertEqual(db.execute('SELECT id FROM payments ORDER BY id').fetchall(),[(1,),(2,)])
        self.assertEqual(db.execute('SELECT id FROM receipts ORDER BY id').fetchall(),[(1,),(2,)])
        self.assertEqual(db.execute('SELECT count(*) FROM teacher_settlements').fetchone(),(1,))

    def test_year_deletion_sql_cascades_and_keeps_other_year(self):
        db = self.db
        db.execute("INSERT INTO payments(id,student_id,amount_cents,school_year_id) VALUES(3,2,50,2)")
        db.execute("INSERT INTO receipts(id,payment_id) VALUES(3,3)")
        db.execute("INSERT INTO monthly_expenses(label,amount_cents,category,month,year,school_year_id) VALUES('X',100,'x',10,2025,2)")
        for fragment in ('DELETE FROM payments WHERE school_year_id=?1 OR invoice_id IN','DELETE FROM teacher_settlements WHERE EXISTS', 'DELETE FROM teacher_compensation WHERE EXISTS', 'DELETE FROM teacher_activities WHERE EXISTS', 'DELETE FROM monthly_expenses WHERE school_year_id=?1', 'DELETE FROM groups WHERE school_year_id=?1','DELETE FROM student_school_years WHERE school_year_id=?1','DELETE FROM teacher_school_years WHERE school_year_id=?1','DELETE FROM school_years WHERE id=?1'):
            db.execute(literal('school_years.rs',fragment),(2,))
        for table in ('groups','enrollments','invoices','payments','receipts','school_years'):
            self.assertEqual(db.execute(f'SELECT id FROM {table}').fetchall(),[(1,)], table)
        self.assertEqual(db.execute('SELECT count(*) FROM monthly_expenses').fetchone(),(0,))
        self.assertEqual(db.execute('SELECT count(*) FROM group_schedules').fetchone(),(1,))
        self.assertEqual(db.execute('SELECT count(*) FROM teacher_settlements').fetchone(),(0,))

if __name__ == '__main__': unittest.main()
