"""Run actual export SQL against a representative in-memory SQLite database."""
import importlib.util
import re
import unittest
from pathlib import Path
here = Path(__file__).parent
spec = importlib.util.spec_from_file_location('year_import_sqlite', here / 'year-import-sqlite.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
source = (here.parent / 'src-tauri/src/commands/year_export.rs').read_text()
strings = re.findall(r'"((?:[^"\\]|\\.)*)"', source, re.S)
def sql(fragment): return next(s for s in strings if fragment in s)
class ExportTests(base.YearImportTests):
    def test_summary_and_section_queries(self):
        db = self.db
        db.execute("INSERT INTO invoices (enrollment_id,amount_cents) VALUES (1,10000)")
        db.execute("INSERT INTO payments (student_id,invoice_id,amount_cents) VALUES (1,1,8000)")
        db.execute("INSERT INTO teacher_settlements (teacher_id,amount_cents,month,year) VALUES (1,2000,9,2024)")
        queries = {
            'students': 'SELECT count(*) FROM student_school_years',
            'groups': 'SELECT count(*) FROM groups WHERE school_year_id',
            'teachers': 'SELECT count(*) FROM teachers t WHERE',
            'revenue': 'SELECT COALESCE(sum(p.amount_cents),0)',
            'expenses': 'SELECT COALESCE(sum(amount_cents),0) FROM monthly_expenses',
            'salaries': 'SELECT COALESCE(sum(ts.amount_cents),0)',
        }
        values = {key:db.execute(sql(fragment),(1,)).fetchone()[0] for key,fragment in queries.items()}
        self.assertEqual(values, {'students':2, 'groups':1, 'teachers':2, 'revenue':8000, 'expenses':1000, 'salaries':2000})
        subject = db.execute(sql("SELECT COALESCE(s.name,'—'), COUNT(DISTINCT e.student_id)"),(1,)).fetchall()
        self.assertEqual(subject[0][1:], (1,8000))
        for section in ['students','groups','teachers','payments','expenses','salaries']:
            match = re.search(r'"' + section + r'" => "(.*?)",', source, re.S)
            self.assertIsNotNone(match, section)
            result = db.execute(match.group(1), (1,))
            self.assertTrue(result.description)
            self.assertTrue(result.fetchall(), section)
        rows = db.execute(re.search(r'"students" => "(.*?)",',source,re.S).group(1), (1,))
        self.assertIn('full_name',[item[0] for item in rows.description])

    def test_revenue_counts_advance_in_its_attributed_year(self):
        db = self.db
        db.execute("INSERT INTO invoices (id,enrollment_id,amount_cents) VALUES (1,1,5000)")
        db.execute("INSERT INTO payments (id,student_id,invoice_id,amount_cents,batch_id) VALUES (1,1,1,5000,1)")
        db.execute("INSERT INTO payments (id,student_id,invoice_id,amount_cents,batch_id) VALUES (2,1,NULL,2000,1)")
        base.migrate(db)
        self.assertEqual(db.execute(sql('SELECT COALESCE(sum(p.amount_cents),0)'), (1,)).fetchone()[0], 7000)
        self.assertEqual(db.execute(sql('SELECT COALESCE(sum(p.amount_cents),0)'), (2,)).fetchone()[0], 0)

if __name__ == '__main__': unittest.main()
