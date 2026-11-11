//! Key/value settings commands.
//!
//! The admin password hash is **never** exposed here: it is filtered out of
//! [`cmd_get_all_settings`], [`cmd_get_setting`] refuses to read it and
//! [`cmd_set_setting`] refuses to write it. Password changes must go through
//! `commands::auth::cmd_change_password`.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;
use serde::Serialize;

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

/// Fee settings are scoped to the active school year. A newly created year
/// always starts at zero, rather than silently inheriting another year's rate.
pub fn enrollment_fee(conn: &Connection) -> Result<i64, String> {
    let year: i64 = conn.query_row("SELECT id FROM school_years WHERE is_active=1 LIMIT 1", [], |r| r.get(0))
        .map_err(|_| "Aucune année scolaire active".to_string())?;
    let raw = get_setting_value(conn, &format!("enrollment_fee:{year}"))?;
    raw.map(|value| value.parse::<i64>().map_err(|_| "Frais d'inscription invalides".to_string()))
        .unwrap_or(Ok(0))
}

pub fn set_enrollment_fee(conn: &Connection, amount: i64) -> Result<(), String> {
    if !(0..=9_007_199_254_740_991).contains(&amount) { return Err("Montant invalide".to_string()); }
    let year: i64 = conn.query_row("SELECT id FROM school_years WHERE is_active=1 LIMIT 1", [], |r| r.get(0))
        .map_err(|_| "Aucune année scolaire active".to_string())?;
    set_setting_value(conn, &format!("enrollment_fee:{year}"), &amount.to_string())
}

#[tauri::command]
pub fn cmd_get_enrollment_fee(db: State<'_, Db>) -> Result<i64, String> { enrollment_fee(&db.conn()) }

#[tauri::command]
pub fn cmd_set_enrollment_fee(db: State<'_, Db>, amount: i64, year_id: Option<i64>) -> Result<(), String> {
    let conn = db.conn();
    if let Some(expected) = year_id {
        let current: Option<i64> = conn.query_row("SELECT id FROM school_years WHERE is_active=1 LIMIT 1", [], |r| r.get(0))
            .optional().map_err(|e| db_err("Année scolaire", e))?;
        if current != Some(expected) { return Err("L'année scolaire active a changé".to_string()); }
    }
    set_enrollment_fee(&conn, amount)
}

#[derive(Debug, Serialize)]
pub struct CentreInfo { pub name: String, pub logo: Option<String> }

pub fn get_centre_info(conn: &Connection) -> Result<CentreInfo, String> {
    let name = get_setting_value(conn, "centre_name")?.or(get_setting_value(conn, "center_name")?)
        .filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "CentreManager".to_string());
    let logo = get_setting_value(conn, "centre_logo")?.or(get_setting_value(conn, "center_logo")?)
        .filter(|v| !v.is_empty());
    Ok(CentreInfo { name, logo })
}

pub fn set_centre_info(conn: &Connection, name: &str, logo: Option<&str>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() { return Err("Le nom du centre est requis".to_string()); }
    if let Some(value) = logo.filter(|v| !v.is_empty()) {
        let payload = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/svg+xml;base64,"]
            .iter().find_map(|prefix| value.strip_prefix(*prefix))
            .ok_or_else(|| "Format de logo invalide".to_string())?;
        let padding = payload.bytes().rev().take_while(|c| *c == b'=').count();
        let body = &payload[..payload.len() - padding];
        if payload.is_empty() || payload.len() % 4 != 0 || padding > 2
            || !body.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
            || payload.len() / 4 * 3 - padding > 2 * 1024 * 1024 {
            return Err("Logo invalide ou trop volumineux (2 Mo maximum)".to_string());
        }
    }
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Enregistrement du centre", e))?;
    for (key, value) in [("centre_name", name), ("center_name", name), ("centre_logo", logo.unwrap_or("")), ("center_logo", logo.unwrap_or(""))] {
        set_setting_value(&tx, key, value)?;
    }
    tx.commit().map_err(|e| db_err("Enregistrement du centre", e))
}

#[tauri::command]
pub fn cmd_get_centre_info(db: State<'_, Db>) -> Result<CentreInfo, String> { get_centre_info(&db.conn()) }

#[tauri::command]
pub fn cmd_set_centre_info(db: State<'_, Db>, name: String, logo: Option<String>) -> Result<(), String> { set_centre_info(&db.conn(), &name, logo.as_deref()) }

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
    fn centre_info_roundtrip_with_logo() {
        let c = test_conn();
        set_centre_info(&c, "Mon centre", Some("data:image/png;base64,YWJj")).unwrap();
        let info = get_centre_info(&c).unwrap();
        assert_eq!(info.name, "Mon centre");
        assert_eq!(info.logo.as_deref(), Some("data:image/png;base64,YWJj"));
    }
    #[test]
    fn centre_info_roundtrip_without_logo() {
        let c = test_conn();
        set_centre_info(&c, "Mon centre", None).unwrap();
        assert!(get_centre_info(&c).unwrap().logo.is_none());
        assert_eq!(get_centre_info(&c).unwrap().name, "Mon centre");
    }
    #[test]
    fn empty_key_is_rejected() {
        let conn = test_conn();
        assert!(set_setting_value(&conn, "   ", "x").is_err());
    }
}
