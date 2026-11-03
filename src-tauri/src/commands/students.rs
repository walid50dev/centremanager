//! Student management (Phase 3).
//!
//! Students are **never deleted** in V1: they are deactivated
//! (`status = 'inactif'`) so that historical invoices, payments and receipts
//! keep pointing at a real person. Every mutation writes an `audit_log` row.
//!
//! The core functions take `&Connection` so the tests can run them against an
//! in-memory database; the `#[tauri::command]` wrappers only unwrap the state.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::{AuditEntry, PaginatedStudents, StudentDetail, StudentRow};

/// Allowed values for `students.status`.
pub const STATUS_ACTIVE: &str = "actif";
pub const STATUS_INACTIVE: &str = "inactif";

const ENTITY_TYPE: &str = "student";
const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;
const HISTORY_LIMIT: i64 = 50;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// Payload for `cmd_create_student`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CreateStudentInput {
    pub full_name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub guardian_phone: Option<String>,
    pub guardian_relation: Option<String>,
    pub secondary_contact_name: Option<String>,
    pub school_name: Option<String>,
    pub enrollment_date: Option<String>,
    pub status: Option<String>,
    pub birth_date: Option<String>,
    pub phone: String,
    pub secondary_contact_phone: Option<String>,
    pub guardian_name: Option<String>,
    pub level_id: Option<i64>,
    pub branch_id: Option<i64>,
    pub address: Option<String>,
    pub notes: Option<String>,
}

/// Payload for `cmd_update_student` (same fields as the create payload).
pub type UpdateStudentInput = CreateStudentInput;

/// Clean, validated values ready for SQL.
#[derive(Debug, Clone)]
struct CleanInput {
    full_name: String,
    first_name: Option<String>,
    last_name: Option<String>,
    guardian_phone: Option<String>,
    guardian_relation: Option<String>,
    secondary_contact_name: Option<String>,
    school_name: Option<String>,
    enrollment_date: String,
    status: String,
    birth_date: Option<String>,
    phone: String,
    secondary_contact_phone: Option<String>,
    guardian_name: Option<String>,
    level_id: Option<i64>,
    branch_id: Option<i64>,
    address: Option<String>,
    notes: Option<String>,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Strip the separators a user may type (`06 07 12 34 56`, `06-07-12-34-56`)
/// so validation and storage always work on the ten raw digits.
pub fn normalise_phone(phone: &str) -> String {
    phone
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '\u{00A0}' | '\u{202F}' | '.' | '(' | ')'))
        .collect()
}

/// Moroccan mobile format: exactly 10 digits starting with `06` or `07`.
pub fn is_valid_phone(phone: &str) -> bool {
    let bytes = phone.as_bytes();
    bytes.len() == 10
        && bytes.iter().all(u8::is_ascii_digit)
        && bytes[0] == b'0'
        && (bytes[1] == b'6' || bytes[1] == b'7')
}

fn validate_phone(phone: &str, label: &str) -> Result<String, String> {
    // Spaces and dashes are allowed on input, never in storage: the frontend
    // shows `06 07 12 34 56` and the database keeps `0607123456`.
    let normalised = normalise_phone(phone);
    if normalised.is_empty() {
        return Err(format!("{label} est obligatoire"));
    }
    if !is_valid_phone(&normalised) {
        return Err(format!(
            "Format de {label} invalide (06XXXXXXXX ou 07XXXXXXXX)"
        ));
    }
    Ok(normalised)
}

/// `Option<String>` field → trimmed value, empty string becomes `None`.
fn optional_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn validate_date(value: &Option<String>) -> Result<Option<String>, String> {
    match optional_text(value) {
        None => Ok(None),
        Some(date) => {
            if chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_ok() {
                Ok(Some(date))
            } else {
                Err("Date de naissance invalide (format attendu AAAA-MM-JJ)".to_string())
            }
        }
    }
}

fn level_exists(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let found: Option<i64> = conn
        .query_row("SELECT id FROM levels WHERE id = ?1", params![id], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(found.is_some())
}

fn branch_exists(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT id FROM branches WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn clean_input(conn: &Connection, data: &CreateStudentInput) -> Result<CleanInput, String> {
    let full_name = match (optional_text(&data.first_name), optional_text(&data.last_name)) {
        (Some(first), Some(last)) => format!("{first} {last}"),
        _ => data.full_name.trim().to_string(),
    };
    if full_name.is_empty() {
        return Err("Le nom de l'élève est obligatoire".to_string());
    }
    if full_name.chars().count() < 2 {
        return Err("Le nom de l'élève doit contenir au moins 2 caractères".to_string());
    }

    let phone = validate_phone(data.guardian_phone.as_deref().unwrap_or(&data.phone), "téléphone du tuteur")?;

    let secondary_contact_phone = match optional_text(&data.secondary_contact_phone) {
        None => None,
        Some(value) => Some(validate_phone(&value, "téléphone du parent")?),
    };

    if let Some(level_id) = data.level_id {
        if !level_exists(conn, level_id).map_err(|err| db_err("Vérification du niveau", err))? {
            return Err("Niveau introuvable".to_string());
        }
    }
    if let Some(branch_id) = data.branch_id {
        if !branch_exists(conn, branch_id)
            .map_err(|err| db_err("Vérification de la branche", err))?
        {
            return Err("Branche introuvable".to_string());
        }
    }

    let enrollment_date = match optional_text(&data.enrollment_date) {
        Some(date) => { chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Date d'inscription invalide".to_string())?; date },
        None => chrono::Utc::now().date_naive().to_string(),
    };
    let status = validate_status(data.status.as_deref().unwrap_or(STATUS_ACTIVE))?;
    Ok(CleanInput {
        first_name: optional_text(&data.first_name),
        last_name: optional_text(&data.last_name),
        guardian_phone: Some(phone.clone()),
        guardian_relation: optional_text(&data.guardian_relation),
        secondary_contact_name: optional_text(&data.secondary_contact_name),
        school_name: optional_text(&data.school_name),
        enrollment_date,
        status,
        birth_date: validate_date(&data.birth_date)?,
        phone,
        secondary_contact_phone,
        guardian_name: optional_text(&data.guardian_name),
        level_id: data.level_id,
        branch_id: data.branch_id,
        address: optional_text(&data.address),
        notes: optional_text(&data.notes),
        full_name,
    })
}

fn validate_status(status: &str) -> Result<String, String> {
    let normalised = status.trim().to_lowercase();
    if normalised == STATUS_ACTIVE || normalised == STATUS_INACTIVE {
        Ok(normalised)
    } else {
        Err(format!(
            "Statut invalide : {status} (attendu : actif, inactif)"
        ))
    }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

fn log_audit(
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

/// Snapshot of the editable fields, used to build the UPDATE diff.
fn snapshot(conn: &Connection, id: i64) -> Result<Option<Map<String, Value>>, String> {
    let student = match get_student(conn, id) {
        Ok(student) => student,
        Err(error) if error == "Élève introuvable" => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut map = serde_json::to_value(student).unwrap().as_object().unwrap().clone();
    for key in ["id", "level_name", "branch_name", "created_at", "updated_at"] { map.remove(key); }
    Ok(Some(map))
}

/// `{ "phone": { "from": "06…", "to": "07…" } }` for the fields that changed.
fn diff(before: &Map<String, Value>, after: &Map<String, Value>) -> Map<String, Value> {
    let mut changes = Map::new();
    for (key, new_value) in after {
        let old_value = before.get(key);
        if old_value != Some(new_value) {
            changes.insert(
                key.clone(),
                json!({ "from": old_value.cloned().unwrap_or(Value::Null), "to": new_value }),
            );
        }
    }
    changes
}

fn input_json(clean: &CleanInput) -> Value {
    json!({
        "full_name": clean.full_name,
        "first_name": clean.first_name,
        "last_name": clean.last_name,
        "guardian_phone": clean.guardian_phone,
        "guardian_relation": clean.guardian_relation,
        "secondary_contact_name": clean.secondary_contact_name,
        "school_name": clean.school_name,
        "enrollment_date": clean.enrollment_date,
        "status": clean.status,
        "birth_date": clean.birth_date,
        "phone": clean.phone,
        "secondary_contact_phone": clean.secondary_contact_phone,
        "guardian_name": clean.guardian_name,
        "level_id": clean.level_id,
        "branch_id": clean.branch_id,
        "address": clean.address,
        "notes": clean.notes,
    })
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

const SELECT_STUDENT: &str = "SELECT s.id, s.full_name, s.birth_date, s.phone, s.secondary_contact_phone,
            s.guardian_name, s.level_id, l.name AS level_name,
            s.branch_id, b.name AS branch_name,
            s.address, s.notes, s.status, s.created_at, s.updated_at,
            s.first_name, s.last_name, s.guardian_phone, s.guardian_relation,
            s.secondary_contact_name, s.school_name, s.enrollment_date
     FROM students s
     LEFT JOIN levels l ON l.id = s.level_id
     LEFT JOIN branches b ON b.id = s.branch_id";

fn map_student(row: &Row<'_>) -> rusqlite::Result<StudentRow> {
    Ok(StudentRow {
        id: row.get(0)?,
        full_name: row.get(1)?,
        first_name: row.get(15)?,
        last_name: row.get(16)?,
        guardian_phone: row.get(17)?,
        guardian_relation: row.get(18)?,
        secondary_contact_name: row.get(19)?,
        school_name: row.get(20)?,
        enrollment_date: row.get(21)?,
        birth_date: row.get(2)?,
        // `phone` is nullable at the SQL level (legacy rows); the API always
        // exposes a string so the UI never has to handle null.
        phone: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        secondary_contact_phone: row.get(4)?,
        guardian_name: row.get(5)?,
        level_id: row.get(6)?,
        level_name: row.get(7)?,
        branch_id: row.get(8)?,
        branch_name: row.get(9)?,
        address: row.get(10)?,
        notes: row.get(11)?,
        status: row
            .get::<_, Option<String>>(12)?
            .unwrap_or_else(|| STATUS_ACTIVE.to_string()),
        created_at: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
        updated_at: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
    })
}

/// Read one student with its level and branch names.
pub fn get_student(conn: &Connection, id: i64) -> Result<StudentRow, String> {
    conn.query_row(
        &format!("{SELECT_STUDENT} WHERE s.id = ?1 AND s.deleted_at IS NULL"),
        params![id],
        map_student,
    )
    .optional()
    .map_err(|err| db_err("Lecture de l'élève", err))?
    .ok_or_else(|| "Élève introuvable".to_string())
}

/// Build the optional WHERE clause shared by the list and count queries.
fn build_filters(
    search: Option<&str>,
    level_id: Option<i64>,
    status: Option<&str>,
) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = vec!["s.deleted_at IS NULL".to_string()];
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(term) = search.map(str::trim).filter(|term| !term.is_empty()) {
        // SQLite's LIKE is already ASCII case-insensitive; accents are matched
        // case-sensitively (a documented SQLite limitation).
        clauses.push("(s.full_name LIKE ? OR COALESCE(s.first_name, '') LIKE ? OR COALESCE(s.last_name, '') LIKE ? OR COALESCE(s.phone, '') LIKE ? OR COALESCE(s.guardian_name, '') LIKE ? OR COALESCE(s.guardian_phone, '') LIKE ? OR COALESCE(s.secondary_contact_phone, '') LIKE ?)".to_string());
        let pattern = format!("%{term}%");
        let phone_pattern = format!("%{}%", normalise_phone(term));
        values.push(Box::new(pattern.clone()));
        values.push(Box::new(pattern.clone()));
        values.push(Box::new(pattern.clone()));
        values.push(Box::new(phone_pattern.clone()));
        values.push(Box::new(pattern));
        values.push(Box::new(phone_pattern.clone()));
        values.push(Box::new(phone_pattern));
    }
    if let Some(level) = level_id {
        clauses.push("s.level_id = ?".to_string());
        values.push(Box::new(level));
    }
    if let Some(status) = status.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push("s.status = ?".to_string());
        values.push(Box::new(status.to_string()));
    }

    let sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (sql, values)
}

/// Paginated, filtered student list.
pub fn list_students(
    conn: &Connection,
    search: Option<&str>,
    level_id: Option<i64>,
    status: Option<&str>,
    page: i64,
    limit: i64,
) -> Result<PaginatedStudents, String> {
    let page = page.max(1);
    let limit = if limit <= 0 {
        DEFAULT_LIMIT
    } else {
        limit.min(MAX_LIMIT)
    };

    let (where_sql, values) = build_filters(search, level_id, status);
    let params_ref: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value.as_ref()).collect();

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM students s{where_sql}"),
            params_ref.as_slice(),
            |row| row.get(0),
        )
        .map_err(|err| db_err("Comptage des élèves", err))?;

    let offset = (page - 1) * limit;
    let sql = format!(
        "{SELECT_STUDENT}{where_sql}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ? OFFSET ?"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation de la liste des élèves", err))?;

    let mut all: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value.as_ref()).collect();
    all.push(&limit);
    all.push(&offset);

    let rows = stmt
        .query_map(all.as_slice(), map_student)
        .map_err(|err| db_err("Lecture des élèves", err))?;

    let mut data = Vec::new();
    for row in rows {
        data.push(row.map_err(|err| db_err("Lecture d'un élève", err))?);
    }

    Ok(PaginatedStudents {
        data,
        total,
        page,
        limit,
    })
}

/// Audit history for one student, most recent first.
pub fn student_history(conn: &Connection, id: i64) -> Result<Vec<AuditEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, action, entity_type, details, created_at
             FROM audit_log
             WHERE entity_type = ?1 AND entity_id = ?2
             ORDER BY created_at DESC, id DESC
             LIMIT ?3",
        )
        .map_err(|err| db_err("Préparation de l'historique", err))?;

    let rows = stmt
        .query_map(params![ENTITY_TYPE, id, HISTORY_LIMIT], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                action: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                entity_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                details: row.get(3)?,
                created_at: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        })
        .map_err(|err| db_err("Lecture de l'historique", err))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|err| db_err("Lecture d'une entrée d'audit", err))?);
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/// Create a student and return the new id.
pub fn create_student(conn: &Connection, data: &CreateStudentInput) -> Result<i64, String> {
    let clean = clean_input(conn, data)?;

    conn.execute(
        "INSERT INTO students (full_name, birth_date, phone, secondary_contact_phone, guardian_name,
         level_id, branch_id, address, notes, status, first_name, last_name, guardian_phone,
         guardian_relation, secondary_contact_name, school_name, enrollment_date)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![clean.full_name, clean.birth_date, clean.phone, clean.secondary_contact_phone,
            clean.guardian_name, clean.level_id, clean.branch_id, clean.address, clean.notes,
            clean.status, clean.first_name, clean.last_name, clean.guardian_phone, clean.guardian_relation,
            clean.secondary_contact_name, clean.school_name, clean.enrollment_date],
    )
    .map_err(|err| db_err("Création de l'élève", err))?;

    let id = conn.last_insert_rowid();
    log_audit(conn, "CREATE", id, Some(input_json(&clean).to_string()))?;
    Ok(id)
}

/// Update a student; the audit row contains a per-field before/after diff.
pub fn update_student(conn: &Connection, id: i64, data: &UpdateStudentInput) -> Result<(), String> {
    let before = snapshot(conn, id)?.ok_or_else(|| "Élève introuvable".to_string())?;
    let clean = clean_input(conn, data)?;

    conn.execute(
        "UPDATE students SET full_name=?1, birth_date=?2, phone=?3, secondary_contact_phone=?4,
         guardian_name=?5, level_id=?6, branch_id=?7, address=?8, notes=?9, status=?10,
         first_name=?11, last_name=?12, guardian_phone=?13, guardian_relation=?14,
         secondary_contact_name=?15, school_name=?16, enrollment_date=?17, updated_at=CURRENT_TIMESTAMP
         WHERE id=?18",
        params![clean.full_name, clean.birth_date, clean.phone, clean.secondary_contact_phone,
            clean.guardian_name, clean.level_id, clean.branch_id, clean.address, clean.notes,
            clean.status, clean.first_name, clean.last_name, clean.guardian_phone, clean.guardian_relation,
            clean.secondary_contact_name, clean.school_name, clean.enrollment_date, id],
    )
    .map_err(|err| db_err("Mise à jour de l'élève", err))?;

    let after = json!(input_json(&clean));
    let after_map = after.as_object().cloned().unwrap_or_default();
    let changes = diff(&before, &after_map);

    // Nothing changed -> no audit noise.
    if changes.is_empty() {
        return Ok(());
    }

    log_audit(conn, "UPDATE", id, Some(Value::Object(changes).to_string()))
}

/// Activate / deactivate a student (V1 never deletes).
pub fn set_student_status(conn: &Connection, id: i64, status: &str) -> Result<(), String> {
    let status = validate_status(status)?;

    let current: Option<String> = conn
        .query_row(
            "SELECT COALESCE(status, ?2) FROM students WHERE id = ?1",
            params![id, STATUS_ACTIVE],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture du statut", err))?;

    let Some(current) = current else {
        return Err("Élève introuvable".to_string());
    };
    if current == status {
        return Ok(());
    }

    conn.execute(
        "UPDATE students SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![status, id],
    )
    .map_err(|err| db_err("Changement de statut", err))?;

    log_audit(
        conn,
        "STATUS_CHANGE",
        id,
        Some(json!({ "from": current, "to": status }).to_string()),
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

fn validate_required_form_fields(data: &CreateStudentInput) -> Result<(), String> {
    if optional_text(&data.first_name).is_none() || optional_text(&data.last_name).is_none() {
        return Err("Prénom et nom obligatoires".into());
    }
    if optional_text(&data.guardian_name).is_none() { return Err("Nom du tuteur obligatoire".into()); }
    if data.level_id.is_none() { return Err("Niveau obligatoire".into()); }
    Ok(())
}

#[tauri::command]
pub fn cmd_create_student(db: State<'_, Db>, data: CreateStudentInput) -> Result<i64, String> {
    let conn = db.conn();
    validate_required_form_fields(&data)?;
    create_student(&conn, &data)
}

#[tauri::command]
pub fn cmd_update_student(
    db: State<'_, Db>,
    id: i64,
    data: UpdateStudentInput,
) -> Result<(), String> {
    let conn = db.conn();
    validate_required_form_fields(&data)?;
    update_student(&conn, id, &data)
}

#[tauri::command]
pub fn cmd_get_students(
    db: State<'_, Db>,
    search: Option<String>,
    level_id: Option<i64>,
    status: Option<String>,
    page: Option<i64>,
    limit: Option<i64>,
) -> Result<PaginatedStudents, String> {
    let conn = db.conn();
    list_students(
        &conn,
        search.as_deref(),
        level_id,
        status.as_deref(),
        page.unwrap_or(1),
        limit.unwrap_or(DEFAULT_LIMIT),
    )
}

#[tauri::command]
pub fn cmd_get_student_detail(db: State<'_, Db>, id: i64) -> Result<StudentDetail, String> {
    let conn = db.conn();
    let student = get_student(&conn, id)?;
    let enrollments = super::enrollments::student_enrollments(&conn, id)?
        .into_iter()
        .map(|enrollment| serde_json::to_value(enrollment).unwrap_or(serde_json::Value::Null))
        .collect();
    Ok(StudentDetail {
        student,
        enrollments,
        // Phase 5 fills invoices.
        invoices: Vec::new(),
        audit_log: student_history(&conn, id)?,
    })
}

#[tauri::command]
pub fn cmd_set_student_status(db: State<'_, Db>, id: i64, status: String) -> Result<(), String> {
    let conn = db.conn();
    set_student_status(&conn, id, &status)
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

    fn sample(name: &str, phone: &str) -> CreateStudentInput {
        CreateStudentInput {
            full_name: name.to_string(),
            birth_date: Some("2010-05-12".to_string()),
            phone: phone.to_string(),
            secondary_contact_phone: Some("0661112233".to_string()),
            guardian_name: Some("Rachid El Amrani".to_string()),
            level_id: Some(10), // Tronc Commun
            branch_id: Some(1), // Sciences Maths @ Tronc Commun
            address: Some("12 rue des Écoles".to_string()),
            notes: Some("Payé par la mère".to_string()),
            ..Default::default()
        }
    }

    fn minimal(name: &str, phone: &str) -> CreateStudentInput {
        CreateStudentInput {
            full_name: name.to_string(),
            birth_date: None,
            phone: phone.to_string(),
            secondary_contact_phone: None,
            guardian_name: None,
            level_id: None,
            branch_id: None,
            address: None,
            notes: None,
            ..Default::default()
        }
    }

    #[test]
    fn guardian_phone_is_normalised_validated_and_searchable() {
        let conn = test_conn();
        let mut data = sample("Salma Mansouri", "0612345678");
        data.guardian_phone = Some("06 61-23 45 67".into());
        let id = create_student(&conn, &data).unwrap();
        let student = get_student(&conn, id).unwrap();
        assert_eq!(student.phone, "0661234567");
        assert_eq!(student.guardian_phone.as_deref(), Some("0661234567"));
        assert_eq!(list_students(&conn, Some("Rachid"), None, None, 1, 20).unwrap().total, 1);
        assert_eq!(list_students(&conn, Some("06 61 23 45 67"), None, None, 1, 20).unwrap().total, 1);
        data.guardian_phone = Some("0512345678".into());
        assert!(create_student(&conn, &data).is_err());
    }

    #[test]
    fn phone_validation_accepts_moroccan_mobiles_only() {
        for valid in ["0612345678", "0712345678", "0600000000"] {
            assert!(is_valid_phone(valid), "{valid} should be valid");
        }
        for invalid in [
            "0123456789",  // starts with 01
            "061234567",   // 9 digits
            "06123456789", // 11 digits
            "0812345678",  // starts with 08
            "06 12 34 56", // spaces
            "+212612345678",
            "061234567a",
            "",
        ] {
            assert!(!is_valid_phone(invalid), "{invalid} should be rejected");
        }
    }

    #[test]
    fn phone_separators_are_stripped_before_validation_and_storage() {
        // What the user sees: `06 07 12 34 56`; what SQLite keeps: `0607123456`.
        for typed in ["06 07 12 34 56", "06-07-12-34-56", "06 07-12 34-56"] {
            assert_eq!(normalise_phone(typed), "0607123456");
        }

        let conn = test_conn();
        let mut input = minimal("Omar Tazi", "06 98 76 54 32");
        input.secondary_contact_phone = Some("06-11-22-33-44".to_string());
        let id = create_student(&conn, &input).unwrap();

        let student = get_student(&conn, id).unwrap();
        assert_eq!(student.phone, "0698765432", "spaces must not be stored");
        assert_eq!(student.secondary_contact_phone.as_deref(), Some("0611223344"));

        // A wrong length stays invalid once the separators are gone.
        let mut broken = minimal("Bad Phone", "06 12 34 56 7");
        broken.secondary_contact_phone = None;
        assert!(create_student(&conn, &broken).is_err());
    }

    #[test]
    fn guardian_name_and_address_round_trip() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        let student = get_student(&conn, id).unwrap();
        assert_eq!(student.guardian_name.as_deref(), Some("Rachid El Amrani"));
        assert_eq!(student.address.as_deref(), Some("12 rue des Écoles"));

        // Partial update: clearing a field writes NULL, not an empty string.
        let mut update = sample("Yassine El Amrani", "0612345678");
        update.guardian_name = None;
        update.address = Some("3 avenue Hassan II".to_string());
        update_student(&conn, id, &update).unwrap();

        let updated = get_student(&conn, id).unwrap();
        assert_eq!(updated.guardian_name, None);
        assert_eq!(updated.address.as_deref(), Some("3 avenue Hassan II"));

        // The audit trail names the changed fields.
        let history = student_history(&conn, id).unwrap();
        let details = history
            .iter()
            .filter_map(|entry| entry.details.clone())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(details.contains("address"));
    }

    #[test]
    fn create_student_persists_joins_and_audit() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        let student = get_student(&conn, id).unwrap();
        assert_eq!(student.full_name, "Yassine El Amrani");
        assert_eq!(student.phone, "0612345678");
        assert_eq!(student.status, STATUS_ACTIVE);
        assert_eq!(student.level_name.as_deref(), Some("Tronc Commun"));
        assert_eq!(student.branch_name.as_deref(), Some("Sciences Maths"));
        assert_eq!(student.birth_date.as_deref(), Some("2010-05-12"));

        let history = student_history(&conn, id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].action, "CREATE");
        assert_eq!(history[0].entity_type, "student");
        assert!(history[0].details.as_deref().unwrap().contains("Yassine"));
    }

    #[test]
    fn create_student_with_required_fields_only() {
        let conn = test_conn();
        let id = create_student(&conn, &minimal("  Salma  ", "0712345678")).unwrap();
        let student = get_student(&conn, id).unwrap();

        assert_eq!(student.full_name, "Salma");
        assert!(student.level_id.is_none());
        assert!(student.branch_id.is_none());
        assert!(student.secondary_contact_phone.is_none());
        assert_eq!(student.status, STATUS_ACTIVE);
    }

    #[test]
    fn validation_rejects_bad_input() {
        let conn = test_conn();

        let err = create_student(&conn, &minimal("   ", "0612345678")).unwrap_err();
        assert!(err.contains("obligatoire"), "{err}");

        let err = create_student(&conn, &minimal("A", "0612345678")).unwrap_err();
        assert!(err.contains("2 caractères"), "{err}");

        for bad_phone in ["0123456789", "061234567", "0812345678"] {
            let err = create_student(&conn, &minimal("Nom Valide", bad_phone)).unwrap_err();
            assert!(err.contains("Format"), "{bad_phone} -> {err}");
        }

        let mut data = minimal("Nom Valide", "0612345678");
        data.secondary_contact_phone = Some("0123456789".to_string());
        assert!(create_student(&conn, &data).unwrap_err().contains("Format"));

        let mut data = minimal("Nom Valide", "0612345678");
        data.level_id = Some(999);
        assert_eq!(
            create_student(&conn, &data).unwrap_err(),
            "Niveau introuvable"
        );

        let mut data = minimal("Nom Valide", "0612345678");
        data.branch_id = Some(999);
        assert_eq!(
            create_student(&conn, &data).unwrap_err(),
            "Branche introuvable"
        );

        let mut data = minimal("Nom Valide", "0612345678");
        data.birth_date = Some("12/05/2010".to_string());
        assert!(create_student(&conn, &data)
            .unwrap_err()
            .contains("Date de naissance invalide"));
    }

    #[test]
    fn update_writes_a_diff() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        let mut data = sample("Yassine El Amrani", "0698765432");
        data.notes = Some("Bourse 20%".to_string());
        update_student(&conn, id, &data).unwrap();

        let student = get_student(&conn, id).unwrap();
        assert_eq!(student.phone, "0698765432");
        assert_eq!(student.notes.as_deref(), Some("Bourse 20%"));

        let history = student_history(&conn, id).unwrap();
        assert_eq!(history[0].action, "UPDATE");
        let details = history[0].details.as_deref().unwrap();
        assert!(details.contains("\"phone\""), "{details}");
        assert!(details.contains("0612345678"), "{details}");
        assert!(details.contains("0698765432"), "{details}");
        assert!(details.contains("\"notes\""), "{details}");
        // unchanged fields are not reported
        assert!(!details.contains("full_name"), "{details}");
    }

    #[test]
    fn update_without_changes_writes_no_audit_row() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();
        update_student(&conn, id, &sample("Yassine El Amrani", "0612345678")).unwrap();

        let history = student_history(&conn, id).unwrap();
        assert_eq!(history.len(), 1, "only the CREATE row");
    }

    #[test]
    fn update_and_status_changes_on_missing_student_fail() {
        let conn = test_conn();
        assert_eq!(
            update_student(&conn, 404, &minimal("Nom", "0612345678")).unwrap_err(),
            "Élève introuvable"
        );
        assert_eq!(
            set_student_status(&conn, 404, STATUS_INACTIVE).unwrap_err(),
            "Élève introuvable"
        );
    }

    #[test]
    fn status_toggles_and_is_audited() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        set_student_status(&conn, id, "inactif").unwrap();
        assert_eq!(get_student(&conn, id).unwrap().status, "inactif");

        let history = student_history(&conn, id).unwrap();
        assert_eq!(history[0].action, "STATUS_CHANGE");
        assert!(history[0]
            .details
            .as_deref()
            .unwrap()
            .contains("\"to\":\"inactif\""));

        set_student_status(&conn, id, "actif").unwrap();
        assert_eq!(get_student(&conn, id).unwrap().status, "actif");

        let err = set_student_status(&conn, id, "supprime").unwrap_err();
        assert!(err.contains("Statut invalide"), "{err}");

        // setting the same status twice does not duplicate the audit entry
        let before = student_history(&conn, id).unwrap().len();
        set_student_status(&conn, id, "actif").unwrap();
        assert_eq!(student_history(&conn, id).unwrap().len(), before);
    }

    #[test]
    fn list_filters_search_and_paginates() {
        let conn = test_conn();
        for index in 1..=25 {
            let name = format!("Élève {:02}", index);
            let phone = format!("06{:08}", index);
            let mut data = minimal(&name, &phone);
            data.level_id = if index % 2 == 0 { Some(10) } else { Some(1) };
            create_student(&conn, &data).unwrap();
        }
        let inactive = create_student(&conn, &minimal("Zineb Inactive", "0700000009")).unwrap();
        set_student_status(&conn, inactive, "inactif").unwrap();

        let page_one = list_students(&conn, None, None, None, 1, 20).unwrap();
        assert_eq!(page_one.total, 26);
        assert_eq!(page_one.data.len(), 20);
        assert_eq!(page_one.page, 1);
        assert_eq!(page_one.limit, 20);

        let page_two = list_students(&conn, None, None, None, 2, 20).unwrap();
        assert_eq!(page_two.data.len(), 6);
        assert_eq!(page_two.total, 26);

        // no overlap between pages
        let ids_one: Vec<i64> = page_one.data.iter().map(|s| s.id).collect();
        let ids_two: Vec<i64> = page_two.data.iter().map(|s| s.id).collect();
        assert!(ids_two.iter().all(|id| !ids_one.contains(id)));

        // newest first
        assert_eq!(page_one.data[0].full_name, "Zineb Inactive");

        // search by name, case-insensitive partial match
        let by_name = list_students(&conn, Some("zineb"), None, None, 1, 20).unwrap();
        assert_eq!(by_name.total, 1);
        assert_eq!(by_name.data[0].full_name, "Zineb Inactive");

        // search by phone
        let by_phone = list_students(&conn, Some("0600000007"), None, None, 1, 20).unwrap();
        assert_eq!(by_phone.total, 1);
        assert_eq!(by_phone.data[0].full_name, "Élève 07");

        // filter by level
        let lvl = list_students(&conn, None, Some(10), None, 1, 20).unwrap();
        assert_eq!(lvl.total, 12);

        // filter by status
        let actives = list_students(&conn, None, None, Some("actif"), 1, 20).unwrap();
        assert_eq!(actives.total, 25);
        let inactives = list_students(&conn, None, None, Some("inactif"), 1, 20).unwrap();
        assert_eq!(inactives.total, 1);

        // combined filters
        let combined = list_students(&conn, Some("Élève"), Some(1), Some("actif"), 1, 20).unwrap();
        assert_eq!(combined.total, 13);

        // out-of-range page returns no rows but keeps the total
        let beyond = list_students(&conn, None, None, None, 9, 20).unwrap();
        assert!(beyond.data.is_empty());
        assert_eq!(beyond.total, 26);

        // limit is clamped
        let clamped = list_students(&conn, None, None, None, 1, 500).unwrap();
        assert_eq!(clamped.limit, MAX_LIMIT);
        let fallback = list_students(&conn, None, None, None, 1, 0).unwrap();
        assert_eq!(fallback.limit, DEFAULT_LIMIT);
    }

    #[test]
    fn detail_carries_enrollments_and_leaves_invoices_empty() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        // A student without enrollment still answers with the Phase 4 array.
        let student = get_student(&conn, id).unwrap();
        let detail = StudentDetail {
            student,
            enrollments: super::super::enrollments::student_enrollments(&conn, id)
                .unwrap()
                .into_iter()
                .map(|enrollment| serde_json::to_value(enrollment).unwrap())
                .collect(),
            invoices: Vec::new(),
            audit_log: student_history(&conn, id).unwrap(),
        };
        assert!(detail.enrollments.is_empty());
        assert!(detail.invoices.is_empty());
        assert_eq!(detail.audit_log.len(), 1);
        assert_eq!(get_student(&conn, 404).unwrap_err(), "Élève introuvable");
    }

    #[test]
    fn deleting_a_level_keeps_the_student() {
        let conn = test_conn();
        let id = create_student(&conn, &sample("Yassine El Amrani", "0612345678")).unwrap();

        conn.execute("DELETE FROM branches WHERE level_id = 10", [])
            .unwrap();
        conn.execute("DELETE FROM levels WHERE id = 10", [])
            .unwrap();

        let student = get_student(&conn, id).unwrap();
        assert!(student.level_id.is_none());
        assert!(student.level_name.is_none());
        assert!(student.branch_id.is_none());
        assert_eq!(student.full_name, "Yassine El Amrani");
    }
}
