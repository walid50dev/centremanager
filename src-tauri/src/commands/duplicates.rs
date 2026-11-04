//! Non-blocking duplicate detection for student and teacher forms.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::Db;
use super::db_err;

#[derive(Debug, Deserialize)]
pub struct CheckDuplicateInput {
    pub id: Option<i64>,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DuplicateMatch {
    pub entity_id: i64,
    pub full_name: String,
    pub phone: String,
    pub match_type: String,
}

/// SQLite's built-in LOWER is ASCII-only, so normalize in Rust for Arabic and
/// accented French names as well. Internal whitespace is collapsed too.
fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Ignore separators and country prefixes, but never match partial numbers.
fn normalize_phone(value: &str) -> Option<String> {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 10 { return None; }
    Some(digits[digits.len() - 10..].to_string())
}

/// Teachers (and legacy students) store one full name: first token is the
/// given name, the remaining tokens are the family name, as in student migration.
fn split_full_name(value: &str) -> (String, String) {
    let mut parts = value.split_whitespace();
    let first = parts.next().unwrap_or_default().to_string();
    let last = parts.collect::<Vec<_>>().join(" ");
    (first, last)
}

pub fn check_duplicates(conn: &Connection, entity_type: &str, data: &CheckDuplicateInput) -> Result<Vec<DuplicateMatch>, String> {
    let sql = match entity_type {
        "student" => "SELECT id, full_name, first_name, last_name, COALESCE(NULLIF(guardian_phone, ''), phone, '') FROM students WHERE deleted_at IS NULL AND (?1 IS NULL OR id <> ?1)",
        "teacher" => "SELECT id, COALESCE(full_name, ''), NULL, NULL, COALESCE(phone, '') FROM teachers WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=teachers.id AND ty.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND ty.deleted_at IS NOT NULL) AND (?1 IS NULL OR id <> ?1)",
        _ => return Err("Type d'entité invalide".to_string()),
    };
    let first = normalize_name(&data.first_name);
    let last = normalize_name(&data.last_name);
    let phone = data.phone.as_deref().and_then(normalize_phone);
    if (first.is_empty() || last.is_empty()) && phone.is_none() { return Ok(Vec::new()); }

    let mut stmt = conn.prepare(sql).map_err(|e| db_err("Recherche de doublons", e))?;
    let rows = stmt.query_map(params![data.id], |r| Ok((
        r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?,
        r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?,
    ))).map_err(|e| db_err("Recherche de doublons", e))?;
    let mut matches = Vec::new();
    for row in rows {
        let (id, full_name, stored_first, stored_last, stored_phone) = row.map_err(|e| db_err("Recherche de doublons", e))?;
        let (fallback_first, fallback_last) = split_full_name(&full_name);
        let name_matches = !first.is_empty() && !last.is_empty()
            && normalize_name(stored_first.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(&fallback_first)) == first
            && normalize_name(stored_last.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(&fallback_last)) == last;
        let phone_matches = phone.is_some() && phone == normalize_phone(&stored_phone);
        let match_type = match (name_matches, phone_matches) {
            (true, true) => "both", (true, false) => "name", (false, true) => "phone", _ => continue,
        };
        matches.push(DuplicateMatch { entity_id: id, full_name, phone: stored_phone, match_type: match_type.to_string() });
    }
    matches.sort_by_key(|m| (match m.match_type.as_str() { "both" => 0, "name" => 1, _ => 2 }, m.entity_id));
    Ok(matches)
}

#[tauri::command]
pub fn cmd_check_duplicates(db: State<'_, Db>, entity_type: String, data: CheckDuplicateInput) -> Result<Vec<DuplicateMatch>, String> {
    check_duplicates(&db.conn(), &entity_type, &data)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }
    fn input(first: &str, last: &str, phone: Option<&str>) -> CheckDuplicateInput {
        CheckDuplicateInput { id: None, first_name: first.into(), last_name: last.into(), phone: phone.map(str::to_string) }
    }
    #[test]
    fn name_matches_case_whitespace_and_unicode() {
        let c = db();
        c.execute("INSERT INTO students (full_name, first_name, last_name, phone) VALUES ('Salma El Mansouri', 'Salma', 'El   Mansouri', '0661234567')", []).unwrap();
        let found = check_duplicates(&c, "student", &input("  SALMA ", "el mansouri", None)).unwrap();
        assert_eq!(found.len(), 1); assert_eq!(found[0].match_type, "name");
        c.execute("INSERT INTO teachers (full_name) VALUES ('Élodie   Durand')", []).unwrap();
        assert_eq!(check_duplicates(&c, "teacher", &input("élodie", "DURAND", None)).unwrap().len(), 1);
    }
    #[test]
    fn phones_ignore_separators_and_compare_only_last_ten_digits() {
        let c = db();
        c.execute("INSERT INTO teachers (full_name, phone) VALUES ('Ahmed Alaoui', '06 61-23 45 67')", []).unwrap();
        let found = check_duplicates(&c, "teacher", &input("", "", Some("000 0661234567"))).unwrap();
        assert_eq!(found.len(), 1); assert_eq!(found[0].match_type, "phone");
        assert!(check_duplicates(&c, "teacher", &input("", "", Some("1234567"))).unwrap().is_empty());
    }
    #[test]
    fn both_self_and_deleted_are_handled() {
        let c = db();
        c.execute("INSERT INTO students (full_name, first_name, last_name, phone) VALUES ('Salma El Mansouri', 'Salma', 'El Mansouri', '0661234567')", []).unwrap();
        c.execute("INSERT INTO students (full_name, first_name, last_name, phone, deleted_at) VALUES ('Salma El Mansouri', 'Salma', 'El Mansouri', '0661234567', datetime('now'))", []).unwrap();
        let mut data = input("Salma", "El Mansouri", Some("06 61 23 45 67"));
        let found = check_duplicates(&c, "student", &data).unwrap();
        assert_eq!(found.len(), 1); assert_eq!(found[0].match_type, "both");
        data.id = Some(found[0].entity_id);
        assert!(check_duplicates(&c, "student", &data).unwrap().is_empty());
        assert!(check_duplicates(&c, "payments", &data).is_err());
    }
    #[test]
    fn legacy_name_and_guardian_phone_fallback() {
        let c = db();
        c.execute("INSERT INTO students (full_name, phone) VALUES ('Salma El Mansouri', '0661234567')", []).unwrap();
        let found = check_duplicates(&c, "student", &input("Salma", "El Mansouri", Some("0661234567"))).unwrap();
        assert_eq!(found.len(), 1); assert_eq!(found[0].match_type, "both");
    }
}
