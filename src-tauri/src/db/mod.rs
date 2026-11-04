//! SQLite access layer.
//!
//! The database lives in the platform app-data directory, e.g. on Windows:
//! `%APPDATA%\com.centremanager.app\centremanager.db` (V1.1; the V1.0 folder
//! `ma.centremanager.desktop` is migrated on first start, see
//! `migrate_legacy_data_dir`).
//!
//! Connections are opened with WAL journalling, foreign keys enforced and a
//! 5 second busy timeout so concurrent writes do not fail immediately.

// `get_connection`, `db_path` and `table_names` are the entry points used by
// upcoming commands and by the smoke tests.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use rusqlite::Connection;

pub const DB_FILE_NAME: &str = "centremanager.db";

/// The schema is compiled into the binary, so a packaged app never has to ship
/// (or locate) a separate SQL file.
pub const SCHEMA_SQL: &str = include_str!("schema.sql");

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Holds the shared connection; managed by Tauri so commands can borrow it.
pub struct Db {
    connection: Mutex<Connection>,
}

impl Db {
    pub fn new(connection: Connection) -> Self {
        Self {
            connection: Mutex::new(connection),
        }
    }

    /// Lock the shared connection. Recovers from a poisoned mutex instead of
    /// panicking so a single failed command cannot take the app down.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Remember where the database lives (called once from `init_db`).
pub fn set_db_path(path: PathBuf) {
    let _ = DB_PATH.set(path);
}

/// Resolved database path, or the fallback used before `init_db` runs.
pub fn db_path() -> PathBuf {
    DB_PATH
        .get()
        .cloned()
        .unwrap_or_else(|| default_data_dir().join(DB_FILE_NAME))
}

/// Best-effort app-data directory when no `AppHandle` is available
/// (unit tests, CLI tools).
fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("ma.centremanager.desktop");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs_home() {
            return home
                .join("Library")
                .join("Application Support")
                .join("ma.centremanager.desktop");
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("ma.centremanager.desktop");
        }
        if let Some(home) = dirs_home() {
            return home
                .join(".local")
                .join("share")
                .join("ma.centremanager.desktop");
        }
    }

    std::env::temp_dir().join("ma.centremanager.desktop")
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Apply the connection pragmas required by the app.
fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    // `execute_batch` is used because `PRAGMA journal_mode` returns a row.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = NORMAL;",
    )?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    Ok(())
}

/// Open (creating if needed) a connection at an explicit path.
pub fn open_connection_at(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

/// Open a configured connection to `app_data_dir/centremanager.db`.
pub fn get_connection() -> rusqlite::Result<Connection> {
    open_connection_at(&db_path())
}

/// Execute `schema.sql`, then seed the reference data exactly once.
///
/// Every schema statement uses `IF NOT EXISTS`, so this is safe to run on every
/// launch; the seeder is guarded by the `reference_data_seeded` marker so user
/// edits (renamed levels, deleted branches, …) are never overwritten.
pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    // `schema.sql` only runs its `CREATE TABLE IF NOT EXISTS` statements on a
    // fresh database, so columns added by a later phase are patched in here.
    upgrade_phase6_columns(conn)?;
    upgrade_student_columns(conn)?;
    for table in ["students", "teachers", "groups", "monthly_expenses"] {
        if !column_exists(conn, table, "deleted_at")? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN deleted_at TEXT;"))?;
        }
    }
    for (table, column, kind) in [("payments", "batch_id", "INTEGER"), ("receipts", "student_level", "TEXT"), ("receipts", "items_json", "TEXT")] {
        if !column_exists(conn, table, column)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {kind};"))?;
        }
    }
    migrate_group_schedules(conn)?;
    seed_reference_data(conn)?;
    migrate_school_year_membership(conn)?;
    migrate_teacher_year_trash(conn)?;
    migrate_payment_school_year(conn)
}

/// Record year membership independently from enrollment. Imported (or newly
/// created) students and teachers must be visible before they join a group.
fn migrate_school_year_membership(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !column_exists(&tx, "monthly_expenses", "school_year_id")? {
        tx.execute_batch("ALTER TABLE monthly_expenses ADD COLUMN school_year_id INTEGER REFERENCES school_years(id);")?;
    }
    tx.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS student_school_years (
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
            PRIMARY KEY (student_id, school_year_id)
        );
        CREATE TABLE IF NOT EXISTS teacher_school_years (
            teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
            school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
            PRIMARY KEY (teacher_id, school_year_id)
        );
        CREATE TABLE IF NOT EXISTS group_year_imports (
            source_group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            target_school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
            imported_group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            PRIMARY KEY (source_group_id, target_school_year_id)
        );
    "#)?;
    let migrated: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings WHERE key = 'school_year_membership_migrated')", [], |r| r.get(0)
    )?;
    // Defer the legacy backfill until an active year exists. Marking it done
    // earlier would strand unassigned legacy rows permanently.
    let has_active_year: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM school_years WHERE is_active=1)", [], |r| r.get(0))?;
    if !migrated && has_active_year {
        tx.execute_batch(r#"
            INSERT OR IGNORE INTO student_school_years
              SELECT e.student_id, g.school_year_id FROM enrollments e JOIN groups g ON g.id=e.group_id
              WHERE e.student_id IS NOT NULL AND g.school_year_id IS NOT NULL;
            INSERT OR IGNORE INTO teacher_school_years (teacher_id, school_year_id)
              SELECT teacher_id, school_year_id FROM groups
              WHERE teacher_id IS NOT NULL AND school_year_id IS NOT NULL;
            INSERT OR IGNORE INTO student_school_years
              SELECT s.id, y.id FROM students s JOIN school_years y ON y.is_active=1
              WHERE NOT EXISTS (SELECT 1 FROM student_school_years sy WHERE sy.student_id=s.id);
            INSERT OR IGNORE INTO teacher_school_years (teacher_id, school_year_id)
              SELECT t.id, y.id FROM teachers t JOIN school_years y ON y.is_active=1
              WHERE NOT EXISTS (SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=t.id);
            UPDATE monthly_expenses SET school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)
              WHERE school_year_id IS NULL;
            INSERT INTO settings (key,value) VALUES ('school_year_membership_migrated','1');
        "#)?;
    }
    tx.execute_batch(r#"
        CREATE INDEX IF NOT EXISTS idx_expenses_school_year ON monthly_expenses(school_year_id);
        CREATE TRIGGER IF NOT EXISTS student_active_school_year AFTER INSERT ON students BEGIN
          INSERT OR IGNORE INTO student_school_years SELECT NEW.id, id FROM school_years WHERE is_active=1;
        END;
        DROP TRIGGER IF EXISTS teacher_active_school_year;
        CREATE TRIGGER teacher_active_school_year AFTER INSERT ON teachers BEGIN
          INSERT OR IGNORE INTO teacher_school_years (teacher_id, school_year_id) SELECT NEW.id, id FROM school_years WHERE is_active=1;
        END;
        CREATE TRIGGER IF NOT EXISTS enrollment_student_school_year AFTER INSERT ON enrollments BEGIN
          INSERT OR IGNORE INTO student_school_years SELECT NEW.student_id, school_year_id FROM groups
            WHERE id=NEW.group_id AND school_year_id IS NOT NULL AND NEW.student_id IS NOT NULL;
        END;
        CREATE TRIGGER IF NOT EXISTS expense_active_school_year AFTER INSERT ON monthly_expenses
          WHEN NEW.school_year_id IS NULL BEGIN
          UPDATE monthly_expenses SET school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) WHERE id=NEW.id;
        END;
    "#)?;
    tx.commit()
}

/// Move legacy global teacher deletion into each year membership. A teacher can
/// be trashed independently in each year without hiding other years.
fn migrate_teacher_year_trash(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !column_exists(&tx, "teacher_school_years", "deleted_at")? {
        tx.execute_batch("ALTER TABLE teacher_school_years ADD COLUMN deleted_at TEXT;")?;
    }
    tx.execute_batch(r#"
        INSERT OR IGNORE INTO teacher_school_years (teacher_id, school_year_id)
          SELECT teacher_id, school_year_id FROM groups
          WHERE teacher_id IS NOT NULL AND school_year_id IS NOT NULL;
        UPDATE teacher_school_years SET deleted_at=(SELECT t.deleted_at FROM teachers t WHERE t.id=teacher_id)
          WHERE EXISTS(SELECT 1 FROM teachers t WHERE t.id=teacher_id AND t.deleted_at IS NOT NULL)
            AND deleted_at IS NULL;
        UPDATE teachers SET deleted_at=NULL WHERE deleted_at IS NOT NULL
          AND EXISTS(SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=teachers.id);
    "#)?;
    tx.commit()
}

/// Attribute historical payments only when the invoice, batch or audit log
/// establishes one unambiguous school year. Unknown advances stay NULL rather
/// than being silently assigned to the wrong year.
fn migrate_payment_school_year(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !column_exists(&tx, "payments", "school_year_id")? {
        tx.execute_batch("ALTER TABLE payments ADD COLUMN school_year_id INTEGER REFERENCES school_years(id);")?;
    }
    tx.execute_batch(r#"
      UPDATE payments SET school_year_id=(SELECT g.school_year_id FROM invoices i
        JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id WHERE i.id=payments.invoice_id)
        WHERE school_year_id IS NULL AND invoice_id IS NOT NULL;
      UPDATE payments SET school_year_id=(SELECT MIN(other.school_year_id) FROM payments other
        WHERE other.batch_id=payments.batch_id AND other.school_year_id IS NOT NULL
        HAVING COUNT(DISTINCT other.school_year_id)=1)
        WHERE school_year_id IS NULL AND batch_id IS NOT NULL;
      WITH candidates AS (
        SELECT p.id AS payment_id, MIN(g.school_year_id) AS year_id, COUNT(DISTINCT g.school_year_id) AS year_count
        FROM payments p
        JOIN audit_log a ON a.action='PAYMENT' AND a.entity_type='payment' AND a.entity_id=(
          SELECT MAX(a2.entity_id) FROM audit_log a2 WHERE a2.action='PAYMENT' AND a2.entity_type='payment' AND a2.entity_id<=p.id)
        JOIN payments base ON base.id=a.entity_id AND base.student_id=p.student_id AND base.created_at=p.created_at
        JOIN json_each(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END, '$.invoice_ids') j
        JOIN invoices i ON i.id=j.value JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id
        WHERE p.school_year_id IS NULL AND g.school_year_id IS NOT NULL
        GROUP BY p.id
      )
      UPDATE payments SET school_year_id=(SELECT c.year_id FROM candidates c WHERE c.payment_id=payments.id AND c.year_count=1)
        WHERE school_year_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_payments_school_year ON payments(school_year_id);
      CREATE TRIGGER IF NOT EXISTS payment_invoice_school_year AFTER INSERT ON payments
      WHEN NEW.invoice_id IS NOT NULL AND NEW.school_year_id IS NULL BEGIN
        UPDATE payments SET school_year_id=(SELECT g.school_year_id FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id WHERE i.id=NEW.invoice_id) WHERE id=NEW.id;
      END;
    "#)?;
    tx.commit()
}

/// Columns introduced after a table was first created.
///
/// SQLite has no `ADD COLUMN IF NOT EXISTS`, so each column is checked against
/// `PRAGMA table_info` before the `ALTER TABLE`. This keeps the migration
/// idempotent on every launch.
const PHASE6_COLUMNS: [(&str, &str, &str); 5] = [
    ("teachers", "compensation_mode", "TEXT"),
    ("teachers", "compensation_value_cents", "INTEGER"),
    ("teachers", "bonus_pct", "REAL"),
    ("teacher_settlements", "month", "INTEGER"),
    ("teacher_settlements", "year", "INTEGER"),
];

fn upgrade_phase6_columns(conn: &Connection) -> rusqlite::Result<()> {
    for (table, column, sql_type) in PHASE6_COLUMNS {
        if !column_exists(conn, table, column)? {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {sql_type};"
            ))?;
        }
    }
    Ok(())
}

/// Rebuild legacy student tables atomically, preserving identifiers and references.
/// SQLite cannot add a column with a date expression default to a populated table.
fn upgrade_student_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols = ["first_name", "last_name", "birth_date", "guardian_name", "guardian_phone",
        "guardian_relation", "secondary_contact_name", "secondary_contact_phone", "school_name",
        "enrollment_date", "address"];
    let mut needs_upgrade = false;
    for col in cols { if !column_exists(conn, "students", col)? { needs_upgrade = true; } }
    for col in ["father_name", "home_address", "email", "date_of_birth", "parent_phone"] {
        if column_exists(conn, "students", col)? { needs_upgrade = true; }
    }
    if !needs_upgrade { return Ok(()); }
    let expr = |candidates: &[&str], fallback: &str| -> rusqlite::Result<String> {
        let mut found = Vec::new();
        for col in candidates { if column_exists(conn, "students", col)? { found.push(*col); } }
        if found.is_empty() { Ok(fallback.to_string()) }
        else { Ok(format!("COALESCE({}, {})", found.join(", "), fallback)) }
    };
    let first = expr(&["first_name"], "CASE WHEN instr(trim(full_name), ' ') > 0 THEN substr(trim(full_name), 1, instr(trim(full_name), ' ') - 1) ELSE trim(full_name) END")?;
    let last = expr(&["last_name"], "CASE WHEN instr(trim(full_name), ' ') > 0 THEN trim(substr(trim(full_name), instr(trim(full_name), ' ') + 1)) ELSE '' END")?;
    let birth = expr(&["birth_date", "date_of_birth"], "NULL")?;
    let guardian = expr(&["guardian_name", "father_name"], "NULL")?;
    let guardian_phone = expr(&["guardian_phone", "phone"], "NULL")?;
    let relation = expr(&["guardian_relation"], "NULL")?;
    let secondary_name = expr(&["secondary_contact_name"], "NULL")?;
    let secondary_phone = expr(&["secondary_contact_phone", "parent_phone"], "NULL")?;
    let school = expr(&["school_name"], "NULL")?;
    let enrollment = expr(&["enrollment_date"], "COALESCE(date(created_at), date('now'))")?;
    let address = expr(&["address", "home_address", "email"], "NULL")?;
    let deleted_at = expr(&["deleted_at"], "NULL")?;
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;")?;
    let result = conn.execute_batch(&format!(r#"
        CREATE TABLE students_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
            first_name TEXT, last_name TEXT, birth_date TEXT, phone TEXT,
            guardian_name TEXT, guardian_phone TEXT, guardian_relation TEXT,
            secondary_contact_name TEXT, secondary_contact_phone TEXT, school_name TEXT,
            enrollment_date TEXT NOT NULL DEFAULT (date('now')),
            level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
            branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
            address TEXT, notes TEXT, status TEXT DEFAULT 'actif',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
        );
        INSERT INTO students_new (id, full_name, first_name, last_name, birth_date, phone,
          guardian_name, guardian_phone, guardian_relation, secondary_contact_name, secondary_contact_phone,
          school_name, enrollment_date, level_id, branch_id, address, notes, status, created_at, updated_at, deleted_at)
        SELECT id, full_name, {first}, {last}, {birth}, {guardian_phone}, {guardian}, {guardian_phone},
          {relation}, {secondary_name}, {secondary_phone}, {school}, {enrollment}, level_id, branch_id,
          {address}, notes, status, created_at, updated_at, {deleted_at} FROM students;
        DROP TABLE students;
        ALTER TABLE students_new RENAME TO students;
        CREATE INDEX idx_students_level ON students(level_id);
        CREATE INDEX idx_students_branch ON students(branch_id);
        CREATE INDEX idx_students_name ON students(full_name);
        CREATE INDEX idx_students_status ON students(status);
        COMMIT;
    "#));
    if result.is_err() { let _ = conn.execute_batch("ROLLBACK;"); }
    if fk != 0 { conn.execute_batch("PRAGMA foreign_keys = ON;")?; }
    result
}

/// Phase 13 — a group can meet several times a week.
///
/// `schema.sql` creates `group_schedules`; this backfills it on an existing
/// database: when the table is still empty and groups already carry the legacy
/// single slot, that slot becomes the group's first (and only) row.
///
/// `INSERT OR IGNORE` because a half-migrated database may already hold some
/// rows — the `UNIQUE(group_id, day_of_week)` constraint makes it a no-op.
fn migrate_group_schedules(conn: &Connection) -> rusqlite::Result<()> {
    let existing: i64 =
        conn.query_row("SELECT COUNT(*) FROM group_schedules", [], |row| row.get(0))?;
    if existing > 0 {
        return Ok(());
    }
    conn.execute_batch(
        "INSERT OR IGNORE INTO group_schedules (group_id, day_of_week, start_time, end_time)
         SELECT id, day_of_week, start_time, end_time
         FROM groups
         WHERE day_of_week IS NOT NULL AND TRIM(day_of_week) <> ''
           AND start_time IS NOT NULL AND TRIM(start_time) <> ''
           AND end_time IS NOT NULL AND TRIM(end_time) <> '';",
    )
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Marker proving the reference data was already seeded on this database.
const SEED_MARKER_KEY: &str = "reference_data_seeded";

/// Levels shipped with a new database: (id, name, sort_order, category).
const SEED_LEVELS: [(i64, &str, i64, &str); 12] = [
    (1, "1ère année", 1, "primaire"),
    (2, "2ème année", 2, "primaire"),
    (3, "3ème année", 3, "primaire"),
    (4, "4ème année", 4, "primaire"),
    (5, "5ème année", 5, "primaire"),
    (6, "6ème année", 6, "primaire"),
    (7, "1ère année", 7, "college"),
    (8, "2ème année", 8, "college"),
    (9, "3ème année", 9, "college"),
    (10, "Tronc Commun", 10, "lycee"),
    (11, "1ère Bac", 11, "lycee"),
    (12, "2ème Bac", 12, "lycee"),
];

/// Branches attached to each lycée level.
const SEED_BRANCHES: [&str; 5] = [
    "Sciences Maths",
    "Sciences Expérimentales",
    "Sciences Économiques",
    "Lettres et Sciences Humaines",
    "Autre",
];

/// Subjects shipped with a new database.
const SEED_SUBJECTS: [&str; 10] = [
    "Mathématiques",
    "Physique-Chimie",
    "SVT",
    "Français",
    "Arabe",
    "Anglais",
    "Philosophie",
    "Histoire-Géographie",
    "Économie",
    "Informatique",
];

/// Seed levels, branches, subjects and the default school year.
///
/// Runs inside a transaction and only when the marker is absent, which keeps it
/// idempotent while still upgrading databases created by earlier phases (they
/// get the levels/branches and the missing subjects, and their legacy
/// "Sciences de la vie et de la terre" subject is renamed to "SVT").
fn seed_reference_data(conn: &Connection) -> rusqlite::Result<()> {
    use rusqlite::params;

    let already_seeded: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?1)",
        params![SEED_MARKER_KEY],
        |row| row.get(0),
    )?;
    if already_seeded {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;

    // --- Levels (only when the table is empty, e.g. a brand-new database) ---
    let level_count: i64 = tx.query_row("SELECT COUNT(*) FROM levels", [], |row| row.get(0))?;
    if level_count == 0 {
        for (id, name, sort_order, category) in SEED_LEVELS {
            tx.execute(
                "INSERT OR IGNORE INTO levels (id, name, sort_order, category)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, name, sort_order, category],
            )?;
        }
    }

    // --- Branches for every lycée level ---
    let branch_count: i64 = tx.query_row("SELECT COUNT(*) FROM branches", [], |row| row.get(0))?;
    if branch_count == 0 {
        for name in SEED_BRANCHES {
            tx.execute(
                "INSERT INTO branches (name, level_id)
                 SELECT ?1, l.id FROM levels l
                 WHERE l.category = 'lycee'
                   AND NOT EXISTS (
                       SELECT 1 FROM branches b WHERE b.name = ?1 AND b.level_id = l.id
                   )",
                params![name],
            )?;
        }
    }

    // --- Subjects (insert only what is missing, so renames are preserved) ---
    tx.execute(
        "UPDATE subjects SET name = 'SVT' WHERE name = 'Sciences de la vie et de la terre'",
        [],
    )?;
    for name in SEED_SUBJECTS {
        tx.execute(
            "INSERT INTO subjects (name, is_active)
             SELECT ?1, 1
             WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE name = ?1 COLLATE NOCASE)",
            params![name],
        )?;
    }

    // --- Default school year ---
    let year_count: i64 =
        tx.query_row("SELECT COUNT(*) FROM school_years", [], |row| row.get(0))?;
    if year_count == 0 {
        tx.execute(
            "INSERT INTO school_years (label, start_date, end_date, is_active)
             VALUES ('2024-2025', '2024-09-01', '2025-06-30', 1)",
            [],
        )?;
    }

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, '1')",
        params![SEED_MARKER_KEY],
    )?;

    tx.commit()
}

/// Identifier the V1.0 builds used, and therefore their app-data folder.
pub const LEGACY_IDENTIFIER: &str = "ma.centremanager.desktop";

/// Bring a V1.0 database forward when the identifier changed in V1.1.
///
/// `app_data_dir()` is derived from the identifier, so switching to
/// `com.centremanager.app` would otherwise strand the centre's data in the old
/// folder and greet the owner with a *setup* screen. When the new folder has no
/// database yet and the legacy one does, the files (main file + WAL + shared
/// memory) are **copied** — the old folder is left untouched, so the upgrade is
/// reversible and can be retried.
fn migrate_legacy_data_dir(app: &tauri::AppHandle, data_dir: &Path) -> Result<(), String> {
    use tauri::Manager;

    let target = data_dir.join(DB_FILE_NAME);
    if target.exists() {
        return Ok(());
    }

    let legacy_dir = app
        .path()
        .data_dir()
        .map_err(|err| format!("Impossible de résoudre le dossier de données : {err}"))?
        .join(LEGACY_IDENTIFIER);
    let legacy = legacy_dir.join(DB_FILE_NAME);
    if !legacy.exists() {
        return Ok(());
    }

    fs::copy(&legacy, &target)
        .map_err(|err| format!("Migration de la base V1.0 impossible : {err}"))?;
    // A closed-but-unchecked WAL still holds committed pages: copy it too, and
    // the shared-memory index that goes with it, then let SQLite recover them.
    for suffix in ["-wal", "-shm"] {
        let from = legacy_dir.join(format!("{DB_FILE_NAME}{suffix}"));
        if from.exists() {
            let to = data_dir.join(format!("{DB_FILE_NAME}{suffix}"));
            fs::copy(&from, &to)
                .map_err(|err| format!("Migration des fichiers {suffix} impossible : {err}"))?;
        }
    }

    println!(
        "[CentreManager] base V1.0 migrée depuis {}",
        legacy_dir.display()
    );
    Ok(())
}

/// Create/upgrade the database and hand back a ready-to-use connection.
///
/// Called from the Tauri `setup` hook.
pub fn init_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    use tauri::Manager;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Impossible de résoudre le dossier de données : {err}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Impossible de créer {} : {err}", data_dir.display()))?;

    // V1.0 → V1.1 upgrade: keep the existing centre, just move the file.
    migrate_legacy_data_dir(app, &data_dir)?;

    let path = data_dir.join(DB_FILE_NAME);
    set_db_path(path.clone());

    let conn = open_connection_at(&path)
        .map_err(|err| format!("Impossible d'ouvrir la base {} : {err}", path.display()))?;

    run_migrations(&conn).map_err(|err| format!("Échec des migrations : {err}"))?;

    // Seed sensible defaults on first launch (idempotent).
    seed_defaults(&conn).map_err(|err| format!("Échec de l'initialisation des données : {err}"))?;

    println!("[CentreManager] base de données prête : {}", path.display());
    Ok(conn)
}

/// First-run values. `INSERT OR IGNORE` keeps this idempotent.
fn seed_defaults(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        // `center_name` and `admin_password_hash` are intentionally NOT seeded:
        // their absence is what triggers the first-launch setup screen.
        "INSERT OR IGNORE INTO settings (key, value) VALUES
            ('currency', 'DH'),
            ('language', 'fr'),
            ('lock_timeout_minutes', '15'),
            ('receipt_format', 'a4'),
            ('db_version', '2'),
            -- Phase 11: the expense categories the director can edit in Settings.
            ('expense_categories', '[\"Loyer\",\"WiFi\",\"Électricité\",\"Eau\",\"Assistance\",\"Fournitures\",\"Autre\"]');",
    )
}

/// Quick sanity check used by commands and smoke tests.
pub fn table_names(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database that predates Phase 13 has groups with a single day and no
    /// `group_schedules` row: the backfill must turn that day into one row.
    #[test]
    fn legacy_single_day_groups_are_backfilled() {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&conn).unwrap();

        // Written straight to SQL, bypassing the command layer, exactly like a
        // row created by V1.2.
        conn.execute_batch(
            "INSERT INTO groups (subject_id, level_id, school_year_id,
                                 day_of_week, start_time, end_time, monthly_fee_cents, capacity)
             VALUES (1, 10, 1, 'Mercredi', '14:00', '16:00', 30000, 10);
             INSERT INTO groups (subject_id, level_id, school_year_id,
                                 day_of_week, start_time, end_time, monthly_fee_cents, capacity)
             VALUES (1, 10, 1, NULL, NULL, NULL, 30000, 10);",
        )
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM group_schedules", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );

        migrate_group_schedules(&conn).unwrap();

        let rows: Vec<(i64, String, String, String)> = conn
            .prepare("SELECT group_id, day_of_week, start_time, end_time FROM group_schedules")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(rows.len(), 1, "only the dated group gets a slot");
        assert_eq!(rows[0].1, "Mercredi");
        assert_eq!(rows[0].2, "14:00");

        // Idempotent: a second launch adds nothing.
        migrate_group_schedules(&conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM group_schedules", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn schema_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&conn).unwrap();
        // Running twice must not fail.
        run_migrations(&conn).unwrap();

        let tables = table_names(&conn).unwrap();
        assert_eq!(tables.len(), 22, "expected 22 tables, got {tables:?}");
        for expected in [
            "settings",
            "school_years",
            "levels",
            "branches",
            "subjects",
            "students",
            "teachers",
            "teacher_subjects",
            "groups",
            "enrollments",
            "invoices",
            "payments",
            "receipts",
            "teacher_activities",
            "teacher_compensation",
            "teacher_settlements",
            "audit_log",
            "monthly_expenses",
            "group_schedules",
            "student_school_years",
            "teacher_school_years",
            "group_year_imports",
        ] {
            assert!(
                tables.iter().any(|name| name == expected),
                "missing {expected}"
            );
        }
    }

    #[test]
    fn legacy_students_are_migrated_without_losing_references() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE students (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, date_of_birth TEXT,
                phone TEXT, parent_phone TEXT, father_name TEXT, home_address TEXT, level_id INTEGER,
                branch_id INTEGER, notes TEXT, status TEXT, created_at TEXT, updated_at TEXT);
            INSERT INTO students VALUES (1, 'Salma Mansouri', '2010-01-01', '0612345678', '0712345678',
                'Rachid', 'Rabat', NULL, NULL, 'test', 'actif', '2025-01-01', '2025-01-01');
            CREATE TABLE linked_student (student_id INTEGER REFERENCES students(id) ON DELETE CASCADE);
            INSERT INTO linked_student VALUES (1);").unwrap();
        run_migrations(&conn).unwrap();
        let data: (String, String, String, String) = conn.query_row(
            "SELECT guardian_name, address, birth_date, secondary_contact_phone FROM students WHERE id=1", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(data, ("Rachid".to_string(), "Rabat".to_string(), "2010-01-01".to_string(), "0712345678".to_string()));
        for col in ["father_name", "home_address", "email"] { assert!(!column_exists(&conn, "students", col).unwrap()); }
        run_migrations(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM linked_student WHERE student_id=1", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn reference_data_is_seeded_once() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |row| row.get(0)).unwrap() };

        assert_eq!(count("SELECT COUNT(*) FROM levels"), 12);
        assert_eq!(count("SELECT COUNT(*) FROM branches"), 15);
        assert_eq!(count("SELECT COUNT(*) FROM subjects"), 10);
        assert_eq!(count("SELECT COUNT(*) FROM school_years"), 1);
        assert_eq!(
            count("SELECT COUNT(*) FROM school_years WHERE is_active = 1"),
            1
        );
        assert_eq!(
            count("SELECT COUNT(*) FROM branches WHERE level_id IS NULL"),
            0
        );

        // Running migrations again must not duplicate anything.
        run_migrations(&conn).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM levels"), 12);
        assert_eq!(count("SELECT COUNT(*) FROM branches"), 15);
        assert_eq!(count("SELECT COUNT(*) FROM subjects"), 10);
        assert_eq!(count("SELECT COUNT(*) FROM school_years"), 1);
    }

    #[test]
    fn seeding_preserves_user_edits() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // The user renames a subject and deletes a branch…
        conn.execute(
            "UPDATE subjects SET name = 'Maths' WHERE name = 'Mathématiques'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM branches WHERE level_id = 12", [])
            .unwrap();

        // …next launch must not resurrect them.
        run_migrations(&conn).unwrap();

        let subjects: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subjects WHERE name = 'Mathématiques'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(subjects, 0, "renamed subject must not be re-seeded");
        let branches: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM branches WHERE level_id = 12",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(branches, 0, "deleted branches must stay deleted");
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);

        let orphan = conn.execute(
            "INSERT INTO receipts (payment_id, receipt_number) VALUES (999, 'R-1')",
            [],
        );
        assert!(orphan.is_err(), "orphan receipt must be rejected");
    }

    #[test]
    fn phase6_columns_are_added_to_an_older_database() {
        let conn = Connection::open_in_memory().unwrap();

        // A Phase 5 database: teachers/settlements without the payroll columns.
        conn.execute_batch(
            "CREATE TABLE teachers (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 full_name TEXT NOT NULL,
                 status TEXT DEFAULT 'actif'
             );
             CREATE TABLE teacher_settlements (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 teacher_id INTEGER,
                 amount_cents INTEGER
             );",
        )
        .unwrap();

        run_migrations(&conn).unwrap();
        // A second launch must not fail on the now-existing columns.
        run_migrations(&conn).unwrap();

        for (table, column) in [
            ("teachers", "compensation_mode"),
            ("teachers", "compensation_value_cents"),
            ("teachers", "bonus_pct"),
            ("teacher_settlements", "month"),
            ("teacher_settlements", "year"),
        ] {
            assert!(
                column_exists(&conn, table, column).unwrap(),
                "{table}.{column} was not added"
            );
        }
    }

    #[test]
    fn wal_mode_is_enabled_on_disk_db() {
        let dir = std::env::temp_dir().join(format!("cm-test-{}", std::process::id()));
        let path = dir.join(DB_FILE_NAME);
        let conn = open_connection_at(&path).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }
}
