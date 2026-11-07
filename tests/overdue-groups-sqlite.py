"""Run production alert joins and fee fallback SQL against a real SQLite DB."""
import importlib.util, re, unittest
from pathlib import Path
here = Path(__file__).parent
spec = importlib.util.spec_from_file_location('fixture', here / 'year-import-sqlite.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
source = (here.parent / 'src-tauri/src/commands/invoices.rs').read_text()
def literal(fragment):
    return next(s for s in re.findall(r'"((?:[^"\\]|\\.)*)"',source,re.S) if fragment in s)

class OverdueGroups(unittest.TestCase):
    def setUp(self):
        fixture=base.YearImportTests(); fixture.setUp(); self.db=fixture.db
    def test_fallback_and_year_boundaries(self):
        db=self.db
        db.executescript("""
          INSERT INTO subjects(id,name) VALUES(1,'Mathématiques'),(2,'Physique'),(3,'Autre année');
          INSERT INTO levels(id,name,category) VALUES(1,'Tronc Commun','lycee');
          UPDATE groups SET subject_id=1,level_id=1 WHERE id=1;
          INSERT INTO groups(id,subject_id,level_id,school_year_id,monthly_fee_cents,capacity) VALUES
            (2,2,1,1,100,10),(3,3,1,2,100,10),(4,3,1,1,100,10);
          INSERT INTO enrollments(student_id,group_id,start_date,status) VALUES
            (1,2,'2024-09-01','actif'),(1,3,'2025-09-01','actif'),(1,4,'2024-09-01','terminé');
          INSERT INTO invoices(id,period_month,period_year,amount_cents,due_date) VALUES(20,8,2024,100,'2024-08-01');
          INSERT INTO enrollment_fees(student_id,school_year_id,amount,invoice_id) VALUES(1,1,100,20);
        """)
        alert=literal('SELECT s.id,\n                    s.full_name,')
        rows=db.execute(alert,(8,2024)).fetchall()
        self.assertEqual(len(rows),1); self.assertEqual(rows[0][3:5],('',''))
        fallback=literal('SELECT DISTINCT TRIM(COALESCE(su.name')
        self.assertEqual([r[0] for r in db.execute(fallback,(1,))],['Mathématiques Tronc Commun','Physique Tronc Commun'])
        db.execute('UPDATE groups SET deleted_at=\'2024-11-01\' WHERE id=2')
        self.assertEqual([r[0] for r in db.execute(fallback,(1,))],['Mathématiques Tronc Commun'])
        db.execute('UPDATE school_years SET is_active=(id=2)')
        self.assertEqual(db.execute(alert,(8,2024)).fetchall(),[])
        self.assertEqual([r[0] for r in db.execute(fallback,(1,))],['Autre année Tronc Commun'])
if __name__=='__main__': unittest.main()
