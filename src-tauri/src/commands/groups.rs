//! Group management (Phase 4).
//!
//! A group is one scheduled class: subject + level (+ branch) + teacher + a
//! weekly slot, a monthly fee in centimes and a hard capacity. Capacity is
//! never stored — it is computed from the active enrollments each time, so it
//! can never drift out of sync with `enrollments`.
//!
//! Like the other modules the core functions take `&Connection` so the tests
//! can run them against an in-memory database; the `#[tauri::command]`
//! wrappers only unwrap the shared state.

use chrono::Datelike;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::State;

use super::db_err;
use super::schedules::{attach_schedules, clean_schedules, schedules_from_payload, ScheduleInput};
use crate::db::Db;
use crate::models::{
    EnrolledStudent, FinancialSummary, GroupDetail, GroupRow, GroupSchedule, TeacherOption,
};

const ENTITY_TYPE: &str = "group";

/// Canonical weekday names, in school-week order.
pub const DAY_NAMES: [&str; 7] = [
    "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

/// Payload for `cmd_create_group` / `cmd_update_group`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateGroupInput {
    pub subject_id: i64,
    pub level_id: i64,
    pub branch_id: Option<i64>,
    pub teacher_id: Option<i64>,
    pub school_year_id: i64,
    /// Legacy single slot: still sent by older callers, and by the form as the
    /// first schedule (kept in sync by the backend).
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
    /// Phase 13 — the whole week. When present it wins over the single slot.
    #[serde(default)]
    pub schedules: Option<Vec<ScheduleInput>>,
    pub room: Option<String>,
    pub monthly_fee_cents: i64,
    pub capacity: i32,
}

/// Same fields as the create payload.
pub type UpdateGroupInput = CreateGroupInput;

/// Clean, validated values ready for SQL.
#[derive(Debug, Clone)]
struct CleanGroup {
    subject_id: i64,
    level_id: i64,
    branch_id: Option<i64>,
    teacher_id: Option<i64>,
    school_year_id: i64,
    /// First slot, mirrored into the legacy columns.
    day_of_week: String,
    start_time: String,
    end_time: String,
    /// Every slot, validated and sorted, ready to insert.
    schedules: Vec<GroupSchedule>,
    room: Option<String>,
    monthly_fee_cents: i64,
    capacity: i64,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Canonical weekday name (`lundi` → `Lundi`), or `None` when unknown.
pub fn normalise_day(day: &str) -> Option<&'static str> {
    let wanted = day.trim().to_lowercase();
    DAY_NAMES
        .iter()
        .find(|name| name.to_lowercase() == wanted)
        .copied()
}

fn optional_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn id_exists(conn: &Connection, table: &str, id: i64) -> rusqlite::Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            &format!("SELECT id FROM {table} WHERE id = ?1"),
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn active_enrollment_count(conn: &Connection, group_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM enrollments WHERE group_id = ?1 AND COALESCE(status, 'actif') = 'actif'",
        params![group_id],
        |row| row.get(0),
    )
}

/// Validate the week and return it with its first slot.
///
/// The first slot (school-week order) is what the legacy `groups` columns mirror.
fn split_week(
    payload: &[super::schedules::ScheduleInput],
) -> Result<(Vec<GroupSchedule>, GroupSchedule), String> {
    let schedules = clean_schedules(payload)?;
    let first = schedules
        .first()
        .cloned()
        .ok_or_else(|| "Au moins un jour de cours est requis".to_string())?;
    Ok((schedules, first))
}

fn clean_input(conn: &Connection, data: &CreateGroupInput) -> Result<CleanGroup, String> {
    if !id_exists(conn, "subjects", data.subject_id)
        .map_err(|err| db_err("Vérification de la matière", err))?
    {
        return Err("Matière introuvable".to_string());
    }
    if !id_exists(conn, "levels", data.level_id)
        .map_err(|err| db_err("Vérification du niveau", err))?
    {
        return Err("Niveau introuvable".to_string());
    }
    if let Some(branch_id) = data.branch_id {
        let owner: Option<Option<i64>> = conn
            .query_row(
                "SELECT level_id FROM branches WHERE id = ?1",
                params![branch_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| db_err("Vérification de la branche", err))?;
        match owner {
            None => return Err("Branche introuvable".to_string()),
            Some(level_id) if level_id != Some(data.level_id) => {
                return Err("La branche ne correspond pas au niveau sélectionné".to_string())
            }
            Some(_) => {}
        }
    }
    if let Some(teacher_id) = data.teacher_id {
        if !id_exists(conn, "teachers", teacher_id)
            .map_err(|err| db_err("Vérification de l'enseignant", err))?
        {
            return Err("Enseignant introuvable".to_string());
        }
    }
    if !id_exists(conn, "school_years", data.school_year_id)
        .map_err(|err| db_err("Vérification de l'année scolaire", err))?
    {
        return Err("Année scolaire introuvable".to_string());
    }

    // Phase 13: the form sends the whole week; older callers send one slot.
    let payload = schedules_from_payload(
        data.schedules.as_deref(),
        &data.day_of_week,
        &data.start_time,
        &data.end_time,
    );
    let (schedules, first) = split_week(&payload)?;
    let day_of_week = normalise_day(&first.day_of_week)
        .ok_or_else(|| "Jour de la semaine invalide".to_string())?;
    let start = first.start_time.clone();
    let end = first.end_time.clone();

    if data.monthly_fee_cents <= 0 {
        return Err("Le tarif doit être supérieur à 0".to_string());
    }
    if data.capacity < 1 {
        return Err("La capacité doit être au moins 1".to_string());
    }

    Ok(CleanGroup {
        subject_id: data.subject_id,
        level_id: data.level_id,
        branch_id: data.branch_id,
        teacher_id: data.teacher_id,
        school_year_id: data.school_year_id,
        day_of_week: day_of_week.to_string(),
        start_time: start,
        end_time: end,
        schedules,
        room: optional_text(&data.room),
        monthly_fee_cents: data.monthly_fee_cents,
        capacity: data.capacity as i64,
    })
}

// ---------------------------------------------------------------------------
// Audit helpers
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

/// Write the validated week of a group.
fn insert_schedules(
    conn: &Connection,
    group_id: i64,
    schedules: &[GroupSchedule],
) -> Result<(), String> {
    for slot in schedules {
        conn.execute(
            "INSERT INTO group_schedules (group_id, day_of_week, start_time, end_time)
             VALUES (?1, ?2, ?3, ?4)",
            params![group_id, slot.day_of_week, slot.start_time, slot.end_time],
        )
        .map_err(|err| db_err("Enregistrement d'un horaire", err))?;
    }
    Ok(())
}

fn input_json(clean: &CleanGroup) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("subject_id".into(), json!(clean.subject_id));
    map.insert("level_id".into(), json!(clean.level_id));
    map.insert("branch_id".into(), json!(clean.branch_id));
    map.insert("teacher_id".into(), json!(clean.teacher_id));
    map.insert("school_year_id".into(), json!(clean.school_year_id));
    map.insert("day_of_week".into(), json!(clean.day_of_week));
    map.insert("start_time".into(), json!(clean.start_time));
    map.insert("end_time".into(), json!(clean.end_time));
    map.insert("room".into(), json!(clean.room));
    map.insert("monthly_fee_cents".into(), json!(clean.monthly_fee_cents));
    map.insert("capacity".into(), json!(clean.capacity));
    map.insert(
        "schedules".into(),
        Value::Array(
            clean
                .schedules
                .iter()
                .map(|slot| {
                    json!({
                        "day_of_week": slot.day_of_week,
                        "start_time": slot.start_time,
                        "end_time": slot.end_time,
                    })
                })
                .collect(),
        ),
    );
    map
}

/// Raw `groups` row read by [`snapshot`] (ids and schedule fields are all
/// nullable in the schema, the two money/capacity columns are not).
type GroupSnapshotRow = (
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    i64,
);

fn snapshot(conn: &Connection, id: i64) -> Result<Option<Map<String, Value>>, String> {
    let row: Option<GroupSnapshotRow> = conn
        .query_row(
            "SELECT subject_id, level_id, branch_id, teacher_id, school_year_id,
                    day_of_week, start_time, end_time, room, monthly_fee_cents, capacity
             FROM groups WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                ))
            },
        )
        .optional()
        .map_err(|err| db_err("Lecture du groupe", err))?;

    let Some((
        subject_id,
        level_id,
        branch_id,
        teacher_id,
        school_year_id,
        day_of_week,
        start_time,
        end_time,
        room,
        monthly_fee_cents,
        capacity,
    )) = row
    else {
        return Ok(None);
    };

    let mut map = Map::new();
    map.insert("subject_id".into(), json!(subject_id));
    map.insert("level_id".into(), json!(level_id));
    map.insert("branch_id".into(), json!(branch_id));
    map.insert("teacher_id".into(), json!(teacher_id));
    map.insert("school_year_id".into(), json!(school_year_id));
    map.insert("day_of_week".into(), json!(day_of_week));
    map.insert("start_time".into(), json!(start_time));
    map.insert("end_time".into(), json!(end_time));
    map.insert("room".into(), json!(room));
    map.insert("monthly_fee_cents".into(), json!(monthly_fee_cents));
    map.insert("capacity".into(), json!(capacity));
    let stored = super::schedules::group_schedules(conn, id)?;
    map.insert(
        "schedules".into(),
        Value::Array(
            stored
                .iter()
                .map(|slot| {
                    json!({
                        "day_of_week": slot.day_of_week,
                        "start_time": slot.start_time,
                        "end_time": slot.end_time,
                    })
                })
                .collect(),
        ),
    );
    Ok(Some(map))
}

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

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/// `enrolled_count` is computed, never stored.
pub(crate) const SELECT_GROUP: &str = "SELECT g.id,
            g.subject_id, COALESCE(s.name, '—') AS subject_name,
            g.level_id, COALESCE(l.name, '—') AS level_name,
            g.branch_id, b.name AS branch_name,
            g.teacher_id, t.full_name AS teacher_name,
            g.school_year_id,
            COALESCE(g.day_of_week, '') AS day_of_week,
            COALESCE(g.start_time, '') AS start_time,
            COALESCE(g.end_time, '') AS end_time,
            g.room, g.monthly_fee_cents, g.capacity,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.group_id = g.id AND COALESCE(e.status, 'actif') = 'actif' AND EXISTS (SELECT 1 FROM students st WHERE st.id=e.student_id AND st.deleted_at IS NULL)) AS enrolled_count,
            COALESCE(g.status, 'actif') AS status
     FROM groups g
     LEFT JOIN subjects s ON s.id = g.subject_id
     LEFT JOIN levels l ON l.id = g.level_id
     LEFT JOIN branches b ON b.id = g.branch_id
     LEFT JOIN teachers t ON t.id = g.teacher_id";

/// School-week order, then start time.
pub(crate) const GROUP_ORDER: &str = "ORDER BY
        CASE g.day_of_week
            WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
            WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6
            WHEN 'Dimanche' THEN 7 ELSE 99 END,
        g.start_time, g.id";

pub(crate) fn map_group(row: &Row<'_>) -> rusqlite::Result<GroupRow> {
    Ok(GroupRow {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        subject_name: row.get(2)?,
        level_id: row.get(3)?,
        level_name: row.get(4)?,
        branch_id: row.get(5)?,
        branch_name: row.get(6)?,
        teacher_id: row.get(7)?,
        teacher_name: row.get(8)?,
        school_year_id: row.get(9)?,
        day_of_week: row.get(10)?,
        start_time: row.get(11)?,
        end_time: row.get(12)?,
        room: row.get(13)?,
        monthly_fee_cents: row.get(14)?,
        capacity: row.get(15)?,
        enrolled_count: row.get(16)?,
        status: row.get(17)?,
        // Filled by `attach_schedules` in one batch query per list.
        schedules: Vec::new(),
        schedule_text: String::new(),
    })
}

/// All groups, optionally narrowed to a school year and/or a status.
pub fn list_groups(
    conn: &Connection,
    school_year_id: Option<i64>,
    status: Option<&str>,
) -> Result<Vec<GroupRow>, String> {
    let mut clauses: Vec<String> = vec!["g.deleted_at IS NULL".to_string(), "g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)".to_string()];
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(year) = school_year_id {
        clauses.push("g.school_year_id = ?".to_string());
        values.push(Box::new(year));
    }
    if let Some(status) = status.map(str::trim).filter(|value| !value.is_empty()) {
        clauses.push("COALESCE(g.status, 'actif') = ?".to_string());
        values.push(Box::new(status.to_string()));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };

    let sql = format!("{SELECT_GROUP}{where_sql} {GROUP_ORDER}");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation de la liste des groupes", err))?;

    let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value.as_ref()).collect();
    let rows = stmt
        .query_map(refs.as_slice(), map_group)
        .map_err(|err| db_err("Lecture des groupes", err))?;

    let mut groups = Vec::new();
    for row in rows {
        groups.push(row.map_err(|err| db_err("Lecture d'un groupe", err))?);
    }
    attach_schedules(conn, &mut groups)?;
    Ok(groups)
}

/// Read one group with every joined label.
pub fn get_group(conn: &Connection, id: i64) -> Result<GroupRow, String> {
    let mut group = conn
        .query_row(
            &format!("{SELECT_GROUP} WHERE g.id = ?1 AND g.deleted_at IS NULL"),
            params![id],
            map_group,
        )
        .optional()
        .map_err(|err| db_err("Lecture du groupe", err))?
        .ok_or_else(|| "Groupe introuvable".to_string())?;
    attach_schedules(conn, std::slice::from_mut(&mut group))?;
    Ok(group)
}

/// Students currently enrolled in a group.
pub fn group_students(conn: &Connection, group_id: i64) -> Result<Vec<EnrolledStudent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.id, s.id, s.full_name, COALESCE(s.phone, ''),
                    COALESCE(e.start_date, ''), COALESCE(e.status, 'actif')
             FROM enrollments e
             JOIN students s ON s.id = e.student_id
             WHERE e.group_id = ?1 AND s.deleted_at IS NULL AND COALESCE(e.status, 'actif') = 'actif'
             ORDER BY s.full_name COLLATE NOCASE",
        )
        .map_err(|err| db_err("Préparation des inscrits", err))?;

    let rows = stmt
        .query_map(params![group_id], |row| {
            Ok(EnrolledStudent {
                enrollment_id: row.get(0)?,
                student_id: row.get(1)?,
                student_name: row.get(2)?,
                student_phone: row.get(3)?,
                start_date: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .map_err(|err| db_err("Lecture des inscrits", err))?;

    let mut students = Vec::new();
    for row in rows {
        students.push(row.map_err(|err| db_err("Lecture d'un inscrit", err))?);
    }
    Ok(students)
}

/// Money picture for one month (the command passes the current one).
pub fn financial_summary(
    conn: &Connection,
    group: &GroupRow,
    month: i32,
    year: i32,
) -> Result<FinancialSummary, String> {
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM enrollments
             WHERE group_id = ?1 AND COALESCE(status, 'actif') = 'actif'",
            params![group.id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Comptage des inscriptions actives", err))?;

    let collected: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(i.paid_amount_cents), 0)
             FROM invoices i
             JOIN enrollments e ON e.id = i.enrollment_id
             WHERE e.group_id = ?1
               AND COALESCE(e.status, 'actif') = 'actif'
               AND i.period_month = ?2 AND i.period_year = ?3",
            params![group.id, month, year],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Somme des encaissements", err))?;

    Ok(FinancialSummary {
        month,
        year,
        active_enrollments: active as i32,
        monthly_fee_cents: group.monthly_fee_cents,
        theoretical_total_cents: active * group.monthly_fee_cents,
        collected_total_cents: collected,
    })
}

/// The group sheet: group + enrolled students + this month's money.
pub fn group_detail(
    conn: &Connection,
    id: i64,
    month: i32,
    year: i32,
) -> Result<GroupDetail, String> {
    let group = get_group(conn, id)?;
    let students = group_students(conn, id)?;
    let financial_summary = financial_summary(conn, &group, month, year)?;
    Ok(GroupDetail {
        group,
        students,
        financial_summary,
    })
}

/// Active groups the student is **not** already enrolled in.
pub fn available_groups_for_student(
    conn: &Connection,
    student_id: i64,
    level_id: Option<i64>,
) -> Result<Vec<GroupRow>, String> {
    let mut sql = format!(
        "{SELECT_GROUP}
         WHERE g.deleted_at IS NULL AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND COALESCE(g.status, 'actif') = 'actif'
           AND g.id NOT IN (
                SELECT group_id FROM enrollments
                WHERE student_id = ?1 AND COALESCE(status, 'actif') = 'actif')"
    );
    if level_id.is_some() {
        sql.push_str(" AND g.level_id = ?2");
    }
    sql.push(' ');
    sql.push_str(GROUP_ORDER);

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation des groupes disponibles", err))?;

    let rows = match level_id {
        Some(level) => stmt.query_map(params![student_id, level], map_group),
        None => stmt.query_map(params![student_id], map_group),
    }
    .map_err(|err| db_err("Lecture des groupes disponibles", err))?;

    let mut groups = Vec::new();
    for row in rows {
        groups.push(row.map_err(|err| db_err("Lecture d'un groupe", err))?);
    }
    attach_schedules(conn, &mut groups)?;
    Ok(groups)
}

/// Teachers that can be assigned to a group.
///
/// Phase 6 fills the `teachers` table; until then this simply mirrors it (the
/// current seed has none, so the form shows "Aucun enseignant disponible").
pub fn list_teachers(conn: &Connection) -> Result<Vec<TeacherOption>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, full_name FROM teachers
             WHERE deleted_at IS NULL AND COALESCE(status, 'actif') = 'actif' AND (EXISTS (SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=teachers.id AND ty.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)) OR EXISTS (SELECT 1 FROM groups gy WHERE gy.teacher_id=teachers.id AND gy.deleted_at IS NULL AND gy.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)))
             ORDER BY full_name COLLATE NOCASE",
        )
        .map_err(|err| db_err("Préparation de la liste des enseignants", err))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TeacherOption {
                id: row.get(0)?,
                full_name: row.get(1)?,
            })
        })
        .map_err(|err| db_err("Lecture des enseignants", err))?;

    let mut teachers = Vec::new();
    for row in rows {
        teachers.push(row.map_err(|err| db_err("Lecture d'un enseignant", err))?);
    }
    Ok(teachers)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/// Create a group and return its id.
pub fn create_group(conn: &Connection, data: &CreateGroupInput) -> Result<i64, String> {
    let clean = clean_input(conn, data)?;

    conn.execute(
        "INSERT INTO groups
            (subject_id, level_id, branch_id, teacher_id, school_year_id,
             day_of_week, start_time, end_time, room, monthly_fee_cents, capacity, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'actif')",
        params![
            clean.subject_id,
            clean.level_id,
            clean.branch_id,
            clean.teacher_id,
            clean.school_year_id,
            clean.day_of_week,
            clean.start_time,
            clean.end_time,
            clean.room,
            clean.monthly_fee_cents,
            clean.capacity,
        ],
    )
    .map_err(|err| db_err("Création du groupe", err))?;

    let id = conn.last_insert_rowid();
    insert_schedules(conn, id, &clean.schedules)?;
    log_audit(
        conn,
        "CREATE",
        id,
        Some(Value::Object(input_json(&clean)).to_string()),
    )?;
    Ok(id)
}

/// Update a group; the audit row carries a per-field before/after diff.
pub fn update_group(conn: &Connection, id: i64, data: &UpdateGroupInput) -> Result<(), String> {
    let before = snapshot(conn, id)?.ok_or_else(|| "Groupe introuvable".to_string())?;
    let clean = clean_input(conn, data)?;

    // Capacity can never drop below the students already sitting in the room.
    let enrolled = active_enrollment_count(conn, id)
        .map_err(|err| db_err("Comptage des inscriptions actives", err))?;
    if clean.capacity < enrolled {
        return Err(format!(
            "La capacité ne peut pas être inférieure au nombre d'élèves déjà inscrits ({enrolled})"
        ));
    }

    conn.execute(
        "UPDATE groups SET
            subject_id = ?1, level_id = ?2, branch_id = ?3, teacher_id = ?4,
            school_year_id = ?5, day_of_week = ?6, start_time = ?7, end_time = ?8,
            room = ?9, monthly_fee_cents = ?10, capacity = ?11
         WHERE id = ?12",
        params![
            clean.subject_id,
            clean.level_id,
            clean.branch_id,
            clean.teacher_id,
            clean.school_year_id,
            clean.day_of_week,
            clean.start_time,
            clean.end_time,
            clean.room,
            clean.monthly_fee_cents,
            clean.capacity,
            id,
        ],
    )
    .map_err(|err| db_err("Mise à jour du groupe", err))?;

    conn.execute(
        "DELETE FROM group_schedules WHERE group_id = ?1",
        params![id],
    )
    .map_err(|err| db_err("Suppression des anciens horaires", err))?;
    insert_schedules(conn, id, &clean.schedules)?;

    let changes = diff(&before, &input_json(&clean));
    if changes.is_empty() {
        return Ok(());
    }
    log_audit(conn, "UPDATE", id, Some(Value::Object(changes).to_string()))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_get_groups(
    db: State<'_, Db>,
    school_year_id: Option<i64>,
    status: Option<String>,
) -> Result<Vec<GroupRow>, String> {
    let conn = db.conn();
    list_groups(&conn, school_year_id, status.as_deref())
}

#[tauri::command]
pub fn cmd_get_group_detail(db: State<'_, Db>, id: i64) -> Result<GroupDetail, String> {
    let conn = db.conn();
    let today = chrono::Local::now();
    group_detail(&conn, id, today.month() as i32, today.year())
}

#[tauri::command]
pub fn cmd_create_group(db: State<'_, Db>, data: CreateGroupInput) -> Result<i64, String> {
    let conn = db.conn();
    create_group(&conn, &data)
}

#[tauri::command]
pub fn cmd_update_group(db: State<'_, Db>, id: i64, data: UpdateGroupInput) -> Result<(), String> {
    let conn = db.conn();
    update_group(&conn, id, &data)
}

/// Active teachers for the group form.
///
/// Phase 6 renamed this command (`cmd_get_teachers` now returns the full
/// `TeacherRow` list used by the teachers page).
#[tauri::command]
pub fn cmd_get_teacher_options(db: State<'_, Db>) -> Result<Vec<TeacherOption>, String> {
    let conn = db.conn();
    list_teachers(&conn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::enrollments::{end_enrollment, enroll_student};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    pub(crate) fn sample(subject_id: i64, level_id: i64) -> CreateGroupInput {
        CreateGroupInput {
            subject_id,
            level_id,
            branch_id: None,
            teacher_id: None,
            school_year_id: 1,
            day_of_week: "Lundi".to_string(),
            start_time: "16:00".to_string(),
            end_time: "18:00".to_string(),
            room: Some("Salle 3".to_string()),
            monthly_fee_cents: 30_000,
            capacity: 10,
            schedules: None,
        }
    }

    fn new_student(conn: &Connection, name: &str, phone: &str) -> i64 {
        conn.execute(
            "INSERT INTO students (full_name, phone, status) VALUES (?1, ?2, 'actif')",
            params![name, phone],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn create_group_persists_joins_and_audit() {
        let conn = test_conn();
        let id = create_group(&conn, &sample(1, 10)).unwrap();

        let group = get_group(&conn, id).unwrap();
        assert_eq!(group.subject_name, "Mathématiques");
        assert_eq!(group.level_name, "Tronc Commun");
        assert_eq!(group.day_of_week, "Lundi");
        assert_eq!(group.monthly_fee_cents, 30_000);
        assert_eq!(group.enrolled_count, 0);
        assert_eq!(group.status, "actif");

        let (action, entity_type, entity_id, details): (String, String, i64, String) = conn
            .query_row(
                "SELECT action, entity_type, entity_id, details FROM audit_log
                 WHERE entity_type = 'group'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(entity_id, id);
        assert_eq!(action, "CREATE");
        assert_eq!(entity_type, "group");
        assert!(details.contains("\"capacity\":10"));
    }

    #[test]
    fn validation_rejects_bad_groups() {
        let conn = test_conn();

        let mut reversed = sample(1, 10);
        reversed.end_time = "15:00".to_string();
        assert_eq!(
            create_group(&conn, &reversed).unwrap_err(),
            "L'heure de fin doit être après l'heure de début (Lundi)"
        );

        let mut free = sample(1, 10);
        free.monthly_fee_cents = 0;
        assert_eq!(
            create_group(&conn, &free).unwrap_err(),
            "Le tarif doit être supérieur à 0"
        );

        let mut empty = sample(1, 10);
        empty.capacity = 0;
        assert_eq!(
            create_group(&conn, &empty).unwrap_err(),
            "La capacité doit être au moins 1"
        );

        let mut bad_day = sample(1, 10);
        bad_day.day_of_week = "Lunedi".to_string();
        assert_eq!(
            create_group(&conn, &bad_day).unwrap_err(),
            "Jour de la semaine invalide : Lunedi"
        );

        let mut bad_time = sample(1, 10);
        bad_time.start_time = "4pm".to_string();
        assert_eq!(
            create_group(&conn, &bad_time).unwrap_err(),
            "Heure de début invalide (format attendu HH:MM)"
        );

        let mut missing_subject = sample(999, 10);
        missing_subject.subject_id = 999;
        assert_eq!(
            create_group(&conn, &missing_subject).unwrap_err(),
            "Matière introuvable"
        );

        // Branch 1 belongs to Tronc Commun (level 10), not to 2ème Bac (12).
        let mut wrong_branch = sample(1, 12);
        wrong_branch.branch_id = Some(1);
        assert_eq!(
            create_group(&conn, &wrong_branch).unwrap_err(),
            "La branche ne correspond pas au niveau sélectionné"
        );
    }

    #[test]
    fn list_filters_by_school_year_and_status_and_sorts_by_day() {
        let conn = test_conn();

        let mut monday = sample(1, 10);
        monday.day_of_week = "Mercredi".to_string();
        create_group(&conn, &monday).unwrap();

        let mut early = sample(2, 10);
        early.day_of_week = "Lundi".to_string();
        create_group(&conn, &early).unwrap();

        let all = list_groups(&conn, None, None).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].day_of_week, "Lundi", "Lundi must come first");
        assert_eq!(all[1].day_of_week, "Mercredi");

        assert_eq!(list_groups(&conn, Some(1), None).unwrap().len(), 2);
        assert_eq!(list_groups(&conn, Some(99), None).unwrap().len(), 0);
        assert_eq!(list_groups(&conn, None, Some("actif")).unwrap().len(), 2);
        assert_eq!(list_groups(&conn, None, Some("archivé")).unwrap().len(), 0);
    }

    #[test]
    fn update_group_writes_a_diff_and_guards_capacity() {
        let conn = test_conn();
        let group_id = create_group(&conn, &sample(1, 10)).unwrap();
        let first = new_student(&conn, "Yassine El Amrani", "0612345678");
        let second = new_student(&conn, "Salma Benjelloun", "0723456789");
        enroll_student(&conn, first, group_id, "2026-01-31").unwrap();
        enroll_student(&conn, second, group_id, "2026-01-31").unwrap();

        let mut changed = sample(1, 10);
        changed.room = Some("Salle 7".to_string());
        changed.monthly_fee_cents = 35_000;
        update_group(&conn, group_id, &changed).unwrap();

        let group = get_group(&conn, group_id).unwrap();
        assert_eq!(group.room.as_deref(), Some("Salle 7"));
        assert_eq!(group.monthly_fee_cents, 35_000);

        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE entity_type='group' AND action='UPDATE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("\"room\":{\"from\":\"Salle 3\",\"to\":\"Salle 7\"}"));
        assert!(details.contains("\"monthly_fee_cents\":{\"from\":30000,\"to\":35000}"));
        assert!(
            !details.contains("day_of_week"),
            "unchanged fields stay out of the diff"
        );

        // Two students are seated, so a capacity of 1 is refused...
        let mut too_small = sample(1, 10);
        too_small.capacity = 1;
        assert_eq!(
            update_group(&conn, group_id, &too_small).unwrap_err(),
            "La capacité ne peut pas être inférieure au nombre d'élèves déjà inscrits (2)"
        );

        // ...while 2 is accepted, and shrinking to 0 hits the generic rule first.
        let mut exact = sample(1, 10);
        exact.capacity = 2;
        update_group(&conn, group_id, &exact).unwrap();
        assert_eq!(get_group(&conn, group_id).unwrap().capacity, 2);

        let mut zero = sample(1, 10);
        zero.capacity = 0;
        assert_eq!(
            update_group(&conn, group_id, &zero).unwrap_err(),
            "La capacité doit être au moins 1"
        );
    }

    #[test]
    fn detail_reports_students_and_theoretical_vs_collected() {
        let conn = test_conn();
        let group_id = create_group(&conn, &sample(1, 10)).unwrap();
        let first = new_student(&conn, "Salma Benjelloun", "0723456789");
        let second = new_student(&conn, "Omar Tazi", "0698765432");

        let e1 = enroll_student(&conn, first, group_id, "2026-03-31").unwrap();
        enroll_student(&conn, second, group_id, "2026-03-31").unwrap();

        // Nothing paid yet.
        let detail = group_detail(&conn, group_id, 3, 2026).unwrap();
        assert_eq!(detail.group.enrolled_count, 2);
        assert_eq!(detail.students.len(), 2);
        assert_eq!(detail.financial_summary.active_enrollments, 2);
        assert_eq!(detail.financial_summary.theoretical_total_cents, 60_000);
        assert_eq!(detail.financial_summary.collected_total_cents, 0);

        // Pretend 300 DH were collected on the first invoice.
        conn.execute(
            "UPDATE invoices SET paid_amount_cents = 30000, status = 'payé'
             WHERE enrollment_id = ?1",
            params![e1],
        )
        .unwrap();

        let detail = group_detail(&conn, group_id, 3, 2026).unwrap();
        assert_eq!(detail.financial_summary.collected_total_cents, 30_000);
        assert_eq!(
            detail.financial_summary.theoretical_total_cents
                - detail.financial_summary.collected_total_cents,
            30_000
        );

        // An ended enrollment leaves both sides of the summary.
        end_enrollment(&conn, e1).unwrap();
        let detail = group_detail(&conn, group_id, 3, 2026).unwrap();
        assert_eq!(detail.financial_summary.active_enrollments, 1);
        assert_eq!(detail.financial_summary.theoretical_total_cents, 30_000);
        assert_eq!(detail.financial_summary.collected_total_cents, 0);
    }

    #[test]
    fn available_groups_exclude_enrolled_and_optional_level_filter() {
        let conn = test_conn();
        let tco = create_group(&conn, &sample(1, 10)).unwrap();
        let mut maths_2bac = sample(1, 12);
        maths_2bac.day_of_week = "Mardi".to_string();
        let two_bac = create_group(&conn, &maths_2bac).unwrap();

        let student = new_student(&conn, "Nadia Chraibi", "0655443322");

        let available = available_groups_for_student(&conn, student, None).unwrap();
        assert_eq!(available.len(), 2);

        enroll_student(&conn, student, tco, "2026-01-10").unwrap();
        let available = available_groups_for_student(&conn, student, None).unwrap();
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].id, two_bac);

        let only_lycee = available_groups_for_student(&conn, student, Some(12)).unwrap();
        assert_eq!(only_lycee.len(), 1);
        assert_eq!(only_lycee[0].id, two_bac);

        let only_primaire = available_groups_for_student(&conn, student, Some(1)).unwrap();
        assert!(only_primaire.is_empty());
    }

    #[test]
    fn teachers_list_is_empty_until_phase_6() {
        let conn = test_conn();
        assert!(list_teachers(&conn).unwrap().is_empty());

        conn.execute(
            "INSERT INTO teachers (full_name, phone, status) VALUES ('Hicham Alaoui', '0611223344', 'actif')",
            [],
        )
        .unwrap();
        let teachers = list_teachers(&conn).unwrap();
        assert_eq!(teachers.len(), 1);
        assert_eq!(teachers[0].full_name, "Hicham Alaoui");
    }
}
