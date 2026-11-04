"""Exercise the actual migration and import SQL against SQLite without Tauri.

Run with: python3 tests/year-import-sqlite.py
"""
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db_source = (ROOT / 'src-tauri/src/db/mod.rs').read_text()
import_source = (ROOT / 'src-tauri/src/commands/year_import.rs').read_text()
part = db_source.split('fn migrate_school_year_membership', 1)[1].split('/// Columns introduced', 1)[0]
blocks = re.findall(r'r#"(.*?)"#', part, re.S)
assert len(blocks) == 3

def sql_containing(fragment):
    matches = re.findall(r'"((?:[^"\\]|\\.)*)"', import_source, re.S)
    return next(s for s in matches if fragment in s)

def migrate(conn):
    if 'school_year_id' not in [row[1] for row in conn.execute('PRAGMA table_info(monthly_expenses)')]:
        conn.execute('ALTER TABLE monthly_expenses ADD COLUMN school_year_id INTEGER REFERENCES school_years(id)')
    conn.executescript(blocks[0])
    if (not conn.execute("SELECT 1 FROM settings WHERE key='school_year_membership_migrated'").fetchone()
            and conn.execute("SELECT 1 FROM school_years WHERE is_active=1").fetchone()):
        conn.executescript(blocks[1])
    conn.executescript(blocks[2])

class YearImportTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((ROOT / 'src-tauri/src/db/schema.sql').read_text())
        self.db.executescript("""
        INSERT INTO school_years (id,label,start_date,end_date,is_active) VALUES
          (1,'2024-2025','2024-09-01','2025-06-30',1), (2,'2025-2026','2025-09-01','2026-06-30',0);
        INSERT INTO students (id,full_name,phone) VALUES (1,'Anas','0612345678'),(2,'Lina','0612345679');
        INSERT INTO teachers (id,full_name) VALUES (1,'Teacher'),(2,'Unassigned');
        INSERT INTO groups (id,teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES (1,1,1,12000,20);
        INSERT INTO group_schedules (group_id,day_of_week,start_time,end_time) VALUES (1,'lundi','09:00','10:00'),(1,'mardi','09:00','10:00');
        INSERT INTO enrollments (student_id,group_id,start_date) VALUES (1,1,'2024-09-01');
        INSERT INTO monthly_expenses (label,amount_cents,category,month,year) VALUES ('rent',1000,'rent',9,2024);
        """)
        migrate(self.db)

    def test_backfill_and_triggers_do_not_change_history_on_switch(self):
        db = self.db
        self.assertEqual(db.execute('SELECT count(*) FROM student_school_years WHERE school_year_id=1').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT school_year_id FROM monthly_expenses').fetchone()[0], 1)
        db.execute('UPDATE school_years SET is_active=(id=2)')
        migrate(db)
        self.assertEqual(db.execute('SELECT count(*) FROM student_school_years WHERE school_year_id=2').fetchone()[0], 0)
        db.execute("INSERT INTO students (id,full_name) VALUES (3,'New')")
        db.execute("INSERT INTO teachers (id,full_name) VALUES (3,'New')")
        db.execute("INSERT INTO monthly_expenses (label,amount_cents,category,month,year) VALUES ('rent',1000,'rent',9,2025)")
        self.assertEqual(db.execute('SELECT school_year_id FROM student_school_years WHERE student_id=3').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT school_year_id FROM teacher_school_years WHERE teacher_id=3').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT school_year_id FROM monthly_expenses ORDER BY id').fetchall(), [(1,), (2,)])

    def test_student_import_keeps_identity_no_enrollments_and_is_idempotent(self):
        db = self.db
        sql = sql_containing('INSERT OR IGNORE INTO student_school_years (student_id,school_year_id)')
        self.assertEqual(db.execute(sql, (1, 2)).rowcount, 1)
        self.assertEqual(db.execute(sql, (1, 2)).rowcount, 0)
        self.assertEqual(db.execute('SELECT count(*) FROM students').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT count(*) FROM enrollments').fetchone()[0], 1)

    def test_groups_copy_slots_not_students_and_track_source(self):
        db = self.db
        sql = sql_containing('INSERT INTO groups (subject_id,level_id,branch_id,teacher_id,school_year_id')
        cursor = db.execute(sql, (1, 2))
        copy = cursor.lastrowid
        db.execute(sql_containing('INSERT INTO group_schedules (group_id,day_of_week,start_time,end_time) SELECT'), (1, copy))
        db.execute(sql_containing('INSERT INTO group_year_imports (source_group_id,target_school_year_id,imported_group_id)'), (1, 2, copy))
        self.assertEqual(db.execute('SELECT count(*) FROM group_schedules WHERE group_id=?', (copy,)).fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT count(*) FROM enrollments WHERE group_id=?', (copy,)).fetchone()[0], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute('INSERT INTO group_year_imports VALUES (?,?,?)', (1, 2, copy))

    def test_teacher_import_and_group_visibility(self):
        db = self.db
        sql = sql_containing('INSERT OR IGNORE INTO teacher_school_years (teacher_id,school_year_id)')
        self.assertEqual(db.execute(sql, (2, 2)).rowcount, 1)
        self.assertEqual(db.execute(sql, (2, 2)).rowcount, 0)
        db.execute('INSERT INTO groups (teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES (1,2,1,1)')
        self.assertEqual(db.execute(sql, (1, 2)).rowcount, 0)

if __name__ == '__main__': unittest.main()
