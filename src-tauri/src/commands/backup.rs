//! Database backup commands.
//!
//! A restore is intentionally **not** automated in V1: replacing the live
//! SQLite file while the app holds it open is risky. The UI explains the manual
//! procedure instead (close the app, swap the file, relaunch).

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use tauri::State;

use super::db_err;
use crate::db::{self, Db};
use crate::models::DbInfo;

/// Settings key holding the ISO timestamp of the last successful backup.
pub const LAST_BACKUP_KEY: &str = "last_backup_date";

/// Copy the database file to `dest`.
///
/// The WAL is checkpointed first (and truncated), otherwise recent commits
/// would still live in the `-wal` side file and the copy would be stale.
pub fn backup_file(conn: &Connection, source: &Path, dest: &str) -> Result<(), String> {
    let dest = dest.trim();
    if dest.is_empty() {
        return Err("Chemin de destination invalide".to_string());
    }

    let dest_path = PathBuf::from(dest);
    if dest_path == source {
        return Err(
            "La sauvegarde doit être enregistrée dans un autre fichier que la base active"
                .to_string(),
        );
    }

    if !source.exists() {
        return Err(format!(
            "Base de données introuvable : {}",
            source.display()
        ));
    }

    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Le dossier {} n'existe pas", parent.display()));
        }
    }

    // Flush committed pages from the WAL into the main database file.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|err| db_err("Synchronisation de la base", err))?;

    fs::copy(source, &dest_path)
        .map_err(|err| format!("Copie impossible vers {} : {err}", dest_path.display()))?;

    Ok(())
}

/// Path, size and last backup timestamp of the active database.
fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn wal_path(path: &Path) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push("-wal");
    std::path::PathBuf::from(name)
}

pub fn db_info(conn: &Connection, path: &Path) -> Result<DbInfo, String> {
    // WAL mode keeps most pages in the `-wal` sidecar until a checkpoint, so the
    // reported size must include it or a busy database looks nearly empty.
    let size_bytes = file_len(path) + file_len(&wal_path(path));

    let last_backup = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![LAST_BACKUP_KEY],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten();

    Ok(DbInfo {
        path: path.display().to_string(),
        size_bytes,
        last_backup,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_backup_db(db: State<'_, Db>, dest_path: String) -> Result<(), String> {
    let conn = db.conn();
    backup_file(&conn, &db::db_path(), &dest_path)
}

#[tauri::command]
pub fn cmd_get_db_info(db: State<'_, Db>) -> Result<DbInfo, String> {
    let conn = db.conn();
    db_info(&conn, &db::db_path())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-backup-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backup_copies_the_database_file() {
        let dir = temp_dir("copy");
        let source = dir.join("centremanager.db");

        // Real on-disk database with data in it.
        let conn = crate::db::open_connection_at(&source).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('center_name', 'Centre Test')",
            [],
        )
        .unwrap();

        let dest = dir.join("backup.db");
        backup_file(&conn, &source, dest.to_str().unwrap()).unwrap();

        assert!(dest.exists(), "backup file must exist");
        assert!(fs::metadata(&dest).unwrap().len() > 0);

        // The copy is a usable database containing the data.
        let copy = Connection::open(&dest).unwrap();
        let name: String = copy
            .query_row(
                "SELECT value FROM settings WHERE key = 'center_name'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Centre Test");

        drop(conn);
        drop(copy);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_guards() {
        let dir = temp_dir("guards");
        let source = dir.join("centremanager.db");
        let conn = crate::db::open_connection_at(&source).unwrap();
        crate::db::run_migrations(&conn).unwrap();

        assert!(backup_file(&conn, &source, "   ").is_err());
        assert!(backup_file(&conn, &source, source.to_str().unwrap()).is_err());
        assert!(backup_file(
            &conn,
            &source,
            dir.join("missing/backup.db").to_str().unwrap()
        )
        .is_err());

        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn db_info_reports_path_size_and_last_backup() {
        let dir = temp_dir("info");
        let source = dir.join("centremanager.db");
        let conn = crate::db::open_connection_at(&source).unwrap();
        crate::db::run_migrations(&conn).unwrap();

        let info = db_info(&conn, &source).unwrap();
        assert_eq!(info.path, source.display().to_string());
        assert!(info.size_bytes > 0);
        assert!(info.size_bytes >= file_len(&source));
        assert!(info.last_backup.is_none());

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![LAST_BACKUP_KEY, "2026-10-31T12:00:00.000Z"],
        )
        .unwrap();
        let info = db_info(&conn, &source).unwrap();
        assert_eq!(
            info.last_backup.as_deref(),
            Some("2026-10-31T12:00:00.000Z")
        );

        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }
}
