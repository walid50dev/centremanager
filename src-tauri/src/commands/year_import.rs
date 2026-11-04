//! Selective, idempotent year-to-year imports. No enrollment or financial row
//! is ever copied; students and teachers keep their original identity.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use super::db_err;
use crate::db::Db;

#[derive(Debug, Serialize)]
pub struct ImportableItem {
    pub id: i64,
    pub label: String,
    pub detail: String,
    pub already_imported: bool,
}

fn active_year(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT id FROM school_years WHERE is_active=1", [], |r| r.get(0))
        .optional().map_err(|e| db_err("Année active", e))?
        .ok_or_else(|| "Aucune année scolaire active".to_string())
}

fn ensure_active(conn: &Connection, target: i64) -> Result<(), String> {
    if active_year(conn)? != target { return Err("L'année cible doit être l'année active".into()); }
    Ok(())
}

pub fn importable(conn: &Connection, kind: &str, previous: i64) -> Result<Vec<ImportableItem>, String> {
    let target = active_year(conn)?;
    if previous == target { return Err("L'année source doit être différente de l'année active".into()); }
    let sql = match kind {
        "students" => "SELECT s.id, s.full_name, COALESCE(s.phone,'') || ' · ' || COALESCE(l.name,''),
            EXISTS(SELECT 1 FROM student_school_years x WHERE x.student_id=s.id AND x.school_year_id=?2)
            FROM students s JOIN student_school_years sy ON sy.student_id=s.id
            LEFT JOIN levels l ON l.id=s.level_id WHERE sy.school_year_id=?1 AND s.deleted_at IS NULL ORDER BY s.full_name COLLATE NOCASE",
        "teachers" => "SELECT t.id, t.full_name, COALESCE(t.phone,''),
            (EXISTS(SELECT 1 FROM teacher_school_years x WHERE x.teacher_id=t.id AND x.school_year_id=?2)
             OR EXISTS(SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?2 AND g.deleted_at IS NULL))
            FROM teachers t WHERE t.deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM teacher_school_years trashed WHERE trashed.teacher_id=t.id AND trashed.school_year_id=?1 AND trashed.deleted_at IS NOT NULL) AND
            (EXISTS(SELECT 1 FROM teacher_school_years x WHERE x.teacher_id=t.id AND x.school_year_id=?1)
             OR EXISTS(SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?1 AND g.deleted_at IS NULL))
            ORDER BY t.full_name COLLATE NOCASE",
        "groups" => "SELECT g.id, COALESCE(s.name,'') || ' — ' || COALESCE(l.name,''),
            COALESCE(t.full_name,'') || ' · ' || COALESCE(g.day_of_week,'') || ' ' || COALESCE(g.start_time,''),
            EXISTS(SELECT 1 FROM group_year_imports i WHERE i.source_group_id=g.id AND i.target_school_year_id=?2)
            FROM groups g LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id
            LEFT JOIN teachers t ON t.id=g.teacher_id WHERE g.school_year_id=?1 AND g.deleted_at IS NULL ORDER BY g.id",
        _ => return Err("Type d'import inconnu".into()),
    };
    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Préparation de l'import", e))?;
    let rows = stmt.query_map(params![previous, target], |r| Ok(ImportableItem {
        id: r.get(0)?, label: r.get(1)?, detail: r.get(2)?, already_imported: r.get(3)?,
    })).map_err(|e| db_err("Lecture de l'import", e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Lecture de l'import", e))
}

pub fn import_students(conn: &Connection, ids: &[i64], target: i64) -> Result<usize, String> {
    ensure_active(conn, target)?;
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Import élèves", e))?;
    let mut count = 0;
    for id in ids {
        let n = tx.execute("INSERT OR IGNORE INTO student_school_years (student_id,school_year_id)
          SELECT id,?2 FROM students WHERE id=?1 AND deleted_at IS NULL", params![id,target])
          .map_err(|e| db_err("Import élève", e))?;
        count += n;
    }
    tx.commit().map_err(|e| db_err("Import élèves", e))?;
    Ok(count)
}

pub fn import_teachers(conn: &Connection, ids: &[i64]) -> Result<usize, String> {
    let target = active_year(conn)?;
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Import enseignants", e))?;
    let mut count = 0;
    for id in ids {
        let n = tx.execute("INSERT OR IGNORE INTO teacher_school_years (teacher_id,school_year_id)
          SELECT id,?2 FROM teachers t WHERE id=?1 AND deleted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM groups g WHERE g.teacher_id=t.id AND g.school_year_id=?2 AND g.deleted_at IS NULL)", params![id,target])
          .map_err(|e| db_err("Import enseignant", e))?;
        if n > 0 {
            tx.execute("UPDATE teachers SET status='actif', updated_at=CURRENT_TIMESTAMP WHERE id=?1", params![id])
                .map_err(|e| db_err("Activation de l'enseignant", e))?;
        }
        count += n;
    }
    tx.commit().map_err(|e| db_err("Import enseignants", e))?;
    Ok(count)
}

pub fn import_groups(conn: &Connection, ids: &[i64], target: i64) -> Result<usize, String> {
    ensure_active(conn, target)?;
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Import groupes", e))?;
    let mut count = 0;
    for id in ids {
        let imported: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM group_year_imports WHERE source_group_id=?1 AND target_school_year_id=?2)", params![id,target], |r| r.get(0))
            .map_err(|e| db_err("Vérification de l'import", e))?;
        if imported { continue; }
        let inserted = tx.execute("INSERT INTO groups (subject_id,level_id,branch_id,teacher_id,school_year_id,day_of_week,start_time,end_time,room,monthly_fee_cents,capacity,status)
            SELECT subject_id,level_id,branch_id,teacher_id,?2,day_of_week,start_time,end_time,room,monthly_fee_cents,capacity,status
            FROM groups WHERE id=?1 AND deleted_at IS NULL AND school_year_id IS NOT NULL AND school_year_id<>?2", params![id,target])
            .map_err(|e| db_err("Import groupe", e))?;
        if inserted == 0 { return Err("Groupe source introuvable ou année invalide".into()); }
        let new_id = tx.last_insert_rowid();
        tx.execute("INSERT INTO group_schedules (group_id,day_of_week,start_time,end_time) SELECT ?2,day_of_week,start_time,end_time FROM group_schedules WHERE group_id=?1", params![id,new_id])
            .map_err(|e| db_err("Import horaires", e))?;
        tx.execute("INSERT INTO group_year_imports (source_group_id,target_school_year_id,imported_group_id) VALUES (?1,?2,?3)", params![id,target,new_id])
            .map_err(|e| db_err("Suivi de l'import", e))?;
        count += 1;
    }
    tx.commit().map_err(|e| db_err("Import groupes", e))?;
    Ok(count)
}

#[tauri::command]
pub fn cmd_get_importable_students(db: State<'_, Db>, prev_year_id: i64) -> Result<Vec<ImportableItem>, String> { importable(&db.conn(), "students", prev_year_id) }
#[tauri::command]
pub fn cmd_get_importable_groups(db: State<'_, Db>, prev_year_id: i64) -> Result<Vec<ImportableItem>, String> { importable(&db.conn(), "groups", prev_year_id) }
#[tauri::command]
pub fn cmd_get_importable_teachers(db: State<'_, Db>, prev_year_id: i64) -> Result<Vec<ImportableItem>, String> { importable(&db.conn(), "teachers", prev_year_id) }
#[tauri::command]
pub fn cmd_import_students(db: State<'_, Db>, student_ids: Vec<i64>, target_year_id: i64) -> Result<usize, String> { import_students(&db.conn(), &student_ids, target_year_id) }
#[tauri::command]
pub fn cmd_import_groups(db: State<'_, Db>, group_ids: Vec<i64>, target_year_id: i64) -> Result<usize, String> { import_groups(&db.conn(), &group_ids, target_year_id) }
#[tauri::command]
pub fn cmd_import_teachers(db: State<'_, Db>, teacher_ids: Vec<i64>) -> Result<usize, String> { import_teachers(&db.conn(), &teacher_ids) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::school_years;

    fn fixture() -> (Connection, i64, i64, i64, i64, i64) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let old = active_year(&conn).unwrap();
        let new = school_years::create(&conn, "2025-2026", "2025-09-01", "2026-06-30").unwrap();
        conn.execute("INSERT INTO students (full_name,phone) VALUES ('Test Student','0612345678')", []).unwrap();
        let student = conn.last_insert_rowid();
        conn.execute("INSERT INTO teachers (full_name) VALUES ('Test Teacher')", []).unwrap();
        let teacher = conn.last_insert_rowid();
        conn.execute("INSERT INTO groups (teacher_id,school_year_id,monthly_fee_cents,capacity) VALUES (?1,?2,10000,20)", params![teacher,old]).unwrap();
        let group = conn.last_insert_rowid();
        conn.execute("INSERT INTO group_schedules (group_id,day_of_week,start_time,end_time) VALUES (?1,'lundi','09:00','10:00')", params![group]).unwrap();
        conn.execute("INSERT INTO group_schedules (group_id,day_of_week,start_time,end_time) VALUES (?1,'mardi','09:00','10:00')", params![group]).unwrap();
        conn.execute("INSERT INTO enrollments (student_id,group_id,start_date) VALUES (?1,?2,'2024-09-01')", params![student,group]).unwrap();
        school_years::set_active(&conn, new).unwrap();
        (conn, old, new, student, teacher, group)
    }

    #[test]
    fn student_import_is_idempotent_and_never_copies_enrollments() {
        let (conn, old, new, student, _, _) = fixture();
        assert!(!importable(&conn, "students", old).unwrap()[0].already_imported);
        assert_eq!(import_students(&conn, &[student, student], new).unwrap(), 1);
        assert_eq!(import_students(&conn, &[student], new).unwrap(), 0);
        assert!(importable(&conn, "students", old).unwrap()[0].already_imported);
        let count: i64 = conn.query_row("SELECT count(*) FROM enrollments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn group_import_copies_schedules_but_not_enrollments_and_is_idempotent() {
        let (conn, old, new, _, _, group) = fixture();
        assert_eq!(import_groups(&conn, &[group, group], new).unwrap(), 1);
        assert_eq!(import_groups(&conn, &[group], new).unwrap(), 0);
        let imported: i64 = conn.query_row("SELECT imported_group_id FROM group_year_imports WHERE source_group_id=?1", params![group], |r| r.get(0)).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM group_schedules WHERE group_id=?1", params![imported], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(conn.query_row("SELECT count(*) FROM enrollments WHERE group_id=?1", params![imported], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(importable(&conn, "groups", old).unwrap()[0].already_imported);
    }

    #[test]
    fn imported_teacher_is_visible_without_a_group_and_group_implies_visibility() {
        let (conn, old, new, _, teacher, group) = fixture();
        assert_eq!(import_teachers(&conn, &[teacher, teacher]).unwrap(), 1);
        assert_eq!(import_teachers(&conn, &[teacher]).unwrap(), 0);
        assert!(importable(&conn, "teachers", old).unwrap()[0].already_imported);
        conn.execute("DELETE FROM teacher_school_years WHERE teacher_id=?1 AND school_year_id=?2", params![teacher,new]).unwrap();
        import_groups(&conn, &[group], new).unwrap();
        assert!(importable(&conn, "teachers", old).unwrap()[0].already_imported);
        assert_eq!(import_teachers(&conn, &[teacher]).unwrap(), 0);
    }

    #[test]
    fn import_is_atomic_and_rejects_non_active_target() {
        let (conn, old, new, student, _, group) = fixture();
        assert!(import_students(&conn, &[student], old).is_err());
        assert!(import_groups(&conn, &[group, -1], new).is_err());
        let count: i64 = conn.query_row("SELECT count(*) FROM group_year_imports", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
