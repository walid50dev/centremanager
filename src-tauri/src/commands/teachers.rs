//! Teacher management (Phase 6).
//!
//! A teacher is a person with a name, optional contact details and any number
//! of subjects. They are **never deleted** in V1: they are deactivated
//! (`status = 'inactif'`) so that the groups, activities and settlements that
//! point at them keep a real person behind the id.
//!
//! Payroll configuration lives on the `teachers` row
//! (`compensation_mode` / `compensation_value_cents` / `bonus_pct`); the
//! calculation itself is in `commands::compensation`.
//!
//! Like the other modules the core functions take `&Connection` so the tests
//! can run against an in-memory database; the `#[tauri::command]` wrappers only
//! unwrap the shared state.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::{CompensationConfig, TeacherDetail, TeacherGroup, TeacherRow};

pub const STATUS_ACTIVE: &str = "actif";
pub const STATUS_INACTIVE: &str = "inactif";

const ENTITY_TYPE: &str = "teacher";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// Payload for `cmd_create_teacher`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTeacherInput {
    pub full_name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub subject_ids: Vec<i64>,
}

/// Payload for `cmd_update_teacher` (same fields as the create payload).
pub type UpdateTeacherInput = CreateTeacherInput;

/// Clean, validated values ready for SQL.
#[derive(Debug, Clone)]
struct CleanInput {
    full_name: String,
    phone: Option<String>,
    email: Option<String>,
    notes: Option<String>,
    subject_ids: Vec<i64>,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Moroccan phone number: `06XXXXXXXX`, `07XXXXXXXX`, `05XXXXXXXX` (landline)
/// or the international `+2125…` / `+2126…` / `+2127…` form. Spaces, dots and
/// dashes are ignored; the stored form is the one typed, trimmed.
pub fn is_valid_phone(phone: &str) -> bool {
    let digits: String = phone
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();
    if let Some(rest) = digits.strip_prefix("+212") {
        return rest.len() == 9 && rest.starts_with(['5', '6', '7']);
    }
    digits.len() == 10
        && digits.starts_with('0')
        && digits[1..2]
            .parse::<u8>()
            .is_ok_and(|d| (5..=7).contains(&d))
}

fn optional_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn validate_email(value: &Option<String>) -> Result<Option<String>, String> {
    match optional_text(value) {
        None => Ok(None),
        Some(email) => {
            let has_at = email.split('@').count() == 2;
            let domain = email.rsplit('@').next().unwrap_or_default();
            if has_at && domain.contains('.') && !email.contains(' ') {
                Ok(Some(email))
            } else {
                Err("Format d'email invalide".to_string())
            }
        }
    }
}

fn validate_phone(value: &Option<String>) -> Result<Option<String>, String> {
    match optional_text(value) {
        None => Ok(None),
        Some(phone) => {
            if is_valid_phone(&phone) {
                Ok(Some(phone))
            } else {
                Err("Format de téléphone invalide (06XXXXXXXX, 07XXXXXXXX ou +212…)".to_string())
            }
        }
    }
}

fn clean_input(conn: &Connection, data: &CreateTeacherInput) -> Result<CleanInput, String> {
    let full_name = data.full_name.trim().to_string();
    if full_name.is_empty() {
        return Err("Le nom complet est obligatoire".to_string());
    }
    if full_name.chars().count() < 2 {
        return Err("Le nom complet est trop court".to_string());
    }

    // Subjects are de-duplicated and must exist.
    let mut subject_ids: Vec<i64> = Vec::new();
    for id in &data.subject_ids {
        if !subject_ids.contains(id) {
            let exists: Option<i64> = conn
                .query_row(
                    "SELECT id FROM subjects WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|err| db_err("Lecture des matières", err))?;
            if exists.is_none() {
                return Err(format!("Matière introuvable (#{id})"));
            }
            subject_ids.push(*id);
        }
    }

    Ok(CleanInput {
        full_name,
        phone: validate_phone(&data.phone)?,
        email: validate_email(&data.email)?,
        notes: optional_text(&data.notes),
        subject_ids,
    })
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/// The shared SELECT of a `TeacherRow` (subjects as `GROUP_CONCAT`, live group
/// count). `?1` is unused so `list` and `by_id` can share the same text.
const SELECT_TEACHER: &str = "
    SELECT t.id,
           t.full_name,
           t.phone,
           t.email,
           t.notes,
           COALESCE(t.status, 'actif'),
           COALESCE((
               SELECT GROUP_CONCAT(name, ', ') FROM (
                   SELECT s.name AS name
                   FROM teacher_subjects ts
                   JOIN subjects s ON s.id = ts.subject_id
                   WHERE ts.teacher_id = t.id
                   ORDER BY s.name COLLATE NOCASE
               )
           ), ''),
           (SELECT COUNT(*) FROM groups g
             WHERE g.teacher_id = t.id AND g.status = 'actif'),
           t.compensation_mode,
           t.compensation_value_cents,
           t.bonus_pct,
           COALESCE(t.created_at, ''),
           COALESCE(t.updated_at, '')
      FROM teachers t";

fn map_teacher(row: &Row<'_>) -> rusqlite::Result<TeacherRow> {
    Ok(TeacherRow {
        id: row.get(0)?,
        full_name: row.get(1)?,
        phone: row.get(2)?,
        email: row.get(3)?,
        notes: row.get(4)?,
        status: row.get(5)?,
        subjects: row.get(6)?,
        group_count: row.get(7)?,
        compensation_mode: row.get(8)?,
        compensation_value_cents: row.get(9)?,
        bonus_pct: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

fn audit(
    conn: &Connection,
    action: &str,
    entity_id: i64,
    details: Option<String>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES (?1, ?2, ?3, ?4)",
        params![action, ENTITY_TYPE, entity_id, details],
    )
    .map(|_| ())
    .map_err(|err| db_err("Journalisation de l'audit", err))
}

fn scalar_snapshot(clean: &CleanInput) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("full_name".into(), json!(clean.full_name));
    map.insert("phone".into(), json!(clean.phone));
    map.insert("email".into(), json!(clean.email));
    map.insert("notes".into(), json!(clean.notes));
    map
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// List teachers, optionally filtered by status, sorted by name.
pub fn list_teachers(conn: &Connection, status: Option<&str>) -> Result<Vec<TeacherRow>, String> {
    let filter = status.map(str::trim).filter(|value| !value.is_empty());
    if let Some(value) = filter {
        if value != STATUS_ACTIVE && value != STATUS_INACTIVE {
            return Err("Statut invalide (actif ou inactif)".to_string());
        }
    }

    let sql = format!(
        "{SELECT_TEACHER}
         WHERE (?1 IS NULL OR COALESCE(t.status, 'actif') = ?1)
         ORDER BY t.full_name COLLATE NOCASE ASC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation de la liste des enseignants", err))?;
    let rows = stmt
        .query_map(params![filter], map_teacher)
        .map_err(|err| db_err("Lecture des enseignants", err))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des enseignants", err))
}

fn teacher_by_id(conn: &Connection, id: i64) -> Result<TeacherRow, String> {
    conn.query_row(
        &format!("{SELECT_TEACHER} WHERE t.id = ?1"),
        params![id],
        map_teacher,
    )
    .optional()
    .map_err(|err| db_err("Lecture de l'enseignant", err))?
    .ok_or_else(|| "Enseignant introuvable".to_string())
}

fn subject_ids(conn: &Connection, teacher_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT subject_id FROM teacher_subjects
             WHERE teacher_id = ?1 ORDER BY subject_id",
        )
        .map_err(|err| db_err("Lecture des matières de l'enseignant", err))?;
    let rows = stmt
        .query_map(params![teacher_id], |row| row.get(0))
        .map_err(|err| db_err("Lecture des matières de l'enseignant", err))?;
    rows.collect::<rusqlite::Result<Vec<i64>>>()
        .map_err(|err| db_err("Lecture des matières de l'enseignant", err))
}

/// Active groups taught by the teacher, with the live enrollment count.
pub fn teacher_groups(conn: &Connection, teacher_id: i64) -> Result<Vec<TeacherGroup>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id,
                    COALESCE(s.name, '—'),
                    COALESCE(l.name, '—'),
                    b.name,
                    COALESCE(g.day_of_week, ''),
                    COALESCE(g.start_time, ''),
                    COALESCE(g.end_time, ''),
                    g.monthly_fee_cents,
                    (SELECT COUNT(*) FROM enrollments e
                      WHERE e.group_id = g.id AND e.status = 'actif')
               FROM groups g
               LEFT JOIN subjects s ON s.id = g.subject_id
               LEFT JOIN levels l ON l.id = g.level_id
               LEFT JOIN branches b ON b.id = g.branch_id
              WHERE g.teacher_id = ?1 AND g.status = 'actif'
              ORDER BY s.name COLLATE NOCASE, l.sort_order, g.id",
        )
        .map_err(|err| db_err("Préparation des groupes de l'enseignant", err))?;
    let rows = stmt
        .query_map(params![teacher_id], |row| {
            Ok(TeacherGroup {
                group_id: row.get(0)?,
                subject_name: row.get(1)?,
                level_name: row.get(2)?,
                branch_name: row.get(3)?,
                day_of_week: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                monthly_fee_cents: row.get(7)?,
                enrolled_count: row.get(8)?,
            })
        })
        .map_err(|err| db_err("Lecture des groupes de l'enseignant", err))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des groupes de l'enseignant", err))
}

/// Payroll configuration of a teacher (`None` when mode/value are unset).
pub fn compensation_config(
    conn: &Connection,
    teacher_id: i64,
) -> Result<Option<CompensationConfig>, String> {
    let row: Option<(Option<String>, Option<i64>, Option<f64>)> = conn
        .query_row(
            "SELECT compensation_mode, compensation_value_cents, bonus_pct
               FROM teachers WHERE id = ?1",
            params![teacher_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|err| db_err("Lecture de la compensation", err))?;

    let Some((mode, value, bonus)) = row else {
        return Err("Enseignant introuvable".to_string());
    };

    match (mode, value) {
        (Some(mode), Some(value)) if !mode.trim().is_empty() => Ok(Some(CompensationConfig {
            mode,
            value_cents: value,
            bonus_pct: bonus,
        })),
        _ => Ok(None),
    }
}

pub fn teacher_detail(conn: &Connection, id: i64) -> Result<TeacherDetail, String> {
    let teacher = teacher_by_id(conn, id)?;
    Ok(TeacherDetail {
        subject_ids: subject_ids(conn, id)?,
        groups: teacher_groups(conn, id)?,
        compensation_config: compensation_config(conn, id)?,
        teacher,
    })
}

pub fn create_teacher(conn: &Connection, data: &CreateTeacherInput) -> Result<i64, String> {
    let clean = clean_input(conn, data)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    tx.execute(
        "INSERT INTO teachers (full_name, phone, email, notes, status)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            clean.full_name,
            clean.phone,
            clean.email,
            clean.notes,
            STATUS_ACTIVE
        ],
    )
    .map_err(|err| db_err("Création de l'enseignant", err))?;

    let id = tx.last_insert_rowid();

    for subject_id in &clean.subject_ids {
        tx.execute(
            "INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id)
             VALUES (?1, ?2)",
            params![id, subject_id],
        )
        .map_err(|err| db_err("Ajout des matières", err))?;
    }

    let mut details = scalar_snapshot(&clean);
    details.insert("subject_ids".into(), json!(clean.subject_ids));
    audit(&tx, "CREATE", id, Some(Value::Object(details).to_string()))?;

    tx.commit()
        .map_err(|err| db_err("Validation de la transaction", err))?;
    Ok(id)
}

pub fn update_teacher(conn: &Connection, id: i64, data: &UpdateTeacherInput) -> Result<(), String> {
    let existing = teacher_by_id(conn, id)?;
    let clean = clean_input(conn, data)?;

    let old_subjects = subject_ids(conn, id)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    tx.execute(
        "UPDATE teachers
            SET full_name = ?2,
                phone = ?3,
                email = ?4,
                notes = ?5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1",
        params![id, clean.full_name, clean.phone, clean.email, clean.notes],
    )
    .map_err(|err| db_err("Mise à jour de l'enseignant", err))?;

    tx.execute(
        "DELETE FROM teacher_subjects WHERE teacher_id = ?1",
        params![id],
    )
    .map_err(|err| db_err("Remplacement des matières", err))?;
    for subject_id in &clean.subject_ids {
        tx.execute(
            "INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id)
             VALUES (?1, ?2)",
            params![id, subject_id],
        )
        .map_err(|err| db_err("Ajout des matières", err))?;
    }

    // Only what actually changed goes into the audit diff.
    let mut changes = Map::new();
    let mut diff = |field: &str, from: Value, to: Value| {
        if from != to {
            changes.insert(field.to_string(), json!({ "from": from, "to": to }));
        }
    };
    diff(
        "full_name",
        json!(existing.full_name),
        json!(clean.full_name),
    );
    diff("phone", json!(existing.phone), json!(clean.phone));
    diff("email", json!(existing.email), json!(clean.email));
    diff("notes", json!(existing.notes), json!(clean.notes));
    if old_subjects != clean.subject_ids {
        changes.insert(
            "subject_ids".into(),
            json!({ "from": old_subjects, "to": clean.subject_ids }),
        );
    }

    if changes.is_empty() {
        tx.commit()
            .map_err(|err| db_err("Validation de la transaction", err))?;
        return Ok(());
    }

    audit(&tx, "UPDATE", id, Some(Value::Object(changes).to_string()))?;

    tx.commit()
        .map_err(|err| db_err("Validation de la transaction", err))?;
    Ok(())
}

pub fn set_teacher_status(conn: &Connection, id: i64, status: &str) -> Result<(), String> {
    let next = status.trim();
    if next != STATUS_ACTIVE && next != STATUS_INACTIVE {
        return Err("Statut invalide (actif ou inactif)".to_string());
    }

    let existing = teacher_by_id(conn, id)?;
    if existing.status == next {
        return Ok(());
    }

    conn.execute(
        "UPDATE teachers SET status = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id, next],
    )
    .map_err(|err| db_err("Changement de statut", err))?;

    audit(
        conn,
        "STATUS_CHANGE",
        id,
        Some(json!({ "from": existing.status, "to": next }).to_string()),
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_create_teacher(db: State<'_, Db>, data: CreateTeacherInput) -> Result<i64, String> {
    let conn = db.conn();
    create_teacher(&conn, &data)
}

#[tauri::command]
pub fn cmd_update_teacher(
    db: State<'_, Db>,
    id: i64,
    data: UpdateTeacherInput,
) -> Result<(), String> {
    let conn = db.conn();
    update_teacher(&conn, id, &data)
}

#[tauri::command]
pub fn cmd_get_teachers(
    db: State<'_, Db>,
    status: Option<String>,
) -> Result<Vec<TeacherRow>, String> {
    let conn = db.conn();
    list_teachers(&conn, status.as_deref())
}

#[tauri::command]
pub fn cmd_get_teacher_detail(db: State<'_, Db>, id: i64) -> Result<TeacherDetail, String> {
    let conn = db.conn();
    teacher_detail(&conn, id)
}

#[tauri::command]
pub fn cmd_set_teacher_status(db: State<'_, Db>, id: i64, status: String) -> Result<(), String> {
    let conn = db.conn();
    set_teacher_status(&conn, id, &status)
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

    fn input(name: &str, phone: Option<&str>, subjects: &[i64]) -> CreateTeacherInput {
        CreateTeacherInput {
            full_name: name.to_string(),
            phone: phone.map(str::to_string),
            email: None,
            notes: None,
            subject_ids: subjects.to_vec(),
        }
    }

    #[test]
    fn create_teacher_stores_subjects_and_audits() {
        let conn = test_conn();
        let id = create_teacher(
            &conn,
            &input("  Karim Idrissi ", Some("0612345678"), &[1, 2]),
        )
        .unwrap();

        let row = teacher_by_id(&conn, id).unwrap();
        assert_eq!(row.full_name, "Karim Idrissi");
        assert_eq!(row.phone.as_deref(), Some("0612345678"));
        assert_eq!(row.status, "actif");
        assert_eq!(row.subjects, "Mathématiques, Physique-Chimie");
        assert_eq!(row.group_count, 0);
        assert_eq!(row.compensation_mode, None);

        assert_eq!(subject_ids(&conn, id).unwrap(), vec![1, 2]);

        let (action, entity, details): (String, String, String) = conn
            .query_row(
                "SELECT action, entity_type, details FROM audit_log WHERE entity_type = 'teacher'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(action, "CREATE");
        assert_eq!(entity, "teacher");
        assert!(details.contains("\"subject_ids\":[1,2]"));
    }

    #[test]
    fn create_teacher_validates_name_phone_and_email() {
        let conn = test_conn();

        assert_eq!(
            create_teacher(&conn, &input("   ", None, &[])).unwrap_err(),
            "Le nom complet est obligatoire"
        );
        assert!(create_teacher(&conn, &input("A", None, &[])).is_err());
        assert!(create_teacher(&conn, &input("Karim", Some("12345"), &[]))
            .unwrap_err()
            .contains("téléphone"));

        let mut with_email = input("Karim", None, &[]);
        with_email.email = Some("pas-un-email".to_string());
        assert_eq!(
            create_teacher(&conn, &with_email).unwrap_err(),
            "Format d'email invalide"
        );

        // The international form is accepted too.
        assert!(create_teacher(&conn, &input("Salma", Some("+212612345678"), &[])).is_ok());
    }

    #[test]
    fn create_teacher_rejects_unknown_subject_and_dedupes() {
        let conn = test_conn();

        let mut unknown = input("Karim", None, &[999]);
        assert!(create_teacher(&conn, &unknown)
            .unwrap_err()
            .contains("Matière introuvable"));

        unknown.subject_ids = vec![1, 1, 2];
        let id = create_teacher(&conn, &unknown).unwrap();
        assert_eq!(subject_ids(&conn, id).unwrap(), vec![1, 2]);
    }

    #[test]
    fn update_teacher_replaces_subjects_and_audits_a_diff() {
        let conn = test_conn();
        let id = create_teacher(&conn, &input("Karim", Some("0612345678"), &[1])).unwrap();

        let mut update = input("Karim Idrissi", Some("0612345678"), &[2, 3]);
        update.notes = Some("Vacataire".to_string());
        update_teacher(&conn, id, &update).unwrap();

        let row = teacher_by_id(&conn, id).unwrap();
        assert_eq!(row.full_name, "Karim Idrissi");
        assert_eq!(row.subjects, "Physique-Chimie, SVT");
        assert_eq!(subject_ids(&conn, id).unwrap(), vec![2, 3]);

        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE entity_type = 'teacher' AND action = 'UPDATE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("\"full_name\":{\"from\":\"Karim\",\"to\":\"Karim Idrissi\"}"));
        assert!(details.contains("\"subject_ids\":{\"from\":[1],\"to\":[2,3]}"));
        assert!(details.contains("\"notes\":{\"from\":null,\"to\":\"Vacataire\"}"));
        assert!(
            !details.contains("\"phone\""),
            "unchanged fields stay out of the diff"
        );
    }

    #[test]
    fn update_teacher_without_changes_writes_no_audit_row() {
        let conn = test_conn();
        let id = create_teacher(&conn, &input("Karim", None, &[1])).unwrap();
        update_teacher(&conn, id, &input("Karim", None, &[1])).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'UPDATE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn list_teachers_filters_by_status_and_sorts_by_name() {
        let conn = test_conn();
        let a = create_teacher(&conn, &input("Zineb Alami", None, &[1])).unwrap();
        create_teacher(&conn, &input("Ahmed Berrada", None, &[2])).unwrap();
        set_teacher_status(&conn, a, "inactif").unwrap();

        let all = list_teachers(&conn, None).unwrap();
        assert_eq!(
            all.iter().map(|t| t.full_name.as_str()).collect::<Vec<_>>(),
            vec!["Ahmed Berrada", "Zineb Alami"]
        );

        let active = list_teachers(&conn, Some("actif")).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].full_name, "Ahmed Berrada");

        let inactive = list_teachers(&conn, Some("inactif")).unwrap();
        assert_eq!(inactive.len(), 1);
        assert_eq!(inactive[0].full_name, "Zineb Alami");

        assert!(list_teachers(&conn, Some("archive")).is_err());
    }

    #[test]
    fn set_status_audits_and_ignores_a_no_op() {
        let conn = test_conn();
        let id = create_teacher(&conn, &input("Karim", None, &[])).unwrap();

        set_teacher_status(&conn, id, "inactif").unwrap();
        assert_eq!(teacher_by_id(&conn, id).unwrap().status, "inactif");

        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE action = 'STATUS_CHANGE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(details, "{\"from\":\"actif\",\"to\":\"inactif\"}");

        // Setting the same status twice is a no-op (no second audit row).
        set_teacher_status(&conn, id, "inactif").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'STATUS_CHANGE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        assert!(set_teacher_status(&conn, id, "retraité").is_err());
        assert_eq!(
            set_teacher_status(&conn, 999, "actif").unwrap_err(),
            "Enseignant introuvable"
        );
    }

    #[test]
    fn teacher_detail_joins_groups_with_the_live_enrollment_count() {
        let conn = test_conn();
        let id = create_teacher(&conn, &input("Karim", None, &[1])).unwrap();

        conn.execute(
            "INSERT INTO groups (subject_id, level_id, teacher_id, school_year_id,
                                 day_of_week, start_time, end_time, monthly_fee_cents, capacity, status)
             VALUES (1, 10, ?1, 1, 'Lundi', '16:00', '18:00', 40000, 10, 'actif')",
            params![id],
        )
        .unwrap();
        let group_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO students (full_name, phone) VALUES ('Yassine', '0612345678')",
            [],
        )
        .unwrap();
        let student_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO enrollments (student_id, group_id, start_date, status)
             VALUES (?1, ?2, '2026-03-01', 'actif')",
            params![student_id, group_id],
        )
        .unwrap();

        let detail = teacher_detail(&conn, id).unwrap();
        assert_eq!(detail.teacher.id, id);
        assert_eq!(detail.subject_ids, vec![1]);
        assert_eq!(detail.groups.len(), 1);
        let group = &detail.groups[0];
        assert_eq!(group.subject_name, "Mathématiques");
        assert_eq!(group.level_name, "Tronc Commun");
        assert_eq!(group.monthly_fee_cents, 40_000);
        assert_eq!(group.enrolled_count, 1);
        assert!(detail.compensation_config.is_none());

        // The list carries the same group count.
        assert_eq!(list_teachers(&conn, None).unwrap()[0].group_count, 1);
    }

    #[test]
    fn inactive_groups_are_not_counted() {
        let conn = test_conn();
        let id = create_teacher(&conn, &input("Karim", None, &[])).unwrap();
        conn.execute(
            "INSERT INTO groups (subject_id, level_id, teacher_id, school_year_id,
                                 day_of_week, start_time, end_time, monthly_fee_cents, capacity, status)
             VALUES (1, 10, ?1, 1, 'Lundi', '16:00', '18:00', 40000, 10, 'archive')",
            params![id],
        )
        .unwrap();

        assert_eq!(teacher_by_id(&conn, id).unwrap().group_count, 0);
        assert!(teacher_detail(&conn, id).unwrap().groups.is_empty());
    }
}
