import re, shutil, sqlite3, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
class ResetTest(unittest.TestCase):
    def test_targeted_historical_invoice_sql_is_scoped_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'copy.db'; shutil.copyfile(ROOT/'test-data/centremanager-charge.db',file)
            db=sqlite3.connect(file); db.execute('PRAGMA foreign_keys=ON')
            db.execute('ALTER TABLE enrollments ADD COLUMN custom_monthly_fee_cents INTEGER CHECK(custom_monthly_fee_cents >= 0)')
            source=(ROOT/'src-tauri/src/commands/invoices.rs').read_text().split('pub fn generate_student_month',1)[1].split('#[tauri::command]',1)[0]
            query=re.search(r'tx.prepare\("(SELECT e.id, e.start_date, COALESCE.*?)"\)',source,re.S).group(1)
            insert=re.search(r'tx.execute\("(INSERT OR IGNORE INTO invoices .*?)"',source,re.S).group(1)
            student=db.execute('select student_id from enrollments limit 1').fetchone()[0]
            rows=db.execute(query,(student,'2027-02-28','2027-02-01')).fetchall()
            self.assertTrue(rows)
            eid,start,fee=rows[0]
            db.execute('update enrollments set custom_monthly_fee_cents=12345 where id=?',(eid,))
            self.assertEqual(next(r[2] for r in db.execute(query,(student,'2027-02-28','2027-02-01')) if r[0]==eid),12345)
            db.execute(insert,(eid,2,2027,12345,'2027-02-01'))
            self.assertEqual(db.execute(insert,(eid,2,2027,99999,'2027-02-01')).rowcount,0)
            self.assertEqual(db.execute('select amount_cents from invoices where enrollment_id=? and period_month=2 and period_year=2027',(eid,)).fetchone()[0],12345)
            db.close()

    def test_reset_real_sql_with_foreign_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'copy.db'; shutil.copyfile(ROOT/'test-data/centremanager-charge.db',file)
            db=sqlite3.connect(file); db.execute('PRAGMA foreign_keys=ON')
            schema=(ROOT/'src-tauri/src/db/schema.sql').read_text()
            db.execute(re.search(r'CREATE TABLE IF NOT EXISTS absences \(.*?\);',schema,re.S).group(0))
            student,group=db.execute('SELECT student_id,group_id FROM enrollments LIMIT 1').fetchone()
            db.execute("INSERT INTO absences(student_id,group_id,absence_date) VALUES(?,?,'2026-01-01')",(student,group)); db.commit()
            before=db.execute('select count(*) from students').fetchone()[0]; self.assertGreater(before,0)
            settings=db.execute('select count(*) from settings').fetchone()[0]
            source=(ROOT/'src-tauri/src/commands/settings.rs').read_text()
            block=source.split('pub fn reset_operational_data',1)[1]
            sql=re.search(r'tx.execute_batch\(r#"(.*?)"#\)',block,re.S).group(1)
            db.executescript('BEGIN;'+sql+'COMMIT;')
            for table in ('absences','students','groups','teachers','enrollments','invoices','payments','receipts','teacher_activities','teacher_compensation','teacher_settlements','monthly_expenses','audit_log','enrollment_fees','enrollment_fee_attempts','group_schedules','student_school_years','teacher_school_years','group_year_imports','teacher_subjects'):
                self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0],0,table)
            self.assertGreater(db.execute('select count(*) from levels').fetchone()[0],0)
            self.assertEqual(db.execute('select count(*) from settings').fetchone()[0],settings)
            self.assertEqual(db.execute('pragma foreign_key_check').fetchall(),[])
            self.assertEqual(db.execute('pragma integrity_check').fetchone()[0],'ok')
            db.close()
if __name__ == '__main__': unittest.main()
