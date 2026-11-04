"""Exercise actual year-scoped SQL against two school years."""
import importlib.util
import re
import unittest
from pathlib import Path
here=Path(__file__).parent
spec=importlib.util.spec_from_file_location('fixture',here/'year-import-sqlite.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
root=here.parent/'src-tauri/src/commands'
def source(file): return (root/file).read_text()
def literal_containing(file, value):
    matches = re.findall(r'"((?:[^"\\]|\\.)*)"',source(file),re.S)
    return next(item for item in matches if value in item)
class ScopedYearTests(base.YearImportTests):
    def test_switch_scopes_students_groups_teachers_timetable_and_finances(self):
        db=self.db
        db.execute("INSERT INTO invoices (enrollment_id,amount_cents,period_month,period_year) VALUES (1,5000,9,2024)")
        db.execute("INSERT INTO payments (student_id,invoice_id,amount_cents,created_at) VALUES (1,1,4000,'2024-09-15')")
        student_filter=literal_containing('students.rs','EXISTS (SELECT 1 FROM student_school_years sy WHERE sy.student_id=s.id')
        group_filter=literal_containing('groups.rs','g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)')
        timetable_filter=literal_containing('schedules.rs','g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)')
        teacher_query=literal_containing('teachers.rs','WHERE t.deleted_at IS NULL AND (?1 IS NULL OR COALESCE(t.status')
        teacher_filter=teacher_query[teacher_query.index('WHERE'):].split('ORDER BY')[0]
        expense=literal_containing('expenses.rs','{SELECT_EXPENSE} WHERE deleted_at IS NULL AND school_year_id=')
        expense=expense.replace('{SELECT_EXPENSE}', 'SELECT id FROM monthly_expenses')
        payment_filter=literal_containing('payments.rs','WHERE (p.school_year_id=(SELECT id FROM school_years')
        def counts():
            return (
                db.execute('SELECT COUNT(*) FROM students s WHERE s.deleted_at IS NULL AND '+student_filter).fetchone()[0],
                db.execute('SELECT COUNT(*) FROM groups g WHERE '+group_filter).fetchone()[0],
                db.execute('SELECT COUNT(*) FROM group_schedules gs JOIN groups g ON g.id=gs.group_id WHERE '+timetable_filter).fetchone()[0],
                db.execute('SELECT COUNT(*) FROM teachers t '+teacher_filter,(None,)).fetchone()[0],
                db.execute(expense,(9,2024,'rent')).fetchall().__len__(),
                db.execute('SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id '+payment_filter,(None,None,None)).fetchone()[0],
            )
        self.assertEqual(counts(),(2,1,2,2,1,1))
        db.execute('UPDATE school_years SET is_active=(id=2)')
        self.assertEqual(counts(),(0,0,0,0,0,0))
        db.execute('UPDATE school_years SET is_active=(id=1)')
        self.assertEqual(counts(),(2,1,2,2,1,1))
if __name__=='__main__': unittest.main()
