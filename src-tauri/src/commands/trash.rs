//! Reversible deletion. Financial history is never physically deleted here.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use crate::db::Db;
use super::db_err;

#[derive(Debug, Serialize)]
pub struct TrashItem {
    pub entity_type: String,
    pub entity_id: i64,
    pub name: String,
    pub deleted_at: String,
    pub expires_at: String,
    pub days_remaining: i64,
    pub permanent: bool,
    pub has_financial_history: bool,
}

fn table(kind: &str) -> Result<&'static str, String> {
    match kind {
        "student" => Ok("students"), "teacher" => Ok("teachers"),
        "group" => Ok("groups"), "expense" => Ok("monthly_expenses"),
        _ => Err("Type de corbeille invalide".into()),
    }
}

/// Be conservative: a teacher's associated groups/invoices also count.
fn has_history(conn: &Connection, kind: &str, id: i64) -> Result<bool, String> {
    let sql = match kind {
        "student" => "SELECT EXISTS(SELECT 1 FROM payments WHERE student_id=?1) OR EXISTS(SELECT 1 FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id WHERE e.student_id=?1) OR EXISTS(SELECT 1 FROM enrollments e JOIN groups g ON g.id=e.group_id JOIN teacher_settlements ts ON ts.teacher_id=g.teacher_id WHERE e.student_id=?1) OR EXISTS(SELECT 1 FROM enrollments e JOIN groups g ON g.id=e.group_id JOIN teacher_compensation tc ON tc.teacher_id=g.teacher_id WHERE e.student_id=?1)",
        "group" => "SELECT EXISTS(SELECT 1 FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id WHERE e.group_id=?1) OR EXISTS(SELECT 1 FROM enrollments e JOIN payments p ON p.student_id=e.student_id WHERE e.group_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN teacher_settlements ts ON ts.teacher_id=g.teacher_id WHERE g.id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN teacher_compensation tc ON tc.teacher_id=g.teacher_id WHERE g.id=?1)",
        "teacher" => "SELECT EXISTS(SELECT 1 FROM teacher_settlements WHERE teacher_id=?1) OR EXISTS(SELECT 1 FROM teacher_compensation WHERE teacher_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN enrollments e ON e.group_id=g.id JOIN invoices i ON i.enrollment_id=e.id WHERE g.teacher_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN enrollments e ON e.group_id=g.id JOIN payments p ON p.student_id=e.student_id WHERE g.teacher_id=?1)",
        "expense" => "SELECT 0 * ?1",
        _ => return Err("Type de corbeille invalide".into()),
    };
    conn.query_row(sql, params![id], |row| row.get::<_, bool>(0))
        .map_err(|e| db_err("Vérification de l'historique financier", e))
}

fn audit(conn: &Connection, action: &str, kind: &str, id: i64) -> Result<(), String> {
    conn.execute("INSERT INTO audit_log(action, entity_type, entity_id) VALUES (?1, ?2, ?3)", params![action, kind, id])
        .map(|_| ()).map_err(|e| db_err("Journalisation", e))
}

pub fn delete_to_trash(conn: &Connection, kind: &str, id: i64) -> Result<(), String> {
    let table = table(kind)?;
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction", e))?;
    let count = tx.execute(&format!("UPDATE {table} SET deleted_at=datetime('now') WHERE id=?1 AND deleted_at IS NULL"), params![id]).map_err(|e| db_err("Suppression", e))?;
    if count == 0 { return Err("Élément introuvable ou déjà supprimé".into()); }
    audit(&tx, "TRASH", kind, id)?;
    tx.commit().map_err(|e| db_err("Transaction", e))
}

pub fn restore(conn: &Connection, kind: &str, id: i64) -> Result<(), String> {
    let table = table(kind)?;
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction", e))?;
    let count = tx.execute(&format!("UPDATE {table} SET deleted_at=NULL WHERE id=?1 AND deleted_at IS NOT NULL"), params![id]).map_err(|e| db_err("Restauration", e))?;
    if count == 0 { return Err("Élément introuvable dans la corbeille".into()); }
    audit(&tx, "RESTORE", kind, id)?;
    tx.commit().map_err(|e| db_err("Transaction", e))
}

pub fn list(conn: &Connection) -> Result<Vec<TrashItem>, String> {
    let sql = "SELECT 'student', id, full_name, deleted_at FROM students WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'teacher', id, COALESCE(full_name, '—'), deleted_at FROM teachers WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'group', g.id, COALESCE(s.name, 'Groupe') || ' — ' || COALESCE(l.name, ''), g.deleted_at FROM groups g LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id WHERE g.deleted_at IS NOT NULL
        UNION ALL SELECT 'expense', id, label, deleted_at FROM monthly_expenses WHERE deleted_at IS NOT NULL
        ORDER BY 4 DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Lecture de la corbeille", e))?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
        .map_err(|e| db_err("Lecture de la corbeille", e))?;
    let mut out = Vec::new();
    for row in rows {
        let (kind,id,name,deleted_at) = row.map_err(|e| db_err("Lecture", e))?;
        let (expires_at, days, expired): (String, i64, bool) = conn.query_row(
            "SELECT datetime(?1, '+30 days'), MAX(0, CAST((julianday(datetime(?1, '+30 days')) - julianday('now') + 0.999999) AS INTEGER)), datetime(?1, '+30 days') <= datetime('now')",
            params![deleted_at], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
            .map_err(|e| db_err("Date de suppression", e))?;
        let financial = has_history(conn, &kind, id)?;
        out.push(TrashItem { entity_type: kind, entity_id: id, name, deleted_at, expires_at, days_remaining: days, permanent: expired && financial, has_financial_history: financial });
    }
    Ok(out)
}

/// Only trashed records without *any* financial history may be hard-deleted.
fn remove_checked(conn: &Connection, kind: &str, id: i64) -> Result<bool, String> {
    let table = table(kind)?;
    let deleted: Option<String> = conn.query_row(&format!("SELECT deleted_at FROM {table} WHERE id=?1 AND deleted_at IS NOT NULL"), params![id], |r| r.get(0)).optional().map_err(|e| db_err("Lecture",e))?;
    if deleted.is_none() { return Err("Élément introuvable dans la corbeille".into()); }
    if has_history(conn, kind, id)? { return Ok(false); }
    conn.execute(&format!("DELETE FROM {table} WHERE id=?1 AND deleted_at IS NOT NULL"), params![id]).map_err(|e| db_err("Suppression définitive",e))?;
    audit(conn, "PURGE", kind, id)?;
    Ok(true)
}

pub fn purge_expired(conn: &Connection) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction",e))?;
    let mut count = 0;
    for item in list(&tx)? {
        let expired: bool = tx.query_row("SELECT datetime(?1) <= datetime('now')", params![item.expires_at], |r| r.get(0))
            .map_err(|e| db_err("Expiration", e))?;
        if expired && remove_checked(&tx, &item.entity_type, item.entity_id)? { count += 1; }
    }
    tx.commit().map_err(|e| db_err("Transaction",e))?;
    Ok(count)
}

#[tauri::command]
pub fn cmd_delete_to_trash(db: State<'_, Db>, entity_type: String, entity_id: i64) -> Result<(), String> { delete_to_trash(&db.conn(), &entity_type, entity_id) }
#[tauri::command]
pub fn cmd_list_trash(db: State<'_, Db>) -> Result<Vec<TrashItem>, String> { list(&db.conn()) }
#[tauri::command]
pub fn cmd_restore_from_trash(db: State<'_, Db>, entity_type: String, entity_id: i64) -> Result<(), String> { restore(&db.conn(), &entity_type, entity_id) }
#[tauri::command]
pub fn cmd_purge_trash(db: State<'_, Db>) -> Result<usize, String> { purge_expired(&db.conn()) }
#[tauri::command]
pub fn cmd_delete_permanently(db: State<'_, Db>, entity_type: String, entity_id: i64) -> Result<(), String> {
    let conn = db.conn(); let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction",e))?;
    if !remove_checked(&tx, &entity_type, entity_id)? { return Err("Conservé pour historique financier".into()); }
    tx.commit().map_err(|e| db_err("Transaction",e))
}
#[tauri::command]
pub fn cmd_empty_trash(db: State<'_, Db>) -> Result<usize, String> {
    let conn = db.conn(); let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction",e))?;
    let mut count = 0;
    for item in list(&tx)? { if remove_checked(&tx, &item.entity_type, item.entity_id)? { count += 1; } }
    tx.commit().map_err(|e| db_err("Transaction",e))?; Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection { let c=Connection::open_in_memory().unwrap(); c.execute_batch("PRAGMA foreign_keys=ON").unwrap(); crate::db::run_migrations(&c).unwrap(); c }
    #[test] fn trash_and_restore_each_kind() {
        let c=db();
        c.execute_batch("INSERT INTO students(full_name) VALUES('S'); INSERT INTO teachers(full_name) VALUES('T'); INSERT INTO groups(monthly_fee_cents,capacity) VALUES(100,10); INSERT INTO monthly_expenses(label,amount_cents,category,month,year) VALUES('E',100,'x',1,2026);").unwrap();
        for kind in ["student","teacher","group","expense"] { delete_to_trash(&c,kind,1).unwrap(); }
        assert_eq!(list(&c).unwrap().len(),4);
        for kind in ["student","teacher","group","expense"] { restore(&c,kind,1).unwrap(); }
        assert!(list(&c).unwrap().is_empty());
    }
    #[test] fn expired_without_history_is_purged() {
        let c=db(); c.execute("INSERT INTO students(full_name) VALUES('S')", []).unwrap(); delete_to_trash(&c,"student",1).unwrap();
        c.execute("UPDATE students SET deleted_at=datetime('now','-31 days') WHERE id=1", []).unwrap();
        assert_eq!(purge_expired(&c).unwrap(),1); assert_eq!(c.query_row("SELECT COUNT(*) FROM students",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    #[test] fn invoices_and_payments_are_preserved() {
        let c=db(); c.execute_batch("INSERT INTO students(full_name) VALUES('S'); INSERT INTO groups(monthly_fee_cents,capacity) VALUES(100,10); INSERT INTO enrollments(student_id,group_id,start_date) VALUES(1,1,'2026-01-01'); INSERT INTO invoices(enrollment_id,amount_cents) VALUES(1,100); INSERT INTO payments(student_id,invoice_id,amount_cents) VALUES(1,1,100); INSERT INTO receipts(payment_id) VALUES(1);").unwrap();
        for kind in ["student","group"] { delete_to_trash(&c,kind,1).unwrap(); }
        c.execute_batch("UPDATE students SET deleted_at=datetime('now','-31 days'); UPDATE groups SET deleted_at=datetime('now','-31 days');").unwrap();
        assert_eq!(purge_expired(&c).unwrap(),0); assert!(list(&c).unwrap().iter().all(|i|i.permanent));
        assert_eq!(c.query_row("SELECT COUNT(*) FROM payments",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM receipts",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test] fn active_rows_cannot_be_purged() {
        let c=db(); c.execute("INSERT INTO students(full_name) VALUES('S')", []).unwrap();
        assert!(remove_checked(&c, "student", 1).is_err());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM students",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(delete_to_trash(&c, "payments", 1).is_err());
    }
    #[test] fn teacher_settlements_prevent_purge() {
        let c=db(); c.execute_batch("INSERT INTO teachers(full_name) VALUES('T'); INSERT INTO teacher_settlements(teacher_id,amount_cents) VALUES(1,100);").unwrap();
        delete_to_trash(&c,"teacher",1).unwrap(); c.execute("UPDATE teachers SET deleted_at=datetime('now','-31 days')",[]).unwrap();
        assert_eq!(purge_expired(&c).unwrap(),0); assert!(list(&c).unwrap()[0].permanent);
    }
}
