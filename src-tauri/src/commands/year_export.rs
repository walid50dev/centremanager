//! Read-only academic-year exports. Payments are attributed through their
//! invoice's group; salary settlements are attributed by their payroll month.
use std::collections::HashMap;
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use super::db_err;
use crate::db::Db;

#[derive(Debug, Serialize)]
pub struct SubjectSummary { pub name: String, pub students: i64, pub revenue_cents: i64 }
#[derive(Debug, Serialize)]
pub struct YearSummary {
    pub label: String, pub students: i64, pub groups: i64, pub teachers: i64,
    pub revenue_cents: i64, pub salaries_cents: i64, pub expenses_cents: i64, pub net_cents: i64,
    pub subjects: Vec<SubjectSummary>,
}
fn scalar(conn: &Connection, sql: &str, year_id: i64) -> Result<i64, String> {
    conn.query_row(sql, params![year_id], |r| r.get(0)).map_err(|e| db_err("Export annuel", e))
}
fn ensure_attributed(conn: &Connection) -> Result<(), String> {
    let missing: i64 = conn.query_row("SELECT count(*) FROM payments WHERE school_year_id IS NULL", [], |r| r.get(0))
        .map_err(|e| db_err("Vérification des paiements", e))?;
    if missing > 0 { return Err(format!("Export impossible : {missing} paiement(s) historique(s) sans année scolaire identifiable")); }
    Ok(())
}
pub fn summary(conn: &Connection, year_id: i64) -> Result<YearSummary, String> {
    ensure_attributed(conn)?;
    let label: String = conn.query_row("SELECT COALESCE(label,'') FROM school_years WHERE id=?1", params![year_id], |r| r.get(0))
        .optional().map_err(|e| db_err("Année scolaire", e))?.ok_or_else(|| "Année scolaire introuvable".to_string())?;
    let students = scalar(conn, "SELECT count(*) FROM student_school_years sy JOIN students s ON s.id=sy.student_id WHERE sy.school_year_id=?1 AND s.deleted_at IS NULL", year_id)?;
    let groups = scalar(conn, "SELECT count(*) FROM groups WHERE school_year_id=?1 AND deleted_at IS NULL", year_id)?;
    let teachers = scalar(conn, "SELECT count(*) FROM teachers t WHERE t.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM teacher_school_years trashed WHERE trashed.teacher_id=t.id AND trashed.school_year_id=?1 AND trashed.deleted_at IS NOT NULL) AND (EXISTS (SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=t.id AND ty.school_year_id=?1) OR EXISTS (SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?1 AND g.deleted_at IS NULL))", year_id)?;
    let revenue_cents = scalar(conn, "SELECT COALESCE(sum(p.amount_cents),0) FROM payments p WHERE p.school_year_id=?1", year_id)?;
    let expenses_cents = scalar(conn, "SELECT COALESCE(sum(amount_cents),0) FROM monthly_expenses WHERE school_year_id=?1 AND deleted_at IS NULL", year_id)?;
    let salaries_cents = scalar(conn, "SELECT COALESCE(sum(ts.amount_cents),0) FROM teacher_settlements ts JOIN school_years y ON y.id=?1 WHERE printf('%04d-%02d',ts.year,ts.month) BETWEEN substr(y.start_date,1,7) AND substr(y.end_date,1,7)", year_id)?;
    let mut stmt = conn.prepare("SELECT COALESCE(s.name,'—'), COUNT(DISTINCT e.student_id), COALESCE((SELECT sum(p.amount_cents) FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN enrollments ep ON ep.id=i.enrollment_id JOIN groups gp ON gp.id=ep.group_id WHERE gp.school_year_id=?1 AND gp.subject_id IS s.id),0) FROM groups g LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN enrollments e ON e.group_id=g.id WHERE g.school_year_id=?1 GROUP BY s.id,s.name ORDER BY s.name")
        .map_err(|e| db_err("Matières", e))?;
    let subjects = stmt.query_map(params![year_id], |r| Ok(SubjectSummary { name:r.get(0)?, students:r.get(1)?, revenue_cents:r.get(2)? }))
        .map_err(|e| db_err("Matières", e))?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Matières", e))?;
    Ok(YearSummary { label, students, groups, teachers, revenue_cents, salaries_cents, expenses_cents,
        net_cents: revenue_cents - salaries_cents - expenses_cents, subjects })
}
pub fn data(conn: &Connection, year_id: i64, section: &str) -> Result<Vec<HashMap<String, String>>, String> {
    if section == "payments" { ensure_attributed(conn)?; }
    if !conn.query_row("SELECT EXISTS(SELECT 1 FROM school_years WHERE id=?1)", params![year_id], |r| r.get::<_, bool>(0)).map_err(|e| db_err("Année scolaire", e))? { return Err("Année scolaire introuvable".into()); }
    let sql = match section {
        "students" => "SELECT s.id, s.first_name, s.last_name, s.full_name, s.phone, l.name AS level, b.name AS branch, s.guardian_name, s.school_name, s.status FROM student_school_years sy JOIN students s ON s.id=sy.student_id LEFT JOIN levels l ON l.id=s.level_id LEFT JOIN branches b ON b.id=s.branch_id WHERE sy.school_year_id=?1 AND s.deleted_at IS NULL ORDER BY s.full_name",
        "groups" => "SELECT g.id, s.name AS subject, l.name AS level, b.name AS branch, t.full_name AS teacher, g.day_of_week, g.start_time, g.end_time, (SELECT GROUP_CONCAT(gs.day_of_week || ' ' || gs.start_time || '-' || gs.end_time, ', ') FROM group_schedules gs WHERE gs.group_id=g.id) AS schedules, g.room, g.monthly_fee_cents, g.capacity, g.status FROM groups g LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id LEFT JOIN branches b ON b.id=g.branch_id LEFT JOIN teachers t ON t.id=g.teacher_id WHERE g.school_year_id=?1 AND g.deleted_at IS NULL ORDER BY g.id",
        "teachers" => "SELECT t.id,t.full_name,t.phone,t.email,t.status FROM teachers t WHERE t.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM teacher_school_years trashed WHERE trashed.teacher_id=t.id AND trashed.school_year_id=?1 AND trashed.deleted_at IS NOT NULL) AND (EXISTS (SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=t.id AND ty.school_year_id=?1) OR EXISTS (SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?1 AND g.deleted_at IS NULL)) ORDER BY t.full_name",
        "payments" => "SELECT p.id, s.full_name AS student, p.invoice_id, p.amount_cents, p.payment_method, p.notes, p.created_at FROM payments p LEFT JOIN students s ON s.id=p.student_id WHERE p.school_year_id=?1 ORDER BY p.id",
        "expenses" => "SELECT id,label,amount_cents,category,month,year,notes,created_at FROM monthly_expenses WHERE school_year_id=?1 AND deleted_at IS NULL ORDER BY year,month,id",
        "salaries" => "SELECT ts.id,t.full_name AS teacher,ts.month,ts.year,ts.amount_cents,ts.payment_method,ts.notes,ts.created_at FROM teacher_settlements ts LEFT JOIN teachers t ON t.id=ts.teacher_id JOIN school_years y ON y.id=?1 WHERE printf('%04d-%02d',ts.year,ts.month) BETWEEN substr(y.start_date,1,7) AND substr(y.end_date,1,7) ORDER BY ts.year,ts.month,ts.id",
        _ => return Err("Section d'export invalide".into()),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Export annuel", e))?;
    let names: Vec<String> = stmt.column_names().iter().map(|name| name.to_string()).collect();
    let rows = stmt.query_map(params![year_id], |row| {
        let mut result = HashMap::new();
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => String::new(), ValueRef::Integer(v) => v.to_string(), ValueRef::Real(v) => v.to_string(),
                ValueRef::Text(v) => String::from_utf8_lossy(v).to_string(), ValueRef::Blob(_) => String::new(),
            };
            result.insert(name.clone(), value);
        }
        Ok(result)
    }).map_err(|e| db_err("Export annuel", e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Export annuel", e))
}
#[tauri::command]
pub fn cmd_export_year_summary(db: State<'_, Db>, year_id: i64) -> Result<YearSummary, String> { summary(&db.conn(), year_id) }
#[tauri::command]
pub fn cmd_export_year_data(db: State<'_, Db>, year_id: i64, section: String) -> Result<Vec<HashMap<String, String>>, String> { data(&db.conn(), year_id, &section) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::school_years;
    fn fixture() -> (Connection, i64) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let year = school_years::list(&conn).unwrap()[0].id;
        conn.execute("INSERT INTO students (full_name,first_name,last_name,phone) VALUES ('Samir Test','Samir','Test','0612345678')", []).unwrap();
        let student = conn.last_insert_rowid();
        conn.execute("INSERT INTO teachers (full_name) VALUES ('Prof')", []).unwrap();
        let teacher = conn.last_insert_rowid();
        conn.execute("INSERT INTO groups (subject_id,teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES (1,?1,?2,10000,10)", params![teacher,year]).unwrap();
        let group = conn.last_insert_rowid();
        conn.execute("INSERT INTO enrollments (student_id,group_id,start_date) VALUES (?1,?2,'2024-09-01')", params![student,group]).unwrap();
        let enrollment = conn.last_insert_rowid();
        conn.execute("INSERT INTO invoices (enrollment_id,amount_cents) VALUES (?1,10000)", params![enrollment]).unwrap();
        let invoice = conn.last_insert_rowid();
        conn.execute("INSERT INTO payments (student_id,invoice_id,amount_cents) VALUES (?1,?2,8000)", params![student,invoice]).unwrap();
        conn.execute("INSERT INTO monthly_expenses (label,amount_cents,category,month,year) VALUES ('Rent',2000,'rent',9,2024)", []).unwrap();
        conn.execute("INSERT INTO teacher_settlements (teacher_id,amount_cents,month,year) VALUES (?1,1000,9,2024)", params![teacher]).unwrap();
        (conn, year)
    }
    #[test]
    fn summary_includes_payments_expenses_salaries_and_subjects() {
        let (conn, year) = fixture();
        let report = summary(&conn, year).unwrap();
        assert_eq!((report.students,report.groups,report.teachers), (1,1,1));
        assert_eq!((report.revenue_cents,report.expenses_cents,report.salaries_cents,report.net_cents), (8000,2000,1000,5000));
        assert_eq!(report.subjects[0].students,1);
        assert_eq!(report.subjects[0].revenue_cents,8000);
    }
    #[test]
    fn students_export_contains_expected_columns() {
        let (conn, year) = fixture();
        let rows = data(&conn, year, "students").unwrap();
        assert_eq!(rows.len(),1);
        assert_eq!(rows[0].get("full_name").unwrap(), "Samir Test");
        assert_eq!(rows[0].get("phone").unwrap(), "0612345678");
        assert!(data(&conn, year, "unexpected").is_err());
    }
}
