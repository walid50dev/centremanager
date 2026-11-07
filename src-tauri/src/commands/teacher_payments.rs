//! Direct teacher payments. Legacy rows retain their payroll period and are
//! attributed only when that period identifies exactly one academic year.
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;
use tauri::State;
use crate::db::Db;
use super::db_err;

// `ts` is a settlement and `y` is the school year in the enclosing query.
pub const YEAR_MATCH: &str = "(ts.school_year_id=y.id OR (ts.school_year_id IS NULL AND ts.month IS NOT NULL AND ts.year IS NOT NULL AND printf('%04d-%02d',ts.year,ts.month) BETWEEN substr(y.start_date,1,7) AND substr(y.end_date,1,7) AND (SELECT count(*) FROM school_years yy WHERE printf('%04d-%02d',ts.year,ts.month) BETWEEN substr(yy.start_date,1,7) AND substr(yy.end_date,1,7))=1))";

#[derive(Debug, Serialize)]
pub struct TeacherPayment {
    pub id: i64,
    pub amount_cents: i64,
    pub payment_date: String,
    pub payment_method: String,
    pub notes: Option<String>,
    pub created_at: String,
}

fn active_teacher_year(conn: &Connection, teacher_id: i64) -> Result<i64, String> {
    conn.query_row(
        "SELECT y.id FROM school_years y JOIN teachers t ON t.id=?1
         WHERE y.is_active=1 AND t.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM teacher_school_years x WHERE x.teacher_id=t.id AND x.school_year_id=y.id AND x.deleted_at IS NOT NULL)
           AND (EXISTS (SELECT 1 FROM teacher_school_years x WHERE x.teacher_id=t.id AND x.school_year_id=y.id)
                OR EXISTS (SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=y.id AND g.deleted_at IS NULL)) LIMIT 1",
        params![teacher_id], |row| row.get(0),
    ).optional().map_err(|e| db_err("Vérification de l'enseignant", e))?
      .ok_or_else(|| "Enseignant introuvable dans l'année active".to_string())
}

pub fn create(conn: &Connection, teacher_id: i64, amount_cents: i64, payment_date: &str, method: &str, notes: Option<&str>) -> Result<i64, String> {
    if amount_cents <= 0 { return Err("Le montant doit être supérieur à 0".into()); }
    let date = NaiveDate::parse_from_str(payment_date, "%Y-%m-%d").map_err(|_| "Date invalide".to_string())?;
    if date.format("%Y-%m-%d").to_string() != payment_date { return Err("Date invalide".into()); }
    let method = method.trim();
    if !["espèces", "virement", "chèque"].contains(&method) { return Err("Mode de paiement invalide".into()); }
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction", e))?;
    let year_id = active_teacher_year(&tx, teacher_id)?;
    let month: i32 = payment_date[5..7].parse().map_err(|_| "Date invalide".to_string())?;
    let year: i32 = payment_date[0..4].parse().map_err(|_| "Date invalide".to_string())?;
    let notes = notes.map(str::trim).filter(|s| !s.is_empty());
    tx.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,payment_method,notes,month,year,payment_date,school_year_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![teacher_id,amount_cents,method,notes,month,year,payment_date,year_id]).map_err(|e| db_err("Enregistrement du paiement",e))?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('SETTLEMENT','teacher',?1,?2)", params![teacher_id, json!({"settlement_id":id,"amount_cents":amount_cents,"payment_date":payment_date,"school_year_id":year_id,"method":method}).to_string()]).map_err(|e| db_err("Journalisation",e))?;
    tx.commit().map_err(|e| db_err("Transaction",e))?;
    Ok(id)
}

pub fn list(conn: &Connection, teacher_id: i64) -> Result<Vec<TeacherPayment>, String> {
    let year_id = active_teacher_year(conn, teacher_id)?;
    let sql = format!("SELECT ts.id, COALESCE(ts.amount_cents,0), COALESCE(ts.payment_date,substr(ts.created_at,1,10),''), COALESCE(ts.payment_method,''), ts.notes, COALESCE(ts.created_at,'') FROM teacher_settlements ts JOIN school_years y ON y.id=?2 WHERE ts.teacher_id=?1 AND {} ORDER BY COALESCE(ts.payment_date,substr(ts.created_at,1,10),'') DESC, ts.id DESC", YEAR_MATCH);
    let mut stmt = conn.prepare(&sql).map_err(|e| db_err("Historique des paiements",e))?;
    let rows = stmt.query_map(params![teacher_id,year_id], |row| Ok(TeacherPayment { id:row.get(0)?, amount_cents:row.get(1)?, payment_date:row.get(2)?, payment_method:row.get(3)?, notes:row.get(4)?, created_at:row.get(5)? })).map_err(|e| db_err("Historique des paiements",e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Historique des paiements",e))
}

/// Legacy payments whose period cannot be attributed to exactly one year.
/// They remain visible separately and are never included in annual totals.
pub fn unattributed(conn: &Connection, teacher_id: i64) -> Result<Vec<TeacherPayment>, String> {
    active_teacher_year(conn, teacher_id)?;
    let sql = "SELECT ts.id, COALESCE(ts.amount_cents,0), COALESCE(ts.payment_date,substr(ts.created_at,1,10),''), COALESCE(ts.payment_method,''), ts.notes, COALESCE(ts.created_at,'') FROM teacher_settlements ts WHERE ts.teacher_id=?1 AND ts.school_year_id IS NULL AND (ts.month IS NULL OR ts.year IS NULL OR (SELECT count(*) FROM school_years y WHERE printf('%04d-%02d',ts.year,ts.month) BETWEEN substr(y.start_date,1,7) AND substr(y.end_date,1,7))<>1) ORDER BY COALESCE(ts.payment_date,substr(ts.created_at,1,10),'') DESC, ts.id DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Historique non attribué",e))?;
    let rows = stmt.query_map(params![teacher_id], |row| Ok(TeacherPayment { id:row.get(0)?, amount_cents:row.get(1)?, payment_date:row.get(2)?, payment_method:row.get(3)?, notes:row.get(4)?, created_at:row.get(5)? })).map_err(|e| db_err("Historique non attribué",e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Historique non attribué",e))
}

#[tauri::command]
pub fn cmd_create_teacher_payment(db: State<'_, Db>, teacher_id: i64, amount_cents: i64, payment_date: String, method: String, notes: Option<String>) -> Result<i64,String> {
    create(&db.conn(),teacher_id,amount_cents,&payment_date,&method,notes.as_deref())
}
#[tauri::command]
pub fn cmd_list_teacher_payments(db: State<'_, Db>, teacher_id: i64) -> Result<Vec<TeacherPayment>,String> {
    list(&db.conn(),teacher_id)
}

#[tauri::command]
pub fn cmd_list_unattributed_teacher_payments(db: State<'_, Db>, teacher_id: i64) -> Result<Vec<TeacherPayment>,String> {
    unattributed(&db.conn(),teacher_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_and_legacy_payments_are_year_scoped_without_config() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO teachers(id,full_name) VALUES(1,'T')", []).unwrap();
        // The membership trigger attaches the teacher to the active year.
        assert!(create(&conn, 1, 0, "2026-11-07", "espèces", None).is_err());
        assert!(create(&conn, 1, 100, "2026-02-30", "espèces", None).is_err());
        assert!(create(&conn, 1, 100, "2026-11-07", "autre", None).is_err());
        let first = create(&conn,1,12000,"2026-11-07","virement",Some(" Test ")).unwrap();
        let rows = list(&conn,1).unwrap();
        assert_eq!(rows.len(),1); assert_eq!(rows[0].id,first); assert_eq!(rows[0].payment_date,"2026-11-07");
        assert_eq!(rows[0].notes.as_deref(),Some("Test"));
        conn.execute("INSERT INTO school_years(id,label,start_date,end_date,is_active) VALUES(2,'2025-2026','2025-09-01','2026-06-30',0)", []).unwrap();
        conn.execute("INSERT INTO teacher_school_years(teacher_id,school_year_id) VALUES(1,2)", []).unwrap();
        conn.execute("INSERT INTO teacher_settlements(teacher_id,amount_cents,payment_method,month,year,created_at) VALUES(1,9000,'chèque',10,2025,'2025-11-01 10:00:00')", []).unwrap();
        conn.execute("UPDATE school_years SET is_active=CASE WHEN id=2 THEN 1 ELSE 0 END", []).unwrap();
        assert_eq!(list(&conn,1).unwrap().len(),1);
        let second = create(&conn,1,23000,"2026-11-07","espèces",None).unwrap();
        assert!(list(&conn,1).unwrap().iter().any(|row|row.id==second));
        conn.execute("UPDATE school_years SET is_active=CASE WHEN id=1 THEN 1 ELSE 0 END", []).unwrap();
        assert_eq!(list(&conn,1).unwrap().iter().map(|row|row.id).collect::<Vec<_>>(),vec![first]);
    }
}
