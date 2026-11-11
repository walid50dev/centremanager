"""Exercise the new columns on the legacy bundled DB with the actual migration SQL."""
import re, shutil, sqlite3, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

class UXMigration(unittest.TestCase):
    def test_custom_fee_migration_and_monthly_query_preserve_existing_invoices(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.db'
            shutil.copyfile(ROOT / 'test-data/centremanager-charge.db', path)
            db = sqlite3.connect(path)
            rust = (ROOT / 'src-tauri/src/db/mod.rs').read_text()
            block = rust.split('if !column_exists(conn, "enrollments", "custom_monthly_fee_cents")?', 1)[1]
            migration = re.search(r'conn.execute_batch\("(.*?)"\)', block, re.S).group(1)
            before = db.execute('select id, amount_cents from invoices order by id').fetchall()
            db.executescript(migration)
            self.assertEqual(before, db.execute('select id, amount_cents from invoices order by id').fetchall())
            row = db.execute("select e.id, g.monthly_fee_cents from enrollments e join groups g on g.id=e.group_id where e.status='actif' limit 1").fetchone()
            enrollment, default = row
            db.execute('update enrollments set custom_monthly_fee_cents=12345 where id=?', (enrollment,))
            source = (ROOT / 'src-tauri/src/commands/invoices.rs').read_text()
            query = re.search(r'"(SELECT e.id, e.start_date, COALESCE\(e.custom_monthly_fee_cents, g.monthly_fee_cents\).*?ORDER BY e.id)"', source, re.S).group(1)
            values = {item[0]: item[2] for item in db.execute(query)}
            self.assertEqual(values[enrollment], 12345)
            db.execute('update enrollments set custom_monthly_fee_cents=NULL where id=?', (enrollment,))
            self.assertEqual({item[0]: item[2] for item in db.execute(query)}[enrollment], default)
            self.assertEqual(before, db.execute('select id, amount_cents from invoices order by id').fetchall())
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('update enrollments set custom_monthly_fee_cents=-1 where id=?', (enrollment,))
            db.close()

    def test_legacy_fee_room_name_and_group_year_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.db'
            shutil.copyfile(ROOT / 'test-data/centremanager-charge.db', path)
            db = sqlite3.connect(path)
            rust = (ROOT / 'src-tauri/src/db/mod.rs').read_text()
            for col in ('enrollment_fee_cents', 'room', 'name'):
                block = rust.split(f'if !column_exists(conn, "{ "students" if col == "enrollment_fee_cents" else "group_schedules" if col == "room" else "groups" }", "{col}")?', 1)[1]
                sql = re.search(r'conn.execute_batch\("(.*?)"\)', block, re.S).group(1)
                db.executescript(sql)
            self.assertEqual(db.execute('select count(*) from students where enrollment_fee_cents>0').fetchone()[0], 180)
            group = db.execute('select id from groups limit 1').fetchone()[0]
            db.execute('update groups set name=? where id=?', ('Groupe Atlas', group))
            db.execute('update group_schedules set room=? where group_id=?', ('Salle X', group))
            # The same SQL used for copying a group and its slots into another year.
            source = (ROOT / 'src-tauri/src/commands/year_import.rs').read_text()
            statements = re.findall(r'tx.execute\("(.*?)"', source, re.S)
            copy_group = next(s for s in statements if s.startswith('INSERT INTO groups '))
            copy_slots = next(s for s in statements if s.startswith('INSERT INTO group_schedules '))
            db.execute('update school_years set is_active=0'); db.execute('update school_years set is_active=1 where id=2')
            db.execute(copy_group, (group, 2)); copied = db.execute('select last_insert_rowid()').fetchone()[0]
            db.execute(copy_slots, (group, copied))
            self.assertEqual(db.execute('select name from groups where id=?', (copied,)).fetchone()[0], 'Groupe Atlas')
            self.assertEqual(db.execute('select room from group_schedules where group_id=? limit 1', (copied,)).fetchone()[0], 'Salle X')
            self.assertEqual(db.execute('pragma foreign_key_check').fetchall(), [])
            self.assertEqual(db.execute('pragma integrity_check').fetchone()[0], 'ok')
            db.close()
if __name__ == '__main__': unittest.main()
