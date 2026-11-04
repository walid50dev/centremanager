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

/// Permanently remove an inactive year's data in a single transaction.
pub fn delete_year(conn: &Connection, year_id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction", e))?;
    let active: Option<bool> = tx.query_row("SELECT COALESCE(is_active,0) FROM school_years WHERE id=?1", params![year_id], |r| r.get(0)).optional().map_err(|e| db_err("Année scolaire", e))?;
    match active { None => return Err("Année scolaire introuvable".into()), Some(true) => return Err("Impossible de supprimer l'année active".into()), Some(false) => {} }
    // Include advances attributed directly to the year, as well as invoices'
    // payments. Receipts, invoices, enrollments and schedules cascade via FKs.
    tx.execute("DELETE FROM payments WHERE school_year_id=?1 OR invoice_id IN (SELECT invoice_id FROM enrollment_fees WHERE school_year_id=?1) OR invoice_id IN (SELECT i.id FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id WHERE g.school_year_id=?1)", params![year_id]).map_err(|e| db_err("Suppression des paiements", e))?;
    // Salary/activity records have no year FK. Delete only dates mapping
    // unambiguously to this year; preserve unknown or overlapping periods.
    tx.execute("DELETE FROM teacher_settlements WHERE EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month')) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month'))",params![year_id]).map_err(|e|db_err("Suppression des règlements enseignants",e))?;
    tx.execute("DELETE FROM teacher_compensation WHERE EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month')) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month'))",params![year_id]).map_err(|e|db_err("Suppression des rémunérations",e))?;
    tx.execute("DELETE FROM teacher_activities WHERE EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(activity_date) BETWEEN date(y.start_date) AND date(y.end_date)) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(activity_date) BETWEEN date(y.start_date) AND date(y.end_date))",params![year_id]).map_err(|e|db_err("Suppression des activités",e))?;
    tx.execute("DELETE FROM monthly_expenses WHERE school_year_id=?1", params![year_id]).map_err(|e| db_err("Suppression des dépenses", e))?;
    tx.execute("DELETE FROM invoices WHERE id IN (SELECT invoice_id FROM enrollment_fees WHERE school_year_id=?1)", params![year_id]).map_err(|e| db_err("Suppression des frais d’inscription", e))?;
    tx.execute("DELETE FROM settings WHERE key=?1", params![format!("enrollment_fee:{year_id}")]).map_err(|e| db_err("Suppression des paramètres", e))?;
    tx.execute("DELETE FROM groups WHERE school_year_id=?1", params![year_id]).map_err(|e| db_err("Suppression des groupes", e))?;
    tx.execute("DELETE FROM student_school_years WHERE school_year_id=?1", params![year_id]).map_err(|e| db_err("Suppression des liens élèves", e))?;
    tx.execute("DELETE FROM teacher_school_years WHERE school_year_id=?1", params![year_id]).map_err(|e| db_err("Suppression des liens enseignants", e))?;
    tx.execute("DELETE FROM school_years WHERE id=?1", params![year_id]).map_err(|e| db_err("Suppression de l'année", e))?;
    tx.commit().map_err(|e| db_err("Transaction", e))
}

#[tauri::command]
pub fn cmd_delete_school_year(db: State<'_, Db>, year_id: i64) -> Result<(), String> { delete_year(&db.conn(), year_id) }

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

#[tauri::command]
pub fn cmd_get_active_school_year(db: State<'_, Db>) -> Result<Option<SchoolYear>, String> {
    let conn = db.conn();
    Ok(list(&conn).map_err(|err| db_err("Lecture de l'année active", err))?
        .into_iter().find(|year| year.is_active))
}

#[tauri::command]
pub fn cmd_switch_school_year(db: State<'_, Db>, year_id: i64) -> Result<(), String> {
    set_active(&db.conn(), year_id)
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
    fn delete_inactive_year_cascades_only_its_data() {
        let conn = test_conn();
        let old = create(&conn, "2023-2024", "2023-09-01", "2024-06-30").unwrap();
        conn.execute_batch("INSERT INTO students(full_name) VALUES('S'); INSERT INTO teachers(full_name) VALUES('T');").unwrap();
        conn.execute("INSERT INTO groups(teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES(1,?1,100,10)", params![old]).unwrap();
        conn.execute_batch("INSERT INTO group_schedules(group_id,day_of_week,start_time,end_time) VALUES(1,'Lundi','09:00','10:00'); INSERT INTO enrollments(student_id,group_id,start_date) VALUES(1,1,'2023-09-01'); INSERT INTO invoices(enrollment_id,amount_cents) VALUES(1,100); INSERT INTO payments(student_id,invoice_id,amount_cents) VALUES(1,1,100); INSERT INTO receipts(payment_id) VALUES(1);").unwrap();
        conn.execute("INSERT INTO payments(student_id,amount_cents,school_year_id) VALUES(1,50,?1)",params![old]).unwrap();
        conn.execute("INSERT INTO monthly_expenses(label,amount_cents,category,month,year,school_year_id) VALUES('E',100,'x',1,2024,?1)",params![old]).unwrap();
        conn.execute("INSERT INTO student_school_years(student_id,school_year_id) VALUES(1,?1)",params![old]).unwrap();
        conn.execute("INSERT INTO teacher_school_years(teacher_id,school_year_id) VALUES(1,?1)",params![old]).unwrap();
        delete_year(&conn,old).unwrap();
        for table in ["groups","group_schedules","enrollments","invoices","payments","receipts","monthly_expenses"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get(0)).unwrap(); assert_eq!(n,0,"{table}");
        }
        assert_eq!(list(&conn).unwrap().len(),1);
        assert_eq!(conn.query_row("SELECT count(*) FROM student_school_years",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(conn.query_row("SELECT count(*) FROM teacher_school_years",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn delete_active_year_is_rejected() {
        let conn=test_conn(); let year=list(&conn).unwrap()[0].id;
        assert!(delete_year(&conn,year).is_err()); assert_eq!(list(&conn).unwrap().len(),1);
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
