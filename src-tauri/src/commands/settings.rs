//! Key/value settings commands.
//!
//! The admin password hash is **never** exposed here: it is filtered out of
//! [`cmd_get_all_settings`], [`cmd_get_setting`] refuses to read it and
//! [`cmd_set_setting`] refuses to write it. Password changes must go through
//! `commands::auth::cmd_change_password`.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use super::db_err;
use crate::db::Db;

/// Settings key that these commands must never touch.
pub const PROTECTED_KEY: &str = "admin_password_hash";

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// All settings except the password hash (NULL values are skipped).
pub fn all_settings(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM settings
         WHERE value IS NOT NULL AND key <> ?1
         ORDER BY key",
    )?;
    let rows = stmt.query_map(params![PROTECTED_KEY], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// One setting, or `None` when absent or protected.
pub fn get_setting_value(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    if key.trim() == PROTECTED_KEY {
        return Ok(None);
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(Option::flatten)
    .map_err(|err| db_err("Lecture du paramètre", err))
}

/// Upsert a setting.
pub fn set_setting_value(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Clé de paramètre invalide".to_string());
    }
    if key == PROTECTED_KEY {
        return Err(
            "Le mot de passe ne peut pas être modifié depuis les paramètres généraux".to_string(),
        );
    }

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|err| db_err("Enregistrement du paramètre", err))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Every setting except the password hash.
#[tauri::command]
pub fn cmd_get_all_settings(db: State<'_, Db>) -> Result<HashMap<String, String>, String> {
    let conn = db.conn();
    all_settings(&conn).map_err(|err| db_err("Lecture des paramètres", err))
}

/// Read a single setting (protected keys return `None`).
#[tauri::command]
pub fn cmd_get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.conn();
    get_setting_value(&conn, &key)
}

/// Create or update a setting.
#[tauri::command]
pub fn cmd_set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.conn();
    set_setting_value(&conn, &key, &value)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn settings_roundtrip() {
        let conn = test_conn();
        set_setting_value(&conn, "center_address", "12 rue des Écoles").unwrap();

        assert_eq!(
            get_setting_value(&conn, "center_address")
                .unwrap()
                .as_deref(),
            Some("12 rue des Écoles")
        );

        // Upsert replaces the value.
        set_setting_value(&conn, "center_address", "Casablanca").unwrap();
        let all = all_settings(&conn).unwrap();
        assert_eq!(all.get("center_address").unwrap(), "Casablanca");
    }

    #[test]
    fn password_hash_is_protected() {
        let conn = test_conn();
        crate::commands::auth::setup(&conn, "Centre", "motdepasse").unwrap();

        // Cannot be written through the generic command.
        let error = set_setting_value(&conn, PROTECTED_KEY, "hacked").unwrap_err();
        assert!(error.contains("mot de passe"));

        // Cannot be read…
        assert!(get_setting_value(&conn, PROTECTED_KEY).unwrap().is_none());
        // …and never appears in the bulk listing, while other keys do.
        let all = all_settings(&conn).unwrap();
        assert!(!all.contains_key(PROTECTED_KEY));
        assert_eq!(all.get("center_name").unwrap(), "Centre");
    }

    #[test]
    fn empty_key_is_rejected() {
        let conn = test_conn();
        assert!(set_setting_value(&conn, "   ", "x").is_err());
    }
}
