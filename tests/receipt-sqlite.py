# Run: python3 tests/receipt-sqlite.py
"""Exercise the new receipt SQL and legacy column upgrade without Rust tooling."""
import re
import sqlite3
from pathlib import Path

schema = Path('src-tauri/src/db/schema.sql').read_text()
# Model a database created before the new migration.
legacy = schema.replace('    batch_id       INTEGER,\n', '').replace('    student_level  TEXT,\n    items_json     TEXT,\n', '')
conn = sqlite3.connect(':memory:')
conn.executescript(legacy)
conn.executescript('''
INSERT INTO students(id,full_name,level_id) VALUES(1,'Salma',NULL);
INSERT INTO levels(id,name,sort_order) VALUES(1,'2Bac',1);
INSERT INTO subjects(id,name) VALUES(1,'Maths');
INSERT INTO groups(id,subject_id,level_id,monthly_fee_cents,capacity) VALUES(1,1,1,40000,10);
INSERT INTO enrollments(id,student_id,group_id,start_date) VALUES(1,1,1,'2025-11-01');
INSERT INTO invoices(id,enrollment_id,period_month,period_year,amount_cents) VALUES(1,1,11,2025,40000);
INSERT INTO payments(id,student_id,invoice_id,amount_cents,created_at) VALUES
 (1,1,1,10000,'2025-11-01 12:00:00'), (2,1,1,5000,'2025-11-01 12:00:00');
INSERT INTO receipts(id,payment_id,receipt_number,amount_cents) VALUES(1,1,'OLD',10000);
INSERT INTO audit_log(action,entity_type,entity_id) VALUES('PAYMENT','payment',1),('PAYMENT','payment',2);
''')
for table, col, ty in [('payments', 'batch_id', 'INTEGER'), ('receipts', 'student_level', 'TEXT'), ('receipts', 'items_json', 'TEXT')]:
    if col not in [row[1] for row in conn.execute(f'PRAGMA table_info({table})')]:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {col} {ty}')
assert conn.execute('SELECT amount_cents FROM payments ORDER BY id').fetchall() == [(10000,), (5000,)]
assert conn.execute('SELECT receipt_number FROM receipts').fetchone() == ('OLD',)
source = Path('src-tauri/src/commands/payments.rs').read_text()
session_sql = re.search(r'conn\.prepare\("(SELECT p\.id FROM payments p JOIN payments base.*?ORDER BY p\.id)"\)', source, re.S).group(1)
assert conn.execute(session_sql, (1, 1, '2025-11-01 12:00:00')).fetchall() == [(1,)]
assert conn.execute(session_sql, (2, 1, '2025-11-01 12:00:00')).fetchall() == [(2,)]
items_sql = re.search(r'"(SELECT p\.amount_cents, p\.invoice_id, COALESCE\(s\.name,\x27\x27\).*?WHERE p\.id=\?1)"', source, re.S).group(1)
assert conn.execute(items_sql, (1,)).fetchone() == (10000, 1, 'Maths', '2Bac', '', 11, 2025, None, '')
conn.execute("UPDATE groups SET deleted_at='2026-01-01' WHERE id=1")
assert conn.execute(items_sql, (1,)).fetchone()[2] == 'Maths', 'financial history survives trash'
assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
print('Receipt SQLite: legacy column upgrade, audit boundaries, allocation joins and trash history passed')
