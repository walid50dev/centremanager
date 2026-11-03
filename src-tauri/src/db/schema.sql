-- ---------------------------------------------------------------------------
-- CentreManager — SQLite schema (17 tables)
-- Executed on every launch by db::run_migrations(); every statement is
-- idempotent thanks to IF NOT EXISTS.
-- All monetary values are stored as INTEGER centimes (1 DH = 100 centimes).
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- 1. settings — key/value application settings (center name, currency, ...)
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
);

-- 2. school_years — academic years, exactly one active at a time
CREATE TABLE IF NOT EXISTS school_years (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT UNIQUE,
    start_date  TEXT,
    end_date    TEXT,
    is_active   BOOLEAN DEFAULT 0
);

-- 3. levels — school levels (primaire, collège, lycée...)
CREATE TABLE IF NOT EXISTS levels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    sort_order  INTEGER,
    category    TEXT
);

-- 4. branches — level sub-branches (e.g. "2ème année Bac SVT")
CREATE TABLE IF NOT EXISTS branches (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT,
    level_id  INTEGER REFERENCES levels(id) ON DELETE SET NULL
);

-- 5. subjects — subjects taught in the center
CREATE TABLE IF NOT EXISTS subjects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT,
    is_active  BOOLEAN DEFAULT 1
);

-- 6. students
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    birth_date TEXT,
    phone TEXT,
    guardian_name TEXT,
    guardian_phone TEXT,
    guardian_relation TEXT,
    secondary_contact_name TEXT,
    secondary_contact_phone TEXT,
    school_name TEXT,
    enrollment_date TEXT NOT NULL DEFAULT (date('now')),
    level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    address TEXT,
    notes TEXT,
    status TEXT DEFAULT 'actif',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
);

-- 7. teachers
CREATE TABLE IF NOT EXISTS teachers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name  TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    photo      TEXT,
    notes      TEXT,
    status     TEXT DEFAULT 'actif',
    -- Phase 6: payroll configuration. `value_cents` is an amount for the three
    -- amount-based modes and a percentage × 100 for `percentage` (40% = 4000).
    compensation_mode        TEXT,
    compensation_value_cents INTEGER,
    bonus_pct                REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
);

-- 8. teacher_subjects — n:n teachers <-> subjects
CREATE TABLE IF NOT EXISTS teacher_subjects (
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (teacher_id, subject_id)
);

-- 9. groups — a scheduled class
CREATE TABLE IF NOT EXISTS groups (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id        INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    level_id          INTEGER REFERENCES levels(id) ON DELETE SET NULL,
    branch_id         INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    teacher_id        INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    school_year_id    INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
    day_of_week       TEXT,
    start_time        TEXT,
    end_time          TEXT,
    room              TEXT,
    monthly_fee_cents INTEGER NOT NULL,
    capacity          INTEGER NOT NULL,
    status            TEXT DEFAULT 'actif',
    deleted_at        TEXT
);

-- 10. enrollments — students enrolled in groups
CREATE TABLE IF NOT EXISTS enrollments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date   TEXT,
    status     TEXT DEFAULT 'actif',
    UNIQUE (student_id, group_id)
);

-- 11. invoices — one monthly invoice per enrollment
CREATE TABLE IF NOT EXISTS invoices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id     INTEGER REFERENCES enrollments(id) ON DELETE CASCADE,
    period_month      INTEGER,
    period_year       INTEGER,
    amount_cents      INTEGER NOT NULL,
    paid_amount_cents INTEGER DEFAULT 0,
    status            TEXT DEFAULT 'impayé',
    due_date          TEXT,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, period_month, period_year)
);

-- 12. payments
CREATE TABLE IF NOT EXISTS payments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER REFERENCES students(id) ON DELETE CASCADE,
    invoice_id     INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    amount_cents   INTEGER NOT NULL,
    payment_method TEXT,
    notes          TEXT,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 13. receipts — printable receipt snapshot (immutable)
CREATE TABLE IF NOT EXISTS receipts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id     INTEGER REFERENCES payments(id) ON DELETE CASCADE,
    receipt_number TEXT UNIQUE,
    student_name   TEXT,
    amount_cents   INTEGER,
    payment_date   TEXT,
    groups_text    TEXT,
    center_name    TEXT,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 14. teacher_activities — hours/sessions log used for compensation
CREATE TABLE IF NOT EXISTS teacher_activities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id    INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    activity_date TEXT,
    activity_type TEXT,
    hours         REAL,
    sessions      INTEGER,
    notes         TEXT
);

-- 15. teacher_compensation — monthly payroll per teacher
CREATE TABLE IF NOT EXISTS teacher_compensation (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id         INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    month              INTEGER,
    year               INTEGER,
    mode               TEXT,
    base_amount_cents  INTEGER,
    bonus_amount_cents INTEGER DEFAULT 0,
    total_amount_cents INTEGER,
    status             TEXT DEFAULT 'pending',
    UNIQUE (teacher_id, month, year)
);

-- 16. teacher_settlements — actual payments to teachers
CREATE TABLE IF NOT EXISTS teacher_settlements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id      INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    compensation_id INTEGER REFERENCES teacher_compensation(id) ON DELETE SET NULL,
    amount_cents    INTEGER,
    payment_method  TEXT,
    notes           TEXT,
    -- Phase 6: the payroll period the settlement belongs to, so a September
    -- salary paid in October is still counted in September.
    month           INTEGER,
    year            INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 17. audit_log — traceability of every mutation
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT,
    entity_type TEXT,
    entity_id   INTEGER,
    details     TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 18. monthly_expenses — the charges the centre pays every month (Phase 11)
-- Unlike invoices/payments these are internal bookkeeping, so they can be
-- edited and deleted; the audit trail keeps a copy of every deleted row.
CREATE TABLE IF NOT EXISTS monthly_expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    label        TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    category     TEXT NOT NULL,
    month        INTEGER NOT NULL,
    year         INTEGER NOT NULL,
    notes        TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at   TEXT
);


-- 19. group_schedules — the weekly slots of a group (Phase 13)
-- A group used to carry one day (`groups.day_of_week` + start/end). It now can
-- meet several times a week, each day with its own hours. The legacy columns on
-- `groups` stay (V1 never drops a column) and are kept in sync with the FIRST
-- schedule row so any old code path still reads something sensible.
CREATE TABLE IF NOT EXISTS group_schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL,
    start_time  TEXT NOT NULL,
    end_time    TEXT NOT NULL,
    UNIQUE (group_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- Indexes on foreign keys / frequent lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_students_level       ON students(level_id);
CREATE INDEX IF NOT EXISTS idx_students_branch      ON students(branch_id);
CREATE INDEX IF NOT EXISTS idx_students_name        ON students(full_name);
CREATE INDEX IF NOT EXISTS idx_students_status      ON students(status);
CREATE INDEX IF NOT EXISTS idx_branches_level       ON branches(level_id);
CREATE INDEX IF NOT EXISTS idx_groups_teacher       ON groups(teacher_id);
CREATE INDEX IF NOT EXISTS idx_groups_subject       ON groups(subject_id);
CREATE INDEX IF NOT EXISTS idx_groups_school_year   ON groups(school_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student  ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_group    ON enrollments(group_id);
CREATE INDEX IF NOT EXISTS idx_invoices_enrollment  ON invoices(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_student     ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice     ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment     ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_activities_teacher   ON teacher_activities(teacher_id);
CREATE INDEX IF NOT EXISTS idx_compensation_teacher ON teacher_compensation(teacher_id);
CREATE INDEX IF NOT EXISTS idx_settlements_teacher  ON teacher_settlements(teacher_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity         ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_expenses_month_year ON monthly_expenses(month, year);
CREATE INDEX IF NOT EXISTS idx_expenses_category   ON monthly_expenses(category);
CREATE INDEX IF NOT EXISTS idx_schedules_group     ON group_schedules(group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_day       ON group_schedules(day_of_week);
