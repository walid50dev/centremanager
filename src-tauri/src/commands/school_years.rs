//! School year commands (`school_years` table).
//!
//! Exactly one year is active at a time; activating a year clears the flag on
//! every other row inside a single transaction.

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::SchoolYear;

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| format!("{field} invalide (format attendu AAAA-MM-JJ)"))
}

/// All school years, most recent first.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<SchoolYear>> {
    let mut stmt = conn.prepare(
        "SELECT id, label, start_date, end_date, is_active
         FROM school_years
         ORDER BY start_date DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SchoolYear {
            id: row.get(0)?,
            label: row.get(1)?,
            start_date: row.get(2)?,
            end_date: row.get(3)?,
            is_active: row.get::<_, Option<i64>>(4)?.unwrap_or(0) != 0,
        })
    })?;
    rows.collect()
}

/// Create a school year and return its id.
pub fn create(
    conn: &Connection,
    label: &str,
    start_date: &str,
    end_date: &str,
) -> Result<i64, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("Le libellé de l'année scolaire est obligatoire".to_string());
    }

    let start = parse_date(start_date, "Date de début")?;
    let end = parse_date(end_date, "Date de fin")?;
    if end <= start {
        return Err("La date de fin doit être postérieure à la date de début".to_string());
    }

    conn.execute(
        "INSERT INTO school_years (label, start_date, end_date, is_active)
         VALUES (?1, ?2, ?3, 0)",
        params![label, start.to_string(), end.to_string()],
    )
    .map_err(|err| {
        if err.to_string().contains("UNIQUE") {
            "Cette année scolaire existe déjà".to_string()
        } else {
            db_err("Création de l'année scolaire", err)
        }
    })?;

    Ok(conn.last_insert_rowid())
}

/// Make `id` the only active year.
pub fn set_active(conn: &Connection, id: i64) -> Result<(), String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM school_years WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|err| db_err("Vérification de l'année scolaire", err))?
        .is_some();

    if !exists {
        return Err("Année scolaire introuvable".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    tx.execute("UPDATE school_years SET is_active = 0", [])
        .map_err(|err| db_err("Désactivation des années", err))?;
    tx.execute(
        "UPDATE school_years SET is_active = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|err| db_err("Activation de l'année", err))?;

    tx.commit()
        .map_err(|err| db_err("Validation de la transaction", err))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_get_school_years(db: State<'_, Db>) -> Result<Vec<SchoolYear>, String> {
    let conn = db.conn();
    list(&conn).map_err(|err| db_err("Lecture des années scolaires", err))
}

#[tauri::command]
pub fn cmd_create_school_year(
    db: State<'_, Db>,
    label: String,
    start_date: String,
    end_date: String,
) -> Result<i64, String> {
    let conn = db.conn();
    create(&conn, &label, &start_date, &end_date)
}

#[tauri::command]
pub fn cmd_set_active_year(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.conn();
    set_active(&conn, id)
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
    fn seeded_year_is_active() {
        let conn = test_conn();
        let years = list(&conn).unwrap();
        assert_eq!(years.len(), 1, "expected the seeded 2024-2025 year");
        assert_eq!(years[0].label.as_deref(), Some("2024-2025"));
        assert!(years[0].is_active);
    }

    #[test]
    fn create_and_activate_keeps_a_single_active_year() {
        let conn = test_conn();
        let seeded = list(&conn).unwrap()[0].id;

        let new_id = create(&conn, "2025-2026", "2025-09-01", "2026-06-30").unwrap();
        set_active(&conn, new_id).unwrap();

        let years = list(&conn).unwrap();
        let active: Vec<_> = years.iter().filter(|year| year.is_active).collect();
        assert_eq!(active.len(), 1, "exactly one year must be active");
        assert_eq!(active[0].id, new_id);

        // Switching back deactivates the other one.
        set_active(&conn, seeded).unwrap();
        let years = list(&conn).unwrap();
        let active: Vec<_> = years.iter().filter(|year| year.is_active).collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, seeded);
    }

    #[test]
    fn list_is_ordered_by_start_date_desc() {
        let conn = test_conn();
        create(&conn, "2023-2024", "2023-09-01", "2024-06-30").unwrap();
        create(&conn, "2025-2026", "2025-09-01", "2026-06-30").unwrap();

        let labels: Vec<String> = list(&conn)
            .unwrap()
            .into_iter()
            .filter_map(|year| year.label)
            .collect();
        assert_eq!(labels, ["2025-2026", "2024-2025", "2023-2024"]);
    }

    #[test]
    fn invalid_input_is_rejected() {
        let conn = test_conn();
        assert!(create(&conn, "  ", "2025-09-01", "2026-06-30").is_err());
        assert!(create(&conn, "2025-2026", "nope", "2026-06-30").is_err());
        assert!(create(&conn, "2025-2026", "2026-09-01", "2025-06-30").is_err());
        // Duplicate label (seeded year).
        assert_eq!(
            create(&conn, "2024-2025", "2024-09-01", "2025-06-30").unwrap_err(),
            "Cette année scolaire existe déjà"
        );
        assert_eq!(
            set_active(&conn, 9999).unwrap_err(),
            "Année scolaire introuvable"
        );
    }
}
