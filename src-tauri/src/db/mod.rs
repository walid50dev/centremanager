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
    seed_reference_data(conn)
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
            ('db_version', '2');",
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

    #[test]
    fn schema_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&conn).unwrap();
        // Running twice must not fail.
        run_migrations(&conn).unwrap();

        let tables = table_names(&conn).unwrap();
        assert_eq!(tables.len(), 17, "expected 17 tables, got {tables:?}");
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
        ] {
            assert!(
                tables.iter().any(|name| name == expected),
                "missing {expected}"
            );
        }
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
