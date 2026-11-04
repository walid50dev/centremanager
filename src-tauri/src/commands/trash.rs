//! Year-scoped trash. Explicit permanent deletion is irreversible.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use crate::db::Db;
use super::db_err;

#[derive(Debug, Serialize)]
pub struct TrashItem {
    pub entity_type: String, pub entity_id: i64, pub name: String,
    pub guardian_phone: Option<String>,
    pub deleted_at: String, pub expires_at: String, pub days_remaining: i64,
    pub permanent: bool, pub has_financial_history: bool,
}

fn active_year(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT id FROM school_years WHERE is_active=1 LIMIT 1", [], |r| r.get(0))
        .optional().map_err(|e| db_err("Année active", e))?
        .ok_or_else(|| "Aucune année scolaire active".into())
}
fn audit(conn: &Connection, action: &str, kind: &str, id: i64) -> Result<(), String> {
    conn.execute("INSERT INTO audit_log(action, entity_type, entity_id) VALUES (?1, ?2, ?3)", params![action,kind,id])
        .map(|_| ()).map_err(|e| db_err("Journalisation",e))
}

pub fn delete_to_trash(conn: &Connection, kind: &str, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction",e))?;
    let year = active_year(&tx)?;
    let count = match kind {
        "student" => tx.execute("UPDATE students SET deleted_at=datetime('now'), trash_school_year_id=?2 WHERE id=?1 AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM student_school_years sy WHERE sy.student_id=students.id AND sy.school_year_id=?2)", params![id,year]),
        "teacher" => {
            tx.execute("INSERT OR IGNORE INTO teacher_school_years(teacher_id,school_year_id)
                SELECT id,?2 FROM teachers t WHERE id=?1 AND deleted_at IS NULL AND EXISTS
                (SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?2)", params![id,year]).map_err(|e| db_err("Suppression",e))?;
            tx.execute("UPDATE teacher_school_years SET deleted_at=datetime('now') WHERE teacher_id=?1 AND school_year_id=?2 AND deleted_at IS NULL", params![id,year])
        },
        "group" => tx.execute("UPDATE groups SET deleted_at=datetime('now') WHERE id=?1 AND school_year_id=?2 AND deleted_at IS NULL",params![id,year]),
        "expense" => tx.execute("UPDATE monthly_expenses SET deleted_at=datetime('now') WHERE id=?1 AND school_year_id=?2 AND deleted_at IS NULL",params![id,year]),
        _ => return Err("Type de corbeille invalide".into()),
    }.map_err(|e| db_err("Suppression",e))?;
    if count == 0 { return Err("Élément introuvable ou déjà supprimé".into()); }
    audit(&tx,"TRASH",kind,id)?; tx.commit().map_err(|e| db_err("Transaction",e))
}

pub fn restore(conn: &Connection, kind: &str, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Transaction",e))?;
    let year = active_year(&tx)?;
    let count = match kind {
        "student" => tx.execute("UPDATE students SET deleted_at=NULL, trash_school_year_id=NULL WHERE id=?1 AND trash_school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]),
        "teacher" => tx.execute("UPDATE teacher_school_years SET deleted_at=NULL WHERE teacher_id=?1 AND school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]),
        "group" => tx.execute("UPDATE groups SET deleted_at=NULL WHERE id=?1 AND school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]),
        "expense" => tx.execute("UPDATE monthly_expenses SET deleted_at=NULL WHERE id=?1 AND school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]),
        _ => return Err("Type de corbeille invalide".into()),
    }.map_err(|e| db_err("Restauration",e))?;
    if count == 0 { return Err("Élément introuvable dans la corbeille".into()); }
    audit(&tx,"RESTORE",kind,id)?; tx.commit().map_err(|e| db_err("Transaction",e))
}

fn has_history(conn: &Connection, kind: &str, id: i64) -> Result<bool, String> {
    let sql = match kind {
        "student" => "SELECT EXISTS(SELECT 1 FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id WHERE e.student_id=?1) OR EXISTS(SELECT 1 FROM payments WHERE student_id=?1) OR EXISTS(SELECT 1 FROM enrollment_fees WHERE student_id=?1)",
        "group" => "SELECT EXISTS(SELECT 1 FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id WHERE e.group_id=?1) OR EXISTS(SELECT 1 FROM enrollments e JOIN payments p ON p.student_id=e.student_id WHERE e.group_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN teacher_settlements ts ON ts.teacher_id=g.teacher_id WHERE g.id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN teacher_compensation tc ON tc.teacher_id=g.teacher_id WHERE g.id=?1)",
        "teacher" => "SELECT EXISTS(SELECT 1 FROM teacher_settlements WHERE teacher_id=?1) OR EXISTS(SELECT 1 FROM teacher_compensation WHERE teacher_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN enrollments e ON e.group_id=g.id JOIN invoices i ON i.enrollment_id=e.id WHERE g.teacher_id=?1) OR EXISTS(SELECT 1 FROM groups g JOIN enrollments e ON e.group_id=g.id JOIN payments p ON p.student_id=e.student_id WHERE g.teacher_id=?1)",
        "expense" => "SELECT 0 * ?1", _ => return Err("Type de corbeille invalide".into()),
    };
    conn.query_row(sql,params![id],|r|r.get(0)).map_err(|e|db_err("Historique",e))
}

pub fn list(conn: &Connection) -> Result<Vec<TrashItem>, String> {
    let year = active_year(conn)?;
    let sql = "SELECT 'student', st.id, COALESCE(NULLIF(st.full_name,''), TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')), '—'), st.deleted_at, COALESCE(NULLIF(st.guardian_phone,''), NULLIF(st.phone,'')) FROM students st WHERE st.trash_school_year_id=?1 AND st.deleted_at IS NOT NULL
        UNION ALL SELECT 'teacher', t.id, COALESCE(t.full_name,'—'), ty.deleted_at, NULL FROM teacher_school_years ty JOIN teachers t ON t.id=ty.teacher_id WHERE ty.school_year_id=?1 AND ty.deleted_at IS NOT NULL
        UNION ALL SELECT 'group', g.id, COALESCE(s.name,'Groupe') || ' — ' || COALESCE(l.name,''), g.deleted_at, NULL FROM groups g LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id WHERE g.school_year_id=?1 AND g.deleted_at IS NOT NULL
        UNION ALL SELECT 'expense', id, label, deleted_at, NULL FROM monthly_expenses WHERE school_year_id=?1 AND deleted_at IS NOT NULL ORDER BY 4 DESC";
    let mut stmt = conn.prepare(sql).map_err(|e|db_err("Lecture de la corbeille",e))?;
    let rows = stmt.query_map(params![year],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?)))
        .map_err(|e|db_err("Lecture de la corbeille",e))?;
    let mut out = Vec::new();
    for row in rows {
        let (kind,id,name,deleted_at,guardian_phone) = row.map_err(|e|db_err("Lecture",e))?;
        let (expires_at,days,expired): (String,i64,bool) = conn.query_row("SELECT datetime(?1,'+30 days'), MAX(0,CAST((julianday(datetime(?1,'+30 days'))-julianday('now')+0.999999) AS INTEGER)), datetime(?1,'+30 days')<=datetime('now')",params![deleted_at],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|db_err("Date",e))?;
        let financial = has_history(conn,&kind,id)?;
        out.push(TrashItem {permanent:expired && financial && kind != "student", entity_type:kind,entity_id:id,name,guardian_phone,deleted_at,expires_at,days_remaining:days,has_financial_history:financial});
    }
    Ok(out)
}

/// Remove payment rows before invoices: their FK otherwise sets invoice_id NULL.
pub(crate) fn delete_group_data(conn: &Connection, group_id: i64) -> Result<(), String> {
    // A receipt snapshots a whole batch, even if its first allocation belongs
    // to another group. Remove the affected year's batch receipts too.
    conn.execute("DELETE FROM receipts WHERE payment_id IN (SELECT base.id FROM payments base JOIN payments affected ON affected.batch_id=base.batch_id JOIN invoices i ON i.id=affected.invoice_id JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id WHERE g.id=?1 AND affected.batch_id IS NOT NULL AND base.school_year_id=g.school_year_id)",params![group_id]).map_err(|e|db_err("Suppression des reçus",e))?;
    conn.execute("DELETE FROM payments WHERE invoice_id IN (SELECT i.id FROM invoices i JOIN enrollments e ON e.id=i.enrollment_id WHERE e.group_id=?1)",params![group_id]).map_err(|e|db_err("Suppression des paiements",e))?;
    conn.execute("DELETE FROM groups WHERE id=?1",params![group_id]).map_err(|e|db_err("Suppression du groupe",e))?;
    Ok(())
}

fn remove(conn: &Connection, kind: &str, id: i64) -> Result<(), String> {
    let year=active_year(conn)?;
    if !list(conn)?.iter().any(|i|i.entity_type==kind && i.entity_id==id) { return Err("Élément introuvable dans la corbeille".into()); }
    match kind {
        "student" => super::students::purge_student_data(conn,id)?,
        "group" => delete_group_data(conn,id)?,
        "expense" => {conn.execute("DELETE FROM monthly_expenses WHERE id=?1 AND school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]).map_err(|e|db_err("Suppression",e))?;},
        "teacher" => {
            // Delete only periods uniquely belonging to this year. Shared or
            // undated history is retained rather than attributed by guesswork.
            conn.execute("DELETE FROM teacher_settlements WHERE teacher_id=?2 AND EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month')) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month'))",params![year,id]).map_err(|e|db_err("Suppression des règlements",e))?;
            conn.execute("DELETE FROM teacher_compensation WHERE teacher_id=?2 AND EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month')) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(printf('%04d-%02d-01',year,month)) BETWEEN date(y.start_date,'start of month') AND date(y.end_date,'start of month'))",params![year,id]).map_err(|e|db_err("Suppression des rémunérations",e))?;
            conn.execute("DELETE FROM teacher_activities WHERE teacher_id=?2 AND EXISTS (SELECT 1 FROM school_years y WHERE y.id=?1 AND date(activity_date) BETWEEN date(y.start_date) AND date(y.end_date)) AND NOT EXISTS (SELECT 1 FROM school_years y WHERE y.id<>?1 AND date(activity_date) BETWEEN date(y.start_date) AND date(y.end_date))",params![year,id]).map_err(|e|db_err("Suppression des activités",e))?;
            // Detach only this year's groups. Other-year links remain intact.
            conn.execute("UPDATE groups SET teacher_id=NULL WHERE teacher_id=?1 AND school_year_id=?2",params![id,year]).map_err(|e|db_err("Dissociation",e))?;
            conn.execute("DELETE FROM teacher_school_years WHERE teacher_id=?1 AND school_year_id=?2 AND deleted_at IS NOT NULL",params![id,year]).map_err(|e|db_err("Dissociation",e))?;
            // Keep shared records (including history with an ambiguous period).
            conn.execute("DELETE FROM teachers WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM teacher_school_years WHERE teacher_id=?1) AND NOT EXISTS(SELECT 1 FROM groups WHERE teacher_id=?1)
                AND NOT EXISTS(SELECT 1 FROM teacher_settlements WHERE teacher_id=?1)
                AND NOT EXISTS(SELECT 1 FROM teacher_compensation WHERE teacher_id=?1)
                AND NOT EXISTS(SELECT 1 FROM teacher_activities WHERE teacher_id=?1)",params![id]).map_err(|e|db_err("Suppression de l'enseignant",e))?;
        },
        _ => return Err("Type de corbeille invalide".into()),
    }
    audit(conn,"PURGE",kind,id)
}

pub fn purge_expired(conn: &Connection) -> Result<usize,String> {
    let tx=conn.unchecked_transaction().map_err(|e|db_err("Transaction",e))?;
    // Students expire globally after 30 days, including inactive school years.
    // Legacy soft-deletions without a known owner are never silently purged.
    let expired: Vec<i64> = {
        let mut stmt=tx.prepare("SELECT id FROM students WHERE deleted_at IS NOT NULL AND trash_school_year_id IS NOT NULL AND datetime(deleted_at)<=datetime('now','-30 days')").map_err(|e|db_err("Lecture de la corbeille",e))?;
        let rows=stmt.query_map([], |r| r.get(0)).map_err(|e|db_err("Lecture de la corbeille",e))?;
        rows.collect::<rusqlite::Result<Vec<i64>>>().map_err(|e|db_err("Lecture de la corbeille",e))?
    };
    let mut count=0;
    for id in expired { super::students::purge_student_data(&tx,id)?; audit(&tx,"PURGE","student",id)?; count+=1; }
    for item in list(&tx)? { if item.days_remaining == 0 && !item.has_financial_history { remove(&tx,&item.entity_type,item.entity_id)?; count+=1; } }
    tx.commit().map_err(|e|db_err("Transaction",e))?; Ok(count)
}
pub fn empty(conn: &Connection) -> Result<usize,String> {
    let tx=conn.unchecked_transaction().map_err(|e|db_err("Transaction",e))?; let items=list(&tx)?; let count=items.len();
    // Group deletion can remove links, but not the remaining trash rows.
    for item in items { remove(&tx,&item.entity_type,item.entity_id)?; }
    tx.commit().map_err(|e|db_err("Transaction",e))?; Ok(count)
}
#[tauri::command] pub fn cmd_delete_to_trash(db: State<'_,Db>, entity_type:String, entity_id:i64)->Result<(),String>{delete_to_trash(&db.conn(),&entity_type,entity_id)}
#[tauri::command] pub fn cmd_list_trash(db: State<'_,Db>)->Result<Vec<TrashItem>,String>{list(&db.conn())}
#[tauri::command] pub fn cmd_restore_from_trash(db: State<'_,Db>, entity_type:String, entity_id:i64)->Result<(),String>{restore(&db.conn(),&entity_type,entity_id)}
#[tauri::command] pub fn cmd_purge_trash(db: State<'_,Db>)->Result<usize,String>{purge_expired(&db.conn())}
#[tauri::command] pub fn cmd_delete_permanently(db: State<'_,Db>, entity_type:String, entity_id:i64)->Result<(),String>{let conn=db.conn(); let tx=conn.unchecked_transaction().map_err(|e|db_err("Transaction",e))?; remove(&tx,&entity_type,entity_id)?; tx.commit().map_err(|e|db_err("Transaction",e))}
#[tauri::command] pub fn cmd_empty_trash(db: State<'_,Db>)->Result<usize,String>{empty(&db.conn())}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection { let c=Connection::open_in_memory().unwrap(); crate::db::run_migrations(&c).unwrap(); c }
    fn count(c: &Connection, table: &str) -> i64 { c.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get(0)).unwrap() }
    #[test]
    fn empty_only_visible_year_deletes_group_financial_rows() {
        let c=db();
        c.execute_batch("INSERT INTO school_years(label,start_date,end_date,is_active) VALUES('other','2025-09-01','2026-06-30',0); INSERT INTO students(full_name) VALUES('S'); INSERT INTO groups(school_year_id,monthly_fee_cents,capacity) VALUES(1,100,10),(2,100,10); INSERT INTO enrollments(student_id,group_id,start_date) VALUES(1,1,'2024-09-01'); INSERT INTO invoices(enrollment_id,amount_cents) VALUES(1,100); INSERT INTO payments(student_id,invoice_id,amount_cents) VALUES(1,1,100); INSERT INTO receipts(payment_id) VALUES(1); UPDATE groups SET deleted_at=datetime('now');").unwrap();
        assert_eq!(list(&c).unwrap().len(),1); assert_eq!(empty(&c).unwrap(),1);
        assert_eq!(count(&c,"groups"),1); assert_eq!(count(&c,"payments"),0); assert_eq!(count(&c,"receipts"),0);
        c.execute("UPDATE school_years SET is_active=(id=2)",[]).unwrap(); assert_eq!(list(&c).unwrap().len(),1);
    }
    #[test]
    fn shared_teacher_is_detached_only_from_active_year() {
        let c=db(); c.execute_batch("INSERT INTO school_years(label,start_date,end_date,is_active) VALUES('other','2025-09-01','2026-06-30',0); INSERT INTO teachers(full_name) VALUES('T'); INSERT INTO teacher_school_years(teacher_id,school_year_id) VALUES(1,2); INSERT INTO groups(teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES(1,1,100,10),(1,2,100,10); INSERT INTO teacher_settlements(teacher_id,amount_cents,month,year) VALUES(1,100,10,2025);").unwrap();
        delete_to_trash(&c,"teacher",1).unwrap(); assert_eq!(list(&c).unwrap().len(),1); assert_eq!(empty(&c).unwrap(),1);
        assert_eq!(count(&c,"teachers"),1); assert_eq!(count(&c,"teacher_settlements"),1);
        assert_eq!(c.query_row("SELECT teacher_id FROM groups WHERE school_year_id=1",[],|r|r.get::<_,Option<i64>>(0)).unwrap(),None);
        assert_eq!(c.query_row("SELECT teacher_id FROM groups WHERE school_year_id=2",[],|r|r.get::<_,Option<i64>>(0)).unwrap(),Some(1));
        assert_eq!(c.query_row("SELECT count(*) FROM teacher_school_years WHERE school_year_id=2",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn trash_restore_is_year_scoped_including_students() {
        let c=db(); c.execute_batch("INSERT INTO teachers(full_name) VALUES('T'); INSERT INTO students(full_name) VALUES('S');").unwrap();
        delete_to_trash(&c,"student",1).unwrap(); delete_to_trash(&c,"teacher",1).unwrap();
        assert_eq!(list(&c).unwrap().len(),2); restore(&c,"student",1).unwrap(); restore(&c,"teacher",1).unwrap(); assert!(list(&c).unwrap().is_empty());
    }
    #[test]
    fn expired_students_are_purged_across_years_even_with_financial_history() {
        let c=db();
        c.execute_batch("INSERT INTO school_years(label,start_date,end_date,is_active) VALUES('other','2030-09-01','2031-06-30',0); INSERT INTO students(full_name) VALUES('S'),('legacy'); INSERT INTO groups(school_year_id,monthly_fee_cents,capacity) VALUES(1,100,10); INSERT INTO enrollments(student_id,group_id,start_date) VALUES(1,1,'2024-09-01'); INSERT INTO invoices(enrollment_id,amount_cents) VALUES(1,100); INSERT INTO invoices(amount_cents,type) VALUES(20000,'frais_inscription'); INSERT INTO enrollment_fees(student_id,school_year_id,invoice_id,amount) VALUES(1,1,2,20000); INSERT INTO payments(student_id,invoice_id,amount_cents) VALUES(1,2,100); INSERT INTO receipts(payment_id) VALUES(1);").unwrap();
        delete_to_trash(&c,"student",1).unwrap();
        c.execute_batch("UPDATE students SET deleted_at=datetime('now','-31 days') WHERE id IN (1,2); UPDATE school_years SET is_active=(id=2);").unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert_eq!(purge_expired(&c).unwrap(),1);
        for table in ["enrollments","invoices","payments","receipts","enrollment_fees"] { assert_eq!(count(&c,table),0,"{table}"); }
        assert_eq!(count(&c,"students"),1); // Legacy deletion with unknown owner stays untouched.
    }
    #[test]
    fn automatic_purge_still_preserves_financial_history() {
        let c=db(); c.execute_batch("INSERT INTO teachers(full_name) VALUES('T'); INSERT INTO teacher_settlements(teacher_id,amount_cents) VALUES(1,100);").unwrap();
        delete_to_trash(&c,"teacher",1).unwrap(); c.execute("UPDATE teacher_school_years SET deleted_at=datetime('now','-31 days')",[]).unwrap();
        assert_eq!(purge_expired(&c).unwrap(),0); assert_eq!(count(&c,"teacher_settlements"),1);
    }
}
