"""Create and validate an isolated load-test SQLite DB; never touch a live DB."""
import datetime, re, sqlite3, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Fixture(unittest.TestCase):
    def test_fixture_and_overwrite_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fixture.db'
            cmd=[sys.executable,str(ROOT/'scripts/create-load-test-db.py'),'--output',str(path)]
            subprocess.run(cmd,cwd=ROOT,check=True,capture_output=True,text=True)
            db=sqlite3.connect(path)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(),('ok',))
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
            for table,count in [('students',200),('groups',14),('teachers',6),('enrollments',300),('enrollment_fees',180),('teacher_settlements',6),('monthly_expenses',12),('student_school_years',200)]:
                self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0],count,table)
            self.assertEqual(db.execute('SELECT count(DISTINCT full_name) FROM students').fetchone()[0],200)
            self.assertEqual(db.execute('SELECT count(*) FROM payments WHERE school_year_id IS NULL').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_schedules s WHERE s.group_id=g.id)').fetchone()[0],2)
            self.assertEqual(db.execute("SELECT count(*) FROM settings WHERE key='admin_password_hash'").fetchone()[0],0,'desktop setup creates its own password')
            # Every invoice's recorded paid amount must agree with payment rows.
            self.assertEqual(db.execute('SELECT count(*) FROM invoices i WHERE i.paid_amount_cents != (SELECT COALESCE(sum(p.amount_cents),0) FROM payments p WHERE p.invoice_id=i.id)').fetchone()[0],0)
            now=datetime.date.today()
            statuses=db.execute('''SELECT s.id, MIN(i.status), MAX(i.status) FROM students s JOIN enrollments e ON e.student_id=s.id JOIN invoices i ON i.enrollment_id=e.id WHERE i.period_month=? AND i.period_year=? GROUP BY s.id''',(now.month,now.year)).fetchall()
            self.assertEqual(len(statuses),200)
            counts={k:0 for k in ['payé','partiel','impayé']}
            for _,low,high in statuses: self.assertEqual(low,high); counts[low]+=1
            self.assertEqual(counts,{'payé':140,'partiel':30,'impayé':30})
            # The actual dashboard SQL sees the same active-year counts and money.
            source=(ROOT/'src-tauri/src/commands/dashboard.rs').read_text()
            strings=re.findall(r'"((?:[^"\\]|\\.)*)"',source,re.S)
            def sql(fragment): return next(s for s in strings if fragment in s)
            self.assertEqual(db.execute(sql("SELECT COUNT(*) FROM students WHERE deleted_at IS NULL")).fetchone()[0],200)
            self.assertEqual(db.execute(sql("SELECT COUNT(*) FROM groups WHERE deleted_at IS NULL")).fetchone()[0],14)
            self.assertEqual(db.execute(sql("SELECT COUNT(*) FROM teachers WHERE deleted_at IS NULL")).fetchone()[0],6)
            self.assertGreater(db.execute(sql('SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p'),(now.month,now.year)).fetchone()[0],0)
            db.execute('UPDATE school_years SET is_active=(id=2)')
            self.assertEqual(db.execute(sql("SELECT COUNT(*) FROM students WHERE deleted_at IS NULL")).fetchone()[0],0)
            self.assertEqual(db.execute(sql('SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p'),(now.month,now.year)).fetchone()[0],0)
            db.close()
            size=path.stat().st_size
            result=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0); self.assertEqual(path.stat().st_size,size,'existing file was not changed')
if __name__=='__main__': unittest.main()
