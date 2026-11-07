#!/usr/bin/env python3
"""Create a NEW, isolated CentreManager SQLite load-test database.

Never opens, clears or overwrites an existing DB. Run after npm ci:
    python3 scripts/create-load-test-db.py --output /path/to/new-test.db
"""
import argparse, json, os, re, sqlite3, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def create(path, input_json=None):
    # Exclusive creation is a hard guard against destroying real data.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600); os.close(fd)
    try:
        data=json.loads(Path(input_json).read_text() if input_json else subprocess.check_output(['node', str(ROOT/'scripts/export-load-test-json.mjs')],cwd=ROOT,text=True))
        conn=sqlite3.connect(path)
        try:
            conn.executescript((ROOT/'src-tauri/src/db/schema.sql').read_text())
            conn.execute('ALTER TABLE monthly_expenses ADD COLUMN school_year_id INTEGER REFERENCES school_years(id)')
            conn.execute('ALTER TABLE payments ADD COLUMN school_year_id INTEGER REFERENCES school_years(id)')
            # Reuse the application's actual membership/trigger migrations.
            rust=(ROOT/'src-tauri/src/db/mod.rs').read_text()
            part=rust.split('fn migrate_school_year_membership',1)[1].split('fn migrate_teacher_year_trash',1)[0]
            blocks=re.findall(r'r#"(.*?)"#',part,re.S)
            conn.executescript(blocks[0]); conn.execute('ALTER TABLE teacher_school_years ADD COLUMN deleted_at TEXT')
            conn.executescript(blocks[2])
            # Fill only existing schema columns; joined display labels remain in reference tables.
            def insert(table,row):
                cols={r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
                values={k:v for k,v in row.items() if k in cols}
                names=','.join(values); placeholders=','.join('?' for _ in values)
                conn.execute(f'INSERT INTO {table} ({names}) VALUES ({placeholders})',list(values.values()))
            for table,key in [('school_years','schoolYears'),('levels','levels'),('branches','branches'),('subjects','subjects')]:
                for row in data[key]: insert(table,row)
            for key,value in data['settings'].items():
                if key != 'admin_password_hash': conn.execute('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',(key,str(value)))
            conn.executemany('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',[('reference_data_seeded','1'),('school_year_membership_migrated','1')])
            for row in data['students']: insert('students',row)
            for row in data['teachers']:
                insert('teachers',row)
                conn.executemany('INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES(?,?)',[(row['id'],s) for s in row['subject_ids']])
            for row in data['groups']:
                insert('groups',row)
                for slot in row['schedules']: insert('group_schedules',{**slot,'group_id':row['id']})
            for row in data['enrollments']: insert('enrollments',row)
            for row in data['invoices']:
                insert('invoices',row)
                if row.get('fee_student_id'):
                    conn.execute('INSERT INTO enrollment_fees(student_id,school_year_id,amount,invoice_id) VALUES(?,?,?,?)',(row['fee_student_id'],row['fee_school_year_id'],row['amount_cents'],row['id']))
            conn.executemany('INSERT OR IGNORE INTO enrollment_fee_attempts(student_id,school_year_id) VALUES(?,?)',[(int(k.split(':')[0]),int(k.split(':')[1])) for k in data['feeHandledYears']])
            for row in data['payments']: insert('payments',row)
            for row in data['teacherSettlements']: insert('teacher_settlements',row)
            for row in data['expenses']: insert('monthly_expenses',{**row,'school_year_id':data['expenseYears'][str(row['id'])]})
            # Install the same payment ownership trigger used by the application.
            payment_part=rust.split('fn migrate_payment_school_year',1)[1].split('/// Columns introduced',1)[0]
            conn.executescript(re.findall(r'r#"(.*?)"#',payment_part,re.S)[0])
            conn.commit()
            errors=conn.execute('PRAGMA foreign_key_check').fetchall()
            if errors: raise ValueError(f'Foreign-key errors: {errors[:5]}')
            if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('SQLite integrity check failed')
            print(f"Created isolated database: {path}\n200 students, 14 groups, 6 teachers, {len(data['enrollments'])} enrollments, {len(data['invoices'])} invoices, {len(data['payments'])} payments.")
        finally: conn.close()
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,help='New SQLite file; existing files are never overwritten')
    parser.add_argument('--input-json',help='Use an existing exported fixture so browser and SQLite data match')
    args=parser.parse_args()
    try: create(args.output, args.input_json)
    except (OSError,ValueError,sqlite3.Error,subprocess.CalledProcessError) as e:
        print(f'Failed: {e}',file=sys.stderr); sys.exit(1)
