//! Attendance records, scoped through their group's school year.
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::Db;
use super::db_err;

#[derive(Debug, Clone, Serialize)]
pub struct AbsenceRow {
    pub id: i64,
    pub student_id: i64,
    pub group_id: i64,
    pub group_name: String,
    pub absence_date: String,
    pub reason: Option<String>,
    pub is_justified: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AbsenceInput {
    pub student_id: i64,
    pub group_id: i64,
    pub absence_date: String,
    pub reason: Option<String>,
    pub is_justified: bool,
}

pub fn add_absence(conn: &Connection, data: &AbsenceInput) -> Result<i64, String> {
    let date = NaiveDate::parse_from_str(&data.absence_date, "%Y-%m-%d").map_err(|_| "Date invalide".to_string())?;
    if date.format("%Y-%m-%d").to_string() != data.absence_date { return Err("Date invalide".into()); }
    let eligible: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM enrollments e JOIN students s ON s.id=e.student_id JOIN groups g ON g.id=e.group_id JOIN school_years y ON y.id=g.school_year_id WHERE e.student_id=?1 AND e.group_id=?2 AND s.deleted_at IS NULL AND g.deleted_at IS NULL AND y.is_active=1 AND ?3 BETWEEN y.start_date AND y.end_date)",
        params![data.student_id, data.group_id, data.absence_date], |r| r.get(0),
    ).map_err(|e| db_err("Vérification de l'inscription", e))?;
    if !eligible { return Err("Groupe ou date invalide pour l'année scolaire active".into()); }
    conn.execute("INSERT INTO absences(student_id,group_id,absence_date,reason,is_justified) VALUES (?1,?2,?3,?4,?5)",
        params![data.student_id, data.group_id, data.absence_date, data.reason.as_deref().map(str::trim).filter(|s| !s.is_empty()), data.is_justified])
        .map_err(|e| db_err("Ajout de l'absence", e))?;
    Ok(conn.last_insert_rowid())
}

pub fn student_absences(conn: &Connection, student_id: i64) -> Result<Vec<AbsenceRow>, String> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM students WHERE id=?1 AND deleted_at IS NULL)", params![student_id], |r| r.get(0)).map_err(|e| db_err("Lecture de l'élève", e))?;
    if !exists { return Err("Élève introuvable".into()); }
    let mut stmt = conn.prepare("SELECT a.id,a.student_id,a.group_id,COALESCE(NULLIF(TRIM(g.name),''), su.name || ' — ' || l.name, '—'),a.absence_date,a.reason,a.is_justified,a.created_at FROM absences a JOIN groups g ON g.id=a.group_id LEFT JOIN subjects su ON su.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id WHERE a.student_id=?1 AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND g.deleted_at IS NULL ORDER BY a.absence_date DESC,a.id DESC").map_err(|e| db_err("Lecture des absences", e))?;
    let rows = stmt.query_map(params![student_id], |r| Ok(AbsenceRow { id:r.get(0)?, student_id:r.get(1)?, group_id:r.get(2)?, group_name:r.get(3)?, absence_date:r.get(4)?, reason:r.get(5)?, is_justified:r.get(6)?, created_at:r.get(7)? })).map_err(|e| db_err("Lecture des absences", e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Lecture des absences", e))
}

pub fn delete_absence(conn: &Connection, id: i64) -> Result<(), String> {
    let found: Option<i64> = conn.query_row("SELECT a.id FROM absences a JOIN groups g ON g.id=a.group_id WHERE a.id=?1 AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND g.deleted_at IS NULL", params![id], |r| r.get(0)).optional().map_err(|e| db_err("Lecture de l'absence", e))?;
    if found.is_none() { return Err("Absence introuvable".into()); }
    conn.execute("DELETE FROM absences WHERE id=?1", params![id]).map_err(|e| db_err("Suppression de l'absence", e))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_add_absence(db: State<'_, Db>, data: AbsenceInput) -> Result<i64, String> { add_absence(&db.conn(), &data) }
#[tauri::command]
pub fn cmd_get_student_absences(db: State<'_, Db>, student_id: i64) -> Result<Vec<AbsenceRow>, String> { student_absences(&db.conn(), student_id) }
#[tauri::command]
pub fn cmd_delete_absence(db: State<'_, Db>, id: i64) -> Result<(), String> { delete_absence(&db.conn(), id) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absences_validate_scope_and_cascade() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute("UPDATE school_years SET start_date='2026-01-01',end_date='2026-12-31',is_active=1 WHERE id=1", []).unwrap();
        conn.execute("INSERT INTO students(id,full_name) VALUES(1,'Salma')", []).unwrap();
        conn.execute("INSERT INTO groups(id,name,school_year_id,monthly_fee_cents,capacity) VALUES(1,'Atlas',1,10000,10)", []).unwrap();
        conn.execute("INSERT INTO enrollments(student_id,group_id,start_date,status) VALUES(1,1,'2026-01-01','actif')", []).unwrap();
        let mut data = AbsenceInput { student_id:1,group_id:1,absence_date:"2026-02-12".into(),reason:Some(" Malade ".into()),is_justified:true };
        let id = add_absence(&conn, &data).unwrap();
        let rows = student_absences(&conn,1).unwrap();
        assert_eq!(rows.len(),1); assert_eq!(rows[0].group_name,"Atlas"); assert_eq!(rows[0].reason.as_deref(),Some("Malade")); assert!(rows[0].is_justified);
        data.absence_date = "2026-02-30".into(); assert!(add_absence(&conn,&data).is_err());
        data.absence_date = "2025-12-12".into(); assert!(add_absence(&conn,&data).is_err());
        delete_absence(&conn,id).unwrap(); assert!(student_absences(&conn,1).unwrap().is_empty());
        data.absence_date = "2026-02-12".into(); add_absence(&conn,&data).unwrap();
        conn.execute("DELETE FROM groups WHERE id=1",[]).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM absences",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}
