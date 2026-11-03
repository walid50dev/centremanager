//! Advisory schedule conflicts; saving a group remains independent of this check.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use super::db_err;

#[derive(Debug, Deserialize)]
pub struct ConflictScheduleInput {
    #[serde(alias = "day_of_week")]
    pub day: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduleConflict {
    pub conflict_type: String,
    pub group_name: String,
    pub day: String,
    pub start_time: String,
    pub end_time: String,
    pub teacher_name: String,
    pub room: String,
}

fn minutes(value: &str) -> Option<u32> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let hours: u32 = hours.parse().ok()?;
    let minutes: u32 = minutes.parse().ok()?;
    if hours > 23 || minutes > 59 { return None; }
    Some(hours * 60 + minutes)
}

pub fn check_schedule_conflicts(
    conn: &Connection, group_id: Option<i64>, teacher_id: Option<i64>, room: &str,
    school_year_id: i64, schedules: &[ConflictScheduleInput],
) -> Result<Vec<ScheduleConflict>, String> {
    let wanted_room = room.trim().to_lowercase();
    if wanted_room.is_empty() && teacher_id.is_none() { return Ok(Vec::new()); }
    // Legacy rows without any group_schedules still participate, but never
    // duplicate a group that already has a multi-day schedule.
    let sql = "SELECT g.id, g.teacher_id, COALESCE(g.room, ''), COALESCE(t.full_name, ''),
                      COALESCE(s.name, ''), COALESCE(l.name, ''), slots.day, slots.start_time, slots.end_time
        FROM groups g
        LEFT JOIN teachers t ON t.id = g.teacher_id
        LEFT JOIN subjects s ON s.id = g.subject_id
        LEFT JOIN levels l ON l.id = g.level_id
        JOIN (
          SELECT group_id, day_of_week AS day, start_time, end_time FROM group_schedules
          UNION ALL
          SELECT id, day_of_week, start_time, end_time FROM groups legacy
          WHERE NOT EXISTS (SELECT 1 FROM group_schedules gs WHERE gs.group_id = legacy.id)
            AND day_of_week IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL
        ) slots ON slots.group_id = g.id
        WHERE g.deleted_at IS NULL AND COALESCE(g.status, 'actif') = 'actif'
          AND g.school_year_id = ?1 AND (?2 IS NULL OR g.id <> ?2)
        ORDER BY g.id, slots.day, slots.start_time";
    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Recherche de conflits", e))?;
    let rows = stmt.query_map(params![school_year_id, group_id], |r| Ok((
        r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
        r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, String>(6)?,
        r.get::<_, String>(7)?, r.get::<_, String>(8)?,
    ))).map_err(|e| db_err("Recherche de conflits", e))?;
    let mut conflicts = Vec::new();
    for row in rows {
        let (other_teacher, other_room, teacher_name, subject, level, day, start, end) = row.map_err(|e| db_err("Lecture des conflits", e))?;
        let (other_start, other_end) = match (minutes(&start), minutes(&end)) {
            (Some(a), Some(b)) if a < b => (a, b), _ => continue,
        };
        let room_match = !wanted_room.is_empty() && wanted_room == other_room.trim().to_lowercase();
        let teacher_match = teacher_id.is_some() && teacher_id == other_teacher;
        if !room_match && !teacher_match { continue; }
        let group_name = [subject.as_str(), level.as_str()].into_iter().filter(|s| !s.trim().is_empty() && *s != "—").collect::<Vec<_>>().join(" — ");
        for input in schedules {
            let (input_start, input_end) = match (minutes(&input.start_time), minutes(&input.end_time)) {
                (Some(a), Some(b)) if a < b => (a, b), _ => continue,
            };
            if input.day.trim().to_lowercase() != day.trim().to_lowercase() || input_start >= other_end || other_start >= input_end { continue; }
            for (kind, matched) in [("room", room_match), ("teacher", teacher_match)] {
                if matched {
                    conflicts.push(ScheduleConflict { conflict_type: kind.to_string(), group_name: group_name.clone(), day: day.clone(), start_time: start.clone(), end_time: end.clone(), teacher_name: teacher_name.clone(), room: other_room.clone() });
                }
            }
        }
    }
    Ok(conflicts)
}

#[tauri::command]
pub fn cmd_check_schedule_conflicts(
    db: State<'_, Db>, group_id: Option<i64>, teacher_id: Option<i64>, room: String,
    school_year_id: i64, schedules: Vec<ConflictScheduleInput>,
) -> Result<Vec<ScheduleConflict>, String> {
    check_schedule_conflicts(&db.conn(), group_id, teacher_id, &room, school_year_id, &schedules)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO teachers (id, full_name) VALUES (901, 'Prof. Amrani')", []).unwrap();
        conn.execute("INSERT INTO groups (id, subject_id, level_id, teacher_id, school_year_id, room, monthly_fee_cents, capacity) VALUES (901, 1, 1, 901, 1, 'A1', 100, 10)", []).unwrap();
        conn.execute("INSERT INTO group_schedules (group_id, day_of_week, start_time, end_time) VALUES (901, 'Lundi', '14:00', '16:00')", []).unwrap();
        conn
    }
    fn slot(day: &str, start: &str, end: &str) -> ConflictScheduleInput {
        ConflictScheduleInput { day: day.into(), start_time: start.into(), end_time: end.into() }
    }
    #[test]
    fn detects_room_conflict() {
        let c = setup();
        let found = check_schedule_conflicts(&c, None, None, " A1 ", 1, &[slot("Lundi", "15:00", "17:00")]).unwrap();
        assert_eq!(found.len(), 1); assert_eq!(found[0].conflict_type, "room");
        assert_eq!(found[0].start_time, "14:00"); assert_eq!(found[0].end_time, "16:00");
    }
    #[test]
    fn detects_teacher_conflict_and_both_types() {
        let c = setup();
        let found = check_schedule_conflicts(&c, None, Some(901), "A1", 1, &[slot("Lundi", "15:00", "17:00")]).unwrap();
        assert_eq!(found.len(), 2); assert_eq!(found[1].conflict_type, "teacher"); assert_eq!(found[1].teacher_name, "Prof. Amrani");
    }
    #[test]
    fn touching_endpoints_do_not_overlap() {
        let c = setup();
        for (a, b) in [("16:00", "18:00"), ("12:00", "14:00")] {
            assert!(check_schedule_conflicts(&c, None, Some(901), "A1", 1, &[slot("Lundi", a, b)]).unwrap().is_empty());
        }
    }
    #[test]
    fn different_day_does_not_overlap() {
        let c = setup();
        assert!(check_schedule_conflicts(&c, None, Some(901), "A1", 1, &[slot("Mardi", "15:00", "17:00")]).unwrap().is_empty());
    }
    #[test]
    fn multi_day_and_legacy_slots_are_checked() {
        let c = setup();
        c.execute("INSERT INTO group_schedules (group_id, day_of_week, start_time, end_time) VALUES (901, 'Mercredi', '10:00', '12:00')", []).unwrap();
        let found = check_schedule_conflicts(&c, None, Some(901), "A1", 1, &[slot("Lundi", "15:00", "17:00"), slot("Mercredi", "11:00", "13:00")]).unwrap();
        assert_eq!(found.len(), 4);
        c.execute("DELETE FROM group_schedules WHERE group_id=901", []).unwrap();
        c.execute("UPDATE groups SET day_of_week='Mardi', start_time='08:00', end_time='10:00' WHERE id=901", []).unwrap();
        let found = check_schedule_conflicts(&c, None, None, "A1", 1, &[slot("Mardi", "09:00", "11:00")]).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].conflict_type, "room");
    }
    #[test]
    fn excludes_self_other_year_deleted_and_inactive() {
        let c = setup(); let slots = [slot("Lundi", "15:00", "17:00")];
        assert!(check_schedule_conflicts(&c, Some(901), Some(901), "A1", 1, &slots).unwrap().is_empty());
        assert!(check_schedule_conflicts(&c, None, Some(901), "A1", 2, &slots).unwrap().is_empty());
        c.execute("UPDATE groups SET deleted_at = '2026-01-01' WHERE id=901", []).unwrap();
        assert!(check_schedule_conflicts(&c, None, Some(901), "A1", 1, &slots).unwrap().is_empty());
        c.execute("UPDATE groups SET deleted_at = NULL, status = 'inactif' WHERE id=901", []).unwrap();
        assert!(check_schedule_conflicts(&c, None, Some(901), "A1", 1, &slots).unwrap().is_empty());
    }
}
