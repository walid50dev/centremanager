//! Multi-day group scheduling and the weekly timetable (Phase 13).
//!
//! A group is no longer one slot: `group_schedules` holds one row per weekday,
//! each with its own hours, and the timetable is a flat list of those rows joined
//! with the labels a grid needs (subject, level, teacher, room, capacity).
//!
//! The legacy `groups.day_of_week/start_time/end_time` columns stay — V1 never
//! drops a column — and [`sync_legacy_columns`] keeps them pointing at the first
//! schedule so any older read path still shows a plausible slot.
//!
//! | Command | Effect |
//! | --- | --- |
//! | [`cmd_set_group_schedules`] | replace every slot of one group |
//! | [`cmd_get_group_schedules`] | the slots of one group, week order |
//! | [`cmd_get_timetable`] | every active slot, filtered, for the grid |
//! | [`cmd_get_timetable_rooms`] | the rooms that have classes, for the filter |

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::db_err;
use crate::db::Db;
use crate::models::GroupSchedule;

/// Canonical weekday names, in school-week order (shared with `groups`).
pub const DAY_NAMES: [&str; 7] = [
    "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

/// SQL `CASE` that orders any day column in school-week order.
pub const DAY_ORDER_SQL: &str = "CASE {column}
    WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
    WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6
    WHEN 'Dimanche' THEN 7 ELSE 99 END";

/// Two-letter-ish French abbreviations used by `schedule_text`.
fn short_day(day: &str) -> &str {
    match day {
        "Lundi" => "Lun",
        "Mardi" => "Mar",
        "Mercredi" => "Mer",
        "Jeudi" => "Jeu",
        "Vendredi" => "Ven",
        "Samedi" => "Sam",
        "Dimanche" => "Dim",
        other => other,
    }
}

/// One slot coming from the form.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ScheduleInput {
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
}

/// A slot coming from the timetable filters.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TimetableFilters {
    pub level_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub teacher_id: Option<i64>,
    pub room: Option<String>,
}

/// One block of the weekly grid: a schedule row plus everything needed to draw it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimetableEntry {
    pub group_id: i64,
    pub subject_name: String,
    pub level_name: String,
    pub branch_name: Option<String>,
    pub teacher_name: Option<String>,
    pub room: Option<String>,
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
    pub enrolled_count: i64,
    pub capacity: i64,
    pub monthly_fee_cents: i64,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// `HH:MM` → minutes since midnight.
fn minutes_of_day(value: &str) -> Option<i64> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let hours: i64 = hours.parse().ok()?;
    let minutes: i64 = minutes.parse().ok()?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(hours * 60 + minutes)
}

/// Canonical weekday name (`lundi` → `Lundi`), or `None` when unknown.
fn normalise_day(day: &str) -> Option<&'static str> {
    let wanted = day.trim().to_lowercase();
    DAY_NAMES
        .iter()
        .find(|name| name.to_lowercase() == wanted)
        .copied()
}

/// Clean, validated, de-duplicated slots in week order.
///
/// Allows an empty list, but rejects an unknown weekday, a reversed or empty time range, and two slots on the same day — the
/// last one because `UNIQUE(group_id, day_of_week)` would refuse it anyway, and a
/// raw SQLite error would be a poor message.
pub fn clean_schedules(schedules: &[ScheduleInput]) -> Result<Vec<GroupSchedule>, String> {
    let mut cleaned: Vec<GroupSchedule> = Vec::with_capacity(schedules.len());
    for input in schedules {
        let day = normalise_day(&input.day_of_week)
            .ok_or_else(|| format!("Jour de la semaine invalide : {}", input.day_of_week))?;
        let start = input.start_time.trim();
        let end = input.end_time.trim();
        let start_minutes = minutes_of_day(start)
            .ok_or_else(|| "Heure de début invalide (format attendu HH:MM)".to_string())?;
        let end_minutes = minutes_of_day(end)
            .ok_or_else(|| "Heure de fin invalide (format attendu HH:MM)".to_string())?;
        if end_minutes <= start_minutes {
            return Err(format!(
                "L'heure de fin doit être après l'heure de début ({day})"
            ));
        }
        if let Some(existing) = cleaned.iter().find(|slot| slot.day_of_week == day) {
            return Err(format!(
                "Le jour {day} est déjà programmé ({}–{})",
                existing.start_time, existing.end_time
            ));
        }
        cleaned.push(GroupSchedule {
            id: 0,
            day_of_week: day.to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
        });
    }

    cleaned.sort_by_key(|slot| {
        (
            DAY_NAMES
                .iter()
                .position(|day| *day == slot.day_of_week)
                .unwrap_or(9),
            slot.start_time.clone(),
        )
    });
    Ok(cleaned)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// `"16:00"` → `"16"`, `"16:30"` → `"16:30"` — the compact form used in summaries.
fn short_time(value: &str) -> String {
    match value.strip_suffix(":00") {
        Some(hours) => hours.to_string(),
        None => value.to_string(),
    }
}

/// `"Lun 16-18, Mer 14-16"` — untranslated summary stored on every `GroupRow`.
pub fn schedule_text(schedules: &[GroupSchedule]) -> String {
    schedules
        .iter()
        .map(|slot| {
            format!(
                "{} {}-{}",
                short_day(&slot.day_of_week),
                short_time(&slot.start_time),
                short_time(&slot.end_time)
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The slots of one group, in week order.
pub fn group_schedules(conn: &Connection, group_id: i64) -> Result<Vec<GroupSchedule>, String> {
    let sql = format!(
        "SELECT id, day_of_week, start_time, end_time
         FROM group_schedules WHERE group_id = ?1
         ORDER BY {}, start_time",
        DAY_ORDER_SQL.replace("{column}", "day_of_week")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation des horaires", err))?;
    let rows = stmt
        .query_map(params![group_id], |row| {
            Ok(GroupSchedule {
                id: row.get(0)?,
                day_of_week: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
            })
        })
        .map_err(|err| db_err("Lecture des horaires", err))?;

    let mut schedules = Vec::new();
    for row in rows {
        schedules.push(row.map_err(|err| db_err("Lecture d'un horaire", err))?);
    }
    Ok(schedules)
}

/// Attach `schedules` + `schedule_text` to a list of groups in **one** query.
///
/// The group list is small (a centre rarely has more than a hundred), so the
/// labels are read in a single round trip and matched in memory instead of
/// issuing one query per card.
pub fn attach_schedules(
    conn: &Connection,
    groups: &mut [crate::models::GroupRow],
) -> Result<(), String> {
    if groups.is_empty() {
        return Ok(());
    }

    let sql = format!(
        "SELECT group_id, id, day_of_week, start_time, end_time
         FROM group_schedules
         ORDER BY {}, start_time",
        DAY_ORDER_SQL.replace("{column}", "day_of_week")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation des horaires", err))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                GroupSchedule {
                    id: row.get(1)?,
                    day_of_week: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                },
            ))
        })
        .map_err(|err| db_err("Lecture des horaires", err))?;

    let mut by_group: std::collections::HashMap<i64, Vec<GroupSchedule>> =
        std::collections::HashMap::new();
    for row in rows {
        let (group_id, schedule) = row.map_err(|err| db_err("Lecture d'un horaire", err))?;
        by_group.entry(group_id).or_default().push(schedule);
    }

    for group in groups.iter_mut() {
        let schedules = by_group.remove(&group.id).unwrap_or_default();
        group.schedule_text = schedule_text(&schedules);
        group.schedules = schedules;
    }
    Ok(())
}

/// Every active slot, joined with the labels the grid prints, filtered.
pub fn timetable(
    conn: &Connection,
    filters: Option<&TimetableFilters>,
) -> Result<Vec<TimetableEntry>, String> {
    let mut clauses: Vec<String> = vec!["g.deleted_at IS NULL".to_string(), "g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)".to_string(), "COALESCE(g.status, 'actif') = 'actif'".to_string()];
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(filters) = filters {
        if let Some(level_id) = filters.level_id {
            clauses.push("g.level_id = ?".to_string());
            values.push(Box::new(level_id));
        }
        if let Some(subject_id) = filters.subject_id {
            clauses.push("g.subject_id = ?".to_string());
            values.push(Box::new(subject_id));
        }
        if let Some(teacher_id) = filters.teacher_id {
            clauses.push("g.teacher_id = ?".to_string());
            values.push(Box::new(teacher_id));
        }
        if let Some(room) = filters
            .room
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push("g.room = ?".to_string());
            values.push(Box::new(room.to_string()));
        }
    }

    let sql = format!(
        "SELECT g.id, COALESCE(s.name, '—'), COALESCE(l.name, '—'), b.name, t.full_name,
                g.room, gs.day_of_week, gs.start_time, gs.end_time,
                (SELECT COUNT(*) FROM enrollments e
                  WHERE e.group_id = g.id AND COALESCE(e.status, 'actif') = 'actif' AND EXISTS (SELECT 1 FROM students st WHERE st.id=e.student_id AND st.deleted_at IS NULL)),
                g.capacity, g.monthly_fee_cents
         FROM group_schedules gs
         JOIN groups g ON g.id = gs.group_id
         LEFT JOIN subjects s ON s.id = g.subject_id
         LEFT JOIN levels l ON l.id = g.level_id
         LEFT JOIN branches b ON b.id = g.branch_id
         LEFT JOIN teachers t ON t.id = g.teacher_id
         WHERE {}
         ORDER BY {}, gs.start_time, g.id",
        clauses.join(" AND "),
        DAY_ORDER_SQL.replace("{column}", "gs.day_of_week")
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation de l'emploi du temps", err))?;
    let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value.as_ref()).collect();
    let rows = stmt
        .query_map(refs.as_slice(), |row| {
            Ok(TimetableEntry {
                group_id: row.get(0)?,
                subject_name: row.get(1)?,
                level_name: row.get(2)?,
                branch_name: row.get(3)?,
                teacher_name: row.get(4)?,
                room: row.get(5)?,
                day_of_week: row.get(6)?,
                start_time: row.get(7)?,
                end_time: row.get(8)?,
                enrolled_count: row.get(9)?,
                capacity: row.get(10)?,
                monthly_fee_cents: row.get(11)?,
            })
        })
        .map_err(|err| db_err("Lecture de l'emploi du temps", err))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|err| db_err("Lecture d'un cours", err))?);
    }
    Ok(entries)
}

/// Rooms that actually host a class, for the filter dropdown.
pub fn timetable_rooms(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT room FROM groups
             WHERE deleted_at IS NULL AND school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND room IS NOT NULL AND TRIM(room) <> ''
               AND COALESCE(status, 'actif') = 'actif'
             ORDER BY room COLLATE NOCASE",
        )
        .map_err(|err| db_err("Préparation des salles", err))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| db_err("Lecture des salles", err))?;

    let mut rooms = Vec::new();
    for row in rows {
        rooms.push(row.map_err(|err| db_err("Lecture d'une salle", err))?);
    }
    Ok(rooms)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/// Point the legacy `groups` columns at the first schedule.
///
/// They are no longer written by the form, but nothing in V1 may read `NULL`
/// there: receipts, exports and older queries still look at them.
fn sync_legacy_columns(conn: &Connection, group_id: i64) -> Result<(), String> {
    let first = group_schedules(conn, group_id)?.into_iter().next();
    match first {
        Some(slot) => conn
            .execute(
                "UPDATE groups SET day_of_week = ?1, start_time = ?2, end_time = ?3 WHERE id = ?4",
                params![slot.day_of_week, slot.start_time, slot.end_time, group_id],
            )
            .map(|_| ())
            .map_err(|err| db_err("Synchronisation des colonnes historiques", err)),
        None => conn
            .execute(
                "UPDATE groups SET day_of_week = NULL, start_time = NULL, end_time = NULL WHERE id = ?1",
                params![group_id],
            )
            .map(|_| ())
            .map_err(|err| db_err("Synchronisation des colonnes historiques", err)),
    }
}

/// Replace every slot of a group. Returns the stored rows in week order.
pub fn set_group_schedules(
    conn: &Connection,
    group_id: i64,
    schedules: &[ScheduleInput],
) -> Result<Vec<GroupSchedule>, String> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM groups WHERE id = ?1",
            params![group_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture du groupe", err))?;
    if exists.is_none() {
        return Err("Groupe introuvable".to_string());
    }

    let clean = clean_schedules(schedules)?;

    conn.execute(
        "DELETE FROM group_schedules WHERE group_id = ?1",
        params![group_id],
    )
    .map_err(|err| db_err("Suppression des anciens horaires", err))?;

    for slot in &clean {
        conn.execute(
            "INSERT INTO group_schedules (group_id, day_of_week, start_time, end_time)
             VALUES (?1, ?2, ?3, ?4)",
            params![group_id, slot.day_of_week, slot.start_time, slot.end_time],
        )
        .map_err(|err| db_err("Enregistrement d'un horaire", err))?;
    }

    sync_legacy_columns(conn, group_id)?;
    group_schedules(conn, group_id)
}

/// Slots read from a payload, falling back to the legacy single slot.
///
/// The form always sends `schedules`; older callers (tests, the demo seeder,
/// anything scripted) still send `day_of_week` + `start_time` + `end_time`.
pub fn schedules_from_payload(
    schedules: Option<&[ScheduleInput]>,
    day_of_week: &str,
    start_time: &str,
    end_time: &str,
) -> Vec<ScheduleInput> {
    match schedules {
        Some(list) => list.to_vec(),
        None if day_of_week.trim().is_empty() && start_time.trim().is_empty() && end_time.trim().is_empty() => vec![],
        None => vec![ScheduleInput {
            day_of_week: day_of_week.to_string(),
            start_time: start_time.to_string(),
            end_time: end_time.to_string(),
        }],
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_set_group_schedules(
    db: State<'_, Db>,
    group_id: i64,
    schedules: Vec<ScheduleInput>,
) -> Result<Vec<GroupSchedule>, String> {
    let conn = db.conn();
    set_group_schedules(&conn, group_id, &schedules)
}

#[tauri::command]
pub fn cmd_get_group_schedules(
    db: State<'_, Db>,
    group_id: i64,
) -> Result<Vec<GroupSchedule>, String> {
    let conn = db.conn();
    group_schedules(&conn, group_id)
}

#[tauri::command]
pub fn cmd_get_timetable(
    db: State<'_, Db>,
    filters: Option<TimetableFilters>,
) -> Result<Vec<TimetableEntry>, String> {
    let conn = db.conn();
    timetable(&conn, filters.as_ref())
}

#[tauri::command]
pub fn cmd_get_timetable_rooms(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.conn();
    timetable_rooms(&conn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::groups::{create_group, get_group, update_group, CreateGroupInput};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn group_input(day: &str, start: &str, end: &str) -> CreateGroupInput {
        CreateGroupInput {
            subject_id: 1,
            level_id: 10,
            branch_id: None,
            teacher_id: None,
            school_year_id: 1,
            day_of_week: day.to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
            room: Some("Salle 3".to_string()),
            monthly_fee_cents: 30_000,
            capacity: 10,
            schedules: None,
        }
    }

    fn slots(entries: &[(&str, &str, &str)]) -> Vec<ScheduleInput> {
        entries
            .iter()
            .map(|(day, start, end)| ScheduleInput {
                day_of_week: (*day).to_string(),
                start_time: (*start).to_string(),
                end_time: (*end).to_string(),
            })
            .collect()
    }

    #[test]
    fn unscheduled_group_can_be_created_scheduled_and_cleared() {
        let conn = test_conn();
        let mut input = group_input("Lundi", "16:00", "18:00");
        input.schedules = Some(vec![]); // Explicitly empty overrides the legacy triple.
        input.room = None;
        let id = create_group(&conn, &input).unwrap();
        let group = get_group(&conn, id).unwrap();
        assert!(group.schedules.is_empty());
        assert_eq!(group.day_of_week, "");
        assert!(!timetable(&conn, None).unwrap().iter().any(|entry| entry.group_id == id));

        set_group_schedules(&conn, id, &slots(&[("Lundi", "04:00", "05:00")])).unwrap();
        assert!(timetable(&conn, None).unwrap().iter().any(|entry| entry.group_id == id));
        update_group(&conn, id, &input).unwrap();
        let group = get_group(&conn, id).unwrap();
        assert!(group.schedules.is_empty());
        assert_eq!(group.day_of_week, "");
        assert!(!timetable(&conn, None).unwrap().iter().any(|entry| entry.group_id == id));

        set_group_schedules(&conn, id, &slots(&[("Mardi", "10:00", "12:00")])).unwrap();
        assert!(set_group_schedules(&conn, id, &[]).unwrap().is_empty());
        assert_eq!(get_group(&conn, id).unwrap().day_of_week, "");
        let mut no_legacy = group_input("", "", "");
        no_legacy.schedules = None;
        let without_triple = create_group(&conn, &no_legacy).unwrap();
        assert!(get_group(&conn, without_triple).unwrap().schedules.is_empty());
        no_legacy.start_time = "04:00".to_string();
        assert!(create_group(&conn, &no_legacy).is_err());
        let legacy = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();
        assert_eq!(get_group(&conn, legacy).unwrap().schedules.len(), 1);
    }

    #[test]
    fn a_group_can_meet_three_times_a_week() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();

        let stored = set_group_schedules(
            &conn,
            id,
            &slots(&[
                ("Vendredi", "16:00", "18:00"),
                ("Lundi", "16:00", "18:00"),
                ("Mercredi", "14:00", "16:00"),
            ]),
        )
        .unwrap();

        // Week order, whatever order they were sent in.
        assert_eq!(
            stored
                .iter()
                .map(|slot| slot.day_of_week.as_str())
                .collect::<Vec<_>>(),
            vec!["Lundi", "Mercredi", "Vendredi"]
        );
        assert_eq!(stored[1].start_time, "14:00");

        // The legacy columns follow the first slot.
        let group = get_group(&conn, id).unwrap();
        assert_eq!(group.day_of_week, "Lundi");
        assert_eq!(group.schedules.len(), 3);
        assert_eq!(group.schedule_text, "Lun 16-18, Mer 14-16, Ven 16-18");
    }

    #[test]
    fn schedules_are_validated() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();

        assert_eq!(
            set_group_schedules(&conn, id, &slots(&[("Lunedi", "16:00", "18:00")])).unwrap_err(),
            "Jour de la semaine invalide : Lunedi"
        );
        assert_eq!(
            set_group_schedules(&conn, id, &slots(&[("Mardi", "18:00", "16:00")])).unwrap_err(),
            "L'heure de fin doit être après l'heure de début (Mardi)"
        );
        assert_eq!(
            set_group_schedules(
                &conn,
                id,
                &slots(&[("Jeudi", "10:00", "12:00"), ("jeudi", "14:00", "16:00")])
            )
            .unwrap_err(),
            "Le jour Jeudi est déjà programmé (10:00–12:00)"
        );

        // Nothing was written by the failed attempts.
        assert_eq!(group_schedules(&conn, id).unwrap().len(), 1);
    }

    #[test]
    fn replacing_schedules_keeps_one_row_per_day() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();
        set_group_schedules(
            &conn,
            id,
            &slots(&[("Lundi", "09:00", "11:00"), ("Samedi", "10:00", "12:00")]),
        )
        .unwrap();
        set_group_schedules(&conn, id, &slots(&[("Mardi", "08:00", "10:00")])).unwrap();

        let stored = group_schedules(&conn, id).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].day_of_week, "Mardi");

        // …and the legacy columns followed.
        let group = get_group(&conn, id).unwrap();
        assert_eq!(group.day_of_week, "Mardi");
        assert_eq!(group.start_time, "08:00");
    }

    #[test]
    fn creating_a_group_can_store_several_days_at_once() {
        let conn = test_conn();
        let mut input = group_input("Lundi", "16:00", "18:00");
        input.schedules = Some(slots(&[
            ("Lundi", "16:00", "18:00"),
            ("Jeudi", "16:00", "18:00"),
        ]));
        let id = create_group(&conn, &input).unwrap();

        let group = get_group(&conn, id).unwrap();
        assert_eq!(group.schedules.len(), 2);
        assert_eq!(group.schedule_text, "Lun 16-18, Jeu 16-18");
        assert_eq!(group.day_of_week, "Lundi");
    }

    #[test]
    fn updating_a_group_replaces_its_week() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();
        let mut input = group_input("Lundi", "16:00", "18:00");
        input.schedules = Some(slots(&[("Samedi", "09:00", "11:00")]));

        update_group(&conn, id, &input).unwrap();
        let stored = group_schedules(&conn, id).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].day_of_week, "Samedi");
        assert_eq!(get_group(&conn, id).unwrap().start_time, "09:00");
    }

    #[test]
    fn the_timetable_lists_every_active_slot_and_filters() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO teachers (full_name, phone, status) VALUES ('Karim Alaoui', '0661000001', 'actif')",
            [],
        )
        .unwrap();
        let teacher_id = conn.last_insert_rowid();

        let mut first = group_input("Lundi", "16:00", "18:00");
        first.schedules = Some(slots(&[
            ("Lundi", "16:00", "18:00"),
            ("Mercredi", "14:00", "16:00"),
        ]));
        first.teacher_id = Some(teacher_id);
        let first_id = create_group(&conn, &first).unwrap();

        let mut second = group_input("Mardi", "08:00", "10:00");
        second.subject_id = 2;
        second.level_id = 11;
        second.room = Some("Salle 7".to_string());
        let second_id = create_group(&conn, &second).unwrap();

        let all = timetable(&conn, None).unwrap();
        assert_eq!(all.len(), 3);
        // Monday 16:00, Tuesday 08:00, Wednesday 14:00.
        assert_eq!(all[0].day_of_week, "Lundi");
        assert_eq!(all[1].day_of_week, "Mardi");
        assert_eq!(all[2].day_of_week, "Mercredi");
        assert_eq!(all[0].subject_name, "Mathématiques");
        assert_eq!(all[0].capacity, 10);
        assert_eq!(all[0].teacher_name.as_deref(), Some("Karim Alaoui"));
        assert_eq!(all[1].room.as_deref(), Some("Salle 7"));

        // Filters are ANDed.
        let by_subject = timetable(
            &conn,
            Some(&TimetableFilters {
                subject_id: Some(2),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(by_subject.len(), 1);
        assert_eq!(by_subject[0].group_id, second_id);

        let by_room = timetable(
            &conn,
            Some(&TimetableFilters {
                room: Some("Salle 3".to_string()),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(by_room.len(), 2);
        assert!(by_room.iter().all(|entry| entry.group_id == first_id));

        let by_level = timetable(
            &conn,
            Some(&TimetableFilters {
                level_id: Some(11),
                subject_id: Some(2),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(by_level.len(), 1);

        let impossible = timetable(
            &conn,
            Some(&TimetableFilters {
                level_id: Some(11),
                teacher_id: Some(teacher_id),
                ..Default::default()
            }),
        )
        .unwrap();
        assert!(impossible.is_empty(), "filters must combine with AND");
    }

    #[test]
    fn inactive_groups_are_not_on_the_timetable() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();
        conn.execute(
            "UPDATE groups SET status = 'inactif' WHERE id = ?1",
            params![id],
        )
        .unwrap();
        assert!(timetable(&conn, None).unwrap().is_empty());
        assert!(timetable_rooms(&conn).unwrap().is_empty());
    }

    #[test]
    fn rooms_come_from_active_groups_only() {
        let conn = test_conn();
        let mut first = group_input("Lundi", "16:00", "18:00");
        first.room = Some("Salle 3".to_string());
        create_group(&conn, &first).unwrap();

        let mut second = group_input("Mardi", "08:00", "10:00");
        second.room = Some("Salle 7".to_string());
        let second_id = create_group(&conn, &second).unwrap();

        let mut no_room = group_input("Mercredi", "08:00", "10:00");
        no_room.room = None;
        create_group(&conn, &no_room).unwrap();

        assert_eq!(
            timetable_rooms(&conn).unwrap(),
            vec!["Salle 3".to_string(), "Salle 7".to_string()]
        );

        conn.execute(
            "UPDATE groups SET status = 'inactif' WHERE id = ?1",
            params![second_id],
        )
        .unwrap();
        assert_eq!(timetable_rooms(&conn).unwrap(), vec!["Salle 3".to_string()]);
    }

    #[test]
    fn deleting_a_group_cascades_to_its_schedules() {
        let conn = test_conn();
        let id = create_group(&conn, &group_input("Lundi", "16:00", "18:00")).unwrap();
        assert_eq!(group_schedules(&conn, id).unwrap().len(), 1);
        conn.execute("DELETE FROM groups WHERE id = ?1", params![id])
            .unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM group_schedules", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn a_legacy_payload_still_creates_one_slot() {
        let payload = schedules_from_payload(None, "Lundi", "16:00", "18:00");
        assert_eq!(
            payload,
            vec![ScheduleInput {
                day_of_week: "Lundi".to_string(),
                start_time: "16:00".to_string(),
                end_time: "18:00".to_string(),
            }]
        );
    }
}
