//! Teacher activities (Phase 6).
//!
//! Hours and sessions are entered by hand; they are the input of the `hourly`
//! and `per_session` compensation modes. One row is one day: a teacher can log
//! a lesson (`cours`), a catch-up class (`rattrapage`), an exam (`examen`) or
//! anything else (`autre`), with hours, sessions, or both.

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::Activity;

/// The four activity types accepted by the backend.
pub const ACTIVITY_TYPES: [&str; 4] = ["cours", "rattrapage", "examen", "autre"];

fn validate_period(month: Option<i32>, year: Option<i32>) -> Result<(), String> {
    if let Some(month) = month {
        if !(1..=12).contains(&month) {
            return Err("Mois invalide (1 à 12)".to_string());
        }
    }
    if let Some(year) = year {
        if !(2000..=2100).contains(&year) {
            return Err("Année invalide".to_string());
        }
    }
    Ok(())
}

pub fn record_activity(
    conn: &Connection,
    teacher_id: i64,
    activity_date: &str,
    activity_type: &str,
    hours: Option<f64>,
    sessions: Option<i64>,
    notes: Option<&str>,
) -> Result<i64, String> {
    let date = activity_date.trim();
    if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err("Date invalide (format attendu AAAA-MM-JJ)".to_string());
    }

    let kind = activity_type.trim();
    if !ACTIVITY_TYPES.contains(&kind) {
        return Err("Type d'activité invalide (cours, rattrapage, examen, autre)".to_string());
    }

    let hours = hours.filter(|value| *value > 0.0);
    let sessions = sessions.filter(|value| *value > 0);
    if hours.is_none() && sessions.is_none() {
        return Err("Indiquez au moins des heures ou des séances".to_string());
    }

    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM teachers WHERE id = ?1",
            params![teacher_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture de l'enseignant", err))?;
    if exists.is_none() {
        return Err("Enseignant introuvable".to_string());
    }

    conn.execute(
        "INSERT INTO teacher_activities
            (teacher_id, activity_date, activity_type, hours, sessions, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            teacher_id,
            date,
            kind,
            hours,
            sessions,
            notes.map(str::trim).filter(|text| !text.is_empty())
        ],
    )
    .map_err(|err| db_err("Enregistrement de l'activité", err))?;

    let id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('ACTIVITY', 'teacher', ?1, ?2)",
        params![
            teacher_id,
            serde_json::json!({
                "activity_id": id,
                "activity_date": date,
                "activity_type": kind,
                "hours": hours,
                "sessions": sessions,
            })
            .to_string()
        ],
    )
    .map_err(|err| db_err("Journalisation de l'audit", err))?;

    Ok(id)
}

/// Activities of a teacher, newest first, optionally limited to one month.
pub fn list_activities(
    conn: &Connection,
    teacher_id: i64,
    month: Option<i32>,
    year: Option<i32>,
) -> Result<Vec<Activity>, String> {
    validate_period(month, year)?;

    let prefix = match (month, year) {
        (Some(month), Some(year)) => Some(format!("{year:04}-{month:02}")),
        _ => None,
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(activity_date, ''), COALESCE(activity_type, ''),
                    hours, sessions, notes
               FROM teacher_activities
              WHERE teacher_id = ?1
                AND (?2 IS NULL OR substr(activity_date, 1, 7) = ?2)
              ORDER BY COALESCE(activity_date, '') DESC, id DESC",
        )
        .map_err(|err| db_err("Préparation de la liste des activités", err))?;
    let rows = stmt
        .query_map(params![teacher_id, prefix], |row| {
            Ok(Activity {
                id: row.get(0)?,
                activity_date: row.get(1)?,
                activity_type: row.get(2)?,
                hours: row.get(3)?,
                sessions: row.get(4)?,
                notes: row.get(5)?,
            })
        })
        .map_err(|err| db_err("Lecture des activités", err))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des activités", err))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_record_activity(
    db: State<'_, Db>,
    teacher_id: i64,
    activity_date: String,
    activity_type: String,
    hours: Option<f64>,
    sessions: Option<i64>,
    notes: Option<String>,
) -> Result<i64, String> {
    let conn = db.conn();
    record_activity(
        &conn,
        teacher_id,
        &activity_date,
        &activity_type,
        hours,
        sessions,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn cmd_get_activities(
    db: State<'_, Db>,
    teacher_id: i64,
    month: Option<i32>,
    year: Option<i32>,
) -> Result<Vec<Activity>, String> {
    let conn = db.conn();
    list_activities(&conn, teacher_id, month, year)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::super::teachers::{create_teacher, CreateTeacherInput};
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn teacher(conn: &Connection) -> i64 {
        create_teacher(
            conn,
            &CreateTeacherInput {
                full_name: "Karim Idrissi".to_string(),
                phone: None,
                email: None,
                notes: None,
                subject_ids: vec![1],
            },
        )
        .unwrap()
    }

    #[test]
    fn record_activity_stores_hours_and_sessions() {
        let conn = test_conn();
        let id = teacher(&conn);

        let activity_id = record_activity(
            &conn,
            id,
            "2026-03-04",
            "cours",
            Some(2.0),
            Some(1),
            Some("Salle 3"),
        )
        .unwrap();
        assert!(activity_id > 0);

        let rows = list_activities(&conn, id, Some(3), Some(2026)).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].activity_date, "2026-03-04");
        assert_eq!(rows[0].activity_type, "cours");
        assert_eq!(rows[0].hours, Some(2.0));
        assert_eq!(rows[0].sessions, Some(1));
        assert_eq!(rows[0].notes.as_deref(), Some("Salle 3"));

        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE action = 'ACTIVITY'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("\"activity_type\":\"cours\""));
    }

    #[test]
    fn activity_validation() {
        let conn = test_conn();
        let id = teacher(&conn);

        assert!(
            record_activity(&conn, id, "04/03/2026", "cours", Some(2.0), None, None)
                .unwrap_err()
                .contains("Date invalide")
        );
        assert!(
            record_activity(&conn, id, "2026-03-04", "soutien", Some(2.0), None, None)
                .unwrap_err()
                .contains("Type d'activité invalide")
        );
        assert_eq!(
            record_activity(&conn, id, "2026-03-04", "cours", None, None, None).unwrap_err(),
            "Indiquez au moins des heures ou des séances"
        );
        assert_eq!(
            record_activity(&conn, 999, "2026-03-04", "cours", Some(1.0), None, None).unwrap_err(),
            "Enseignant introuvable"
        );

        // Zero is treated as "not provided".
        assert!(record_activity(&conn, id, "2026-03-04", "cours", Some(0.0), None, None).is_err());
        assert!(record_activity(&conn, id, "2026-03-04", "cours", None, Some(0), None).is_err());
    }

    #[test]
    fn activities_are_filtered_by_month_and_sorted_newest_first() {
        let conn = test_conn();
        let id = teacher(&conn);

        record_activity(&conn, id, "2026-03-02", "cours", Some(2.0), None, None).unwrap();
        record_activity(&conn, id, "2026-03-20", "examen", None, Some(1), None).unwrap();
        record_activity(&conn, id, "2026-04-01", "rattrapage", Some(1.5), None, None).unwrap();

        let march = list_activities(&conn, id, Some(3), Some(2026)).unwrap();
        assert_eq!(march.len(), 2);
        assert_eq!(march[0].activity_date, "2026-03-20");
        assert_eq!(march[1].activity_date, "2026-03-02");

        // No filter -> everything.
        assert_eq!(list_activities(&conn, id, None, None).unwrap().len(), 3);

        assert!(list_activities(&conn, id, Some(13), Some(2026)).is_err());
    }
}
