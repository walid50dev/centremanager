//! Subject commands (`subjects` table).

use rusqlite::{params, Connection};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::Subject;

/// All subjects, alphabetical.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Subject>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_active
         FROM subjects
         ORDER BY name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Subject {
            id: row.get(0)?,
            name: row.get(1)?,
            is_active: row.get::<_, Option<i64>>(2)?.unwrap_or(1) != 0,
        })
    })?;
    rows.collect()
}

fn normalise_name(name: &str, conn: &Connection, ignore_id: Option<i64>) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Le nom de la matière est obligatoire".to_string());
    }

    // Reject case-insensitive duplicates so the list stays clean.
    let duplicate: Option<i64> = conn
        .query_row(
            "SELECT id FROM subjects
             WHERE name = ?1 COLLATE NOCASE AND (?2 IS NULL OR id <> ?2)
             LIMIT 1",
            params![name, ignore_id],
            |row| row.get(0),
        )
        .ok();

    if duplicate.is_some() {
        return Err("Cette matière existe déjà".to_string());
    }

    Ok(name)
}

/// Create a subject and return its id.
pub fn create(conn: &Connection, name: &str) -> Result<i64, String> {
    let name = normalise_name(name, conn, None)?;
    conn.execute(
        "INSERT INTO subjects (name, is_active) VALUES (?1, 1)",
        params![name],
    )
    .map_err(|err| db_err("Création de la matière", err))?;
    Ok(conn.last_insert_rowid())
}

/// Rename a subject and/or toggle it.
pub fn update(conn: &Connection, id: i64, name: &str, is_active: bool) -> Result<(), String> {
    let name = normalise_name(name, conn, Some(id))?;
    let updated = conn
        .execute(
            "UPDATE subjects SET name = ?1, is_active = ?2 WHERE id = ?3",
            params![name, if is_active { 1 } else { 0 }, id],
        )
        .map_err(|err| db_err("Mise à jour de la matière", err))?;

    if updated == 0 {
        return Err("Matière introuvable".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_get_subjects(db: State<'_, Db>) -> Result<Vec<Subject>, String> {
    let conn = db.conn();
    list(&conn).map_err(|err| db_err("Lecture des matières", err))
}

#[tauri::command]
pub fn cmd_create_subject(db: State<'_, Db>, name: String) -> Result<i64, String> {
    let conn = db.conn();
    create(&conn, &name)
}

#[tauri::command]
pub fn cmd_update_subject(
    db: State<'_, Db>,
    id: i64,
    name: String,
    is_active: bool,
) -> Result<(), String> {
    let conn = db.conn();
    update(&conn, id, &name, is_active)
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
    fn seeded_subjects_are_present_and_sorted() {
        let conn = test_conn();
        let subjects = list(&conn).unwrap();
        assert_eq!(subjects.len(), 10, "10 seeded subjects");
        assert!(subjects.iter().all(|subject| subject.is_active));

        let names: Vec<String> = subjects.into_iter().filter_map(|s| s.name).collect();
        // Alphabetical, case-insensitively (the query uses COLLATE NOCASE).
        assert!(
            names
                .windows(2)
                .all(|pair| pair[0].to_lowercase() <= pair[1].to_lowercase()),
            "not alphabetical: {names:?}"
        );
        for expected in [
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
        ] {
            assert!(
                names.iter().any(|name| name == expected),
                "missing {expected}"
            );
        }
    }

    #[test]
    fn create_and_toggle_a_subject() {
        let conn = test_conn();
        let id = create(&conn, "  Espagnol ").unwrap();

        let subject = list(&conn)
            .unwrap()
            .into_iter()
            .find(|subject| subject.id == id)
            .unwrap();
        assert_eq!(subject.name.as_deref(), Some("Espagnol"), "trimmed");
        assert!(subject.is_active);

        update(&conn, id, "Espagnol", false).unwrap();
        let subject = list(&conn)
            .unwrap()
            .into_iter()
            .find(|subject| subject.id == id)
            .unwrap();
        assert!(!subject.is_active, "toggle persists");
    }

    #[test]
    fn duplicates_and_empty_names_are_rejected() {
        let conn = test_conn();
        assert_eq!(
            create(&conn, "mathématiques").unwrap_err(),
            "Cette matière existe déjà"
        );
        assert!(create(&conn, "   ").is_err());
        assert_eq!(
            update(&conn, 9999, "Nouvelle", true).unwrap_err(),
            "Matière introuvable"
        );

        // A subject may keep its own name when only the toggle changes.
        let id = list(&conn)
            .unwrap()
            .into_iter()
            .find(|subject| subject.name.as_deref() == Some("Français"))
            .unwrap()
            .id;
        update(&conn, id, "Français", false).unwrap();
    }
}
