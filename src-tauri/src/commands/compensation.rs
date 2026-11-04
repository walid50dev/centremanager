//! Teacher compensation & settlements (Phase 6).
//!
//! A teacher has **one main mode plus an optional bonus**, and the two are
//! cumulative:
//!
//! | Mode            | Base                                                      |
//! | --------------- | --------------------------------------------------------- |
//! | `fixed_monthly` | the fixed amount, whatever the hours or students           |
//! | `hourly`        | rate × hours logged in `teacher_activities`                |
//! | `per_session`   | rate × sessions logged in `teacher_activities`             |
//! | `percentage`    | pct × **theoretical** revenue (fee × enrolled students)    |
//!
//! `percentage` deliberately uses `monthly_fee_cents × active enrollments` and
//! never the invoices: a teacher is not penalised when a family pays late.
//! The recruitment bonus is a percentage of the same theoretical total and is
//! added on top of whatever the main mode produced.
//!
//! The configuration lives on the `teachers` row (`compensation_mode`,
//! `compensation_value_cents`, `bonus_pct`). For `percentage` the value is the
//! percentage × 100 (40 % = `4000`) so every amount stays an integer.
//!
//! Settlements are **never deleted** in V1: paying a teacher twice for the same
//! month simply adds a second row and the status moves from `pending` to
//! `partial` to `settled`.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use tauri::State;

use super::db_err;
use super::teachers::{compensation_config, teacher_groups};
use crate::db::Db;
use crate::models::{CompensationDetail, CompensationGroupLine, Settlement, TeacherCompSummary};

pub const MODE_FIXED: &str = "fixed_monthly";
pub const MODE_HOURLY: &str = "hourly";
pub const MODE_PER_SESSION: &str = "per_session";
pub const MODE_PERCENTAGE: &str = "percentage";

pub const MODES: [&str; 4] = [MODE_FIXED, MODE_HOURLY, MODE_PER_SESSION, MODE_PERCENTAGE];

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_PARTIAL: &str = "partial";
pub const STATUS_SETTLED: &str = "settled";
pub const STATUS_NOT_CONFIGURED: &str = "not_configured";

const ENTITY_TYPE: &str = "teacher";

// ---------------------------------------------------------------------------
// Formatting helpers (the `detail_lines` are human-readable French text)
// ---------------------------------------------------------------------------

/// `123456` → `1234.56 DH`.
fn money(cents: i64) -> String {
    format!("{:.2} DH", cents as f64 / 100.0)
}

/// `12.5` → `12.5`, `8.0` → `8`.
fn number(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded.fract()).abs() < f64::EPSILON {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded}")
    }
}

/// `4000` → `40`, `2550` → `25.5`.
fn percentage(value_cents: i64) -> String {
    number(value_cents as f64 / 100.0)
}

fn group_label(subject: &str, level: &str, branch: Option<&str>) -> String {
    match branch {
        Some(branch) if !branch.is_empty() => format!("{subject} — {level} · {branch}"),
        _ => format!("{subject} — {level}"),
    }
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

fn validate_period(month: i32, year: i32) -> Result<(), String> {
    if !(1..=12).contains(&month) {
        return Err("Mois invalide (1 à 12)".to_string());
    }
    if !(2000..=2100).contains(&year) {
        return Err("Année invalide".to_string());
    }
    Ok(())
}

fn period_prefix(month: i32, year: i32) -> String {
    format!("{year:04}-{month:02}")
}

// ---------------------------------------------------------------------------
// Theoretical revenue
// ---------------------------------------------------------------------------

/// One line per active group: `enrolled_count × monthly_fee_cents`.
pub fn theoretical_groups(
    conn: &Connection,
    teacher_id: i64,
) -> Result<Vec<CompensationGroupLine>, String> {
    let groups = teacher_groups(conn, teacher_id)?;
    Ok(groups
        .into_iter()
        .map(|group| CompensationGroupLine {
            group_id: group.group_id,
            subject_name: group.subject_name,
            level_name: group.level_name,
            branch_name: group.branch_name,
            enrolled_count: group.enrolled_count,
            monthly_fee_cents: group.monthly_fee_cents,
            total_cents: group.monthly_fee_cents * i64::from(group.enrolled_count),
        })
        .collect())
}

fn theoretical_total(groups: &[CompensationGroupLine]) -> i64 {
    groups.iter().map(|group| group.total_cents).sum()
}

/// Hours logged for the period (`hourly` mode).
pub fn total_hours(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
) -> Result<f64, String> {
    conn.query_row(
        "SELECT COALESCE(SUM(hours), 0) FROM teacher_activities
          WHERE teacher_id = ?1
            AND substr(activity_date, 1, 7) = ?2",
        params![teacher_id, period_prefix(month, year)],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture des heures", err))
}

/// Sessions logged for the period (`per_session` mode).
pub fn total_sessions(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(SUM(sessions), 0) FROM teacher_activities
          WHERE teacher_id = ?1
            AND substr(activity_date, 1, 7) = ?2",
        params![teacher_id, period_prefix(month, year)],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture des séances", err))
}

/// Sum of the settlements recorded for a payroll period.
pub fn settled_total(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM teacher_settlements
          WHERE teacher_id = ?1 AND month = ?2 AND year = ?3",
        params![teacher_id, month, year],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture des règlements", err))
}

fn status_for(total: i64, settled: i64) -> &'static str {
    if total > 0 && settled >= total {
        STATUS_SETTLED
    } else if settled > 0 {
        STATUS_PARTIAL
    } else {
        STATUS_PENDING
    }
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

/// Compute the payroll of one teacher for a month. Pure: nothing is written.
pub fn calculate_compensation(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
) -> Result<CompensationDetail, String> {
    validate_period(month, year)?;

    let teacher_name: String = conn
        .query_row(
            "SELECT full_name FROM teachers WHERE id = ?1",
            params![teacher_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture de l'enseignant", err))?
        .ok_or_else(|| "Enseignant introuvable".to_string())?;

    let config = compensation_config(conn, teacher_id)?
        .ok_or_else(|| "Compensation non configurée".to_string())?;
    let mode = config.mode.clone();
    if !MODES.contains(&mode.as_str()) {
        return Err("Mode de compensation invalide".to_string());
    }

    let groups = theoretical_groups(conn, teacher_id)?;
    let theoretical = theoretical_total(&groups);

    let mut detail_lines: Vec<String> = Vec::new();
    let mut hours: Option<f64> = None;
    let mut sessions: Option<i64> = None;

    let base = match mode.as_str() {
        MODE_FIXED => {
            detail_lines.push(format!("Montant fixe : {}", money(config.value_cents)));
            config.value_cents
        }
        MODE_HOURLY => {
            let sum = total_hours(conn, teacher_id, month, year)?;
            hours = Some(sum);
            let amount = (sum * config.value_cents as f64).round() as i64;
            detail_lines.push(format!(
                "{} heures × {} / heure = {}",
                number(sum),
                money(config.value_cents),
                money(amount)
            ));
            amount
        }
        MODE_PER_SESSION => {
            let sum = total_sessions(conn, teacher_id, month, year)?;
            sessions = Some(sum);
            let amount = config.value_cents * sum;
            detail_lines.push(format!(
                "{} séances × {} / séance = {}",
                sum,
                money(config.value_cents),
                money(amount)
            ));
            amount
        }
        MODE_PERCENTAGE => {
            for group in &groups {
                detail_lines.push(format!(
                    "{} : {} élèves × {} = {}",
                    group_label(
                        &group.subject_name,
                        &group.level_name,
                        group.branch_name.as_deref()
                    ),
                    group.enrolled_count,
                    money(group.monthly_fee_cents),
                    money(group.total_cents)
                ));
            }
            detail_lines.push(format!("Total théorique : {}", money(theoretical)));
            let pct = config.value_cents as f64 / 100.0;
            let amount = (theoretical as f64 * pct / 100.0).round() as i64;
            detail_lines.push(format!(
                "Montant principal ({}%) : {}",
                percentage(config.value_cents),
                money(amount)
            ));
            amount
        }
        _ => unreachable!("mode validated above"),
    };

    let bonus = match config.bonus_pct {
        Some(pct) if pct > 0.0 => {
            let amount = (theoretical as f64 * pct / 100.0).round() as i64;
            detail_lines.push(format!(
                "Bonus recrutement : {} × {}% = {}",
                money(theoretical),
                number(pct),
                money(amount)
            ));
            amount
        }
        _ => 0,
    };

    let total = base + bonus;
    let already_settled = settled_total(conn, teacher_id, month, year)?;

    Ok(CompensationDetail {
        teacher_name,
        mode,
        base_amount_cents: base,
        bonus_amount_cents: bonus,
        total_cents: total,
        detail_lines,
        already_settled_cents: already_settled,
        remaining_cents: total - already_settled,
        groups,
        theoretical_cents: theoretical,
        value_cents: config.value_cents,
        bonus_pct: config.bonus_pct,
        hours,
        sessions,
    })
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

pub fn set_compensation(
    conn: &Connection,
    teacher_id: i64,
    mode: &str,
    value_cents: i64,
    bonus_pct: Option<f64>,
) -> Result<(), String> {
    let mode = mode.trim();
    if !MODES.contains(&mode) {
        return Err(
            "Mode de compensation invalide (fixed_monthly, hourly, per_session, percentage)"
                .to_string(),
        );
    }
    if value_cents <= 0 {
        return Err("La valeur de la compensation doit être supérieure à 0".to_string());
    }
    if mode == MODE_PERCENTAGE {
        // Stored as percentage × 100.
        if value_cents > 10_000 {
            return Err("Le pourcentage doit être compris entre 0 et 100".to_string());
        }
    }
    if let Some(pct) = bonus_pct {
        if !(0.0..=100.0).contains(&pct) || pct.is_nan() {
            return Err("Le pourcentage de bonus doit être compris entre 0 et 100".to_string());
        }
    }

    let previous: Option<(Option<String>, Option<i64>, Option<f64>)> = conn
        .query_row(
            "SELECT compensation_mode, compensation_value_cents, bonus_pct
               FROM teachers WHERE id = ?1",
            params![teacher_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|err| db_err("Lecture de la compensation", err))?;
    let Some((old_mode, old_value, old_bonus)) = previous else {
        return Err("Enseignant introuvable".to_string());
    };

    let bonus = bonus_pct.filter(|pct| *pct > 0.0);

    conn.execute(
        "UPDATE teachers
            SET compensation_mode = ?2,
                compensation_value_cents = ?3,
                bonus_pct = ?4,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1",
        params![teacher_id, mode, value_cents, bonus],
    )
    .map_err(|err| db_err("Enregistrement de la compensation", err))?;

    conn.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('SET_COMPENSATION', ?1, ?2, ?3)",
        params![
            ENTITY_TYPE,
            teacher_id,
            json!({
                "from": { "mode": old_mode, "value_cents": old_value, "bonus_pct": old_bonus },
                "to": { "mode": mode, "value_cents": value_cents, "bonus_pct": bonus },
            })
            .to_string()
        ],
    )
    .map_err(|err| db_err("Journalisation de l'audit", err))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/// Keep the monthly `teacher_compensation` row in sync with the calculation and
/// the money actually paid. Returns the row id.
fn upsert_compensation_row(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
    detail: &CompensationDetail,
    settled: i64,
) -> Result<i64, String> {
    let status = status_for(detail.total_cents, settled);
    conn.execute(
        "INSERT INTO teacher_compensation
            (teacher_id, month, year, mode, base_amount_cents, bonus_amount_cents,
             total_amount_cents, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(teacher_id, month, year) DO UPDATE SET
             mode = excluded.mode,
             base_amount_cents = excluded.base_amount_cents,
             bonus_amount_cents = excluded.bonus_amount_cents,
             total_amount_cents = excluded.total_amount_cents,
             status = excluded.status",
        params![
            teacher_id,
            month,
            year,
            detail.mode,
            detail.base_amount_cents,
            detail.bonus_amount_cents,
            detail.total_cents,
            status
        ],
    )
    .map_err(|err| db_err("Enregistrement de la compensation mensuelle", err))?;

    conn.query_row(
        "SELECT id FROM teacher_compensation WHERE teacher_id = ?1 AND month = ?2 AND year = ?3",
        params![teacher_id, month, year],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture de la compensation mensuelle", err))
}

pub fn record_settlement(
    conn: &Connection,
    teacher_id: i64,
    month: i32,
    year: i32,
    amount_cents: i64,
    method: &str,
    notes: Option<&str>,
) -> Result<i64, String> {
    validate_period(month, year)?;
    if amount_cents <= 0 {
        return Err("Le montant doit être supérieur à 0".to_string());
    }
    let method = method.trim();
    if method.is_empty() {
        return Err("Le mode de paiement est obligatoire".to_string());
    }

    // Recalculated from the live data, in the transaction below.
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    let detail = calculate_compensation(&tx, teacher_id, month, year)?;

    tx.execute(
        "INSERT INTO teacher_settlements
            (teacher_id, compensation_id, amount_cents, payment_method, notes, month, year)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)",
        params![
            teacher_id,
            amount_cents,
            method,
            notes.map(str::trim).filter(|text| !text.is_empty()),
            month,
            year
        ],
    )
    .map_err(|err| db_err("Enregistrement du règlement", err))?;
    let settlement_id = tx.last_insert_rowid();

    let settled = settled_total(&tx, teacher_id, month, year)?;
    upsert_compensation_row(&tx, teacher_id, month, year, &detail, settled)?;

    tx.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('SETTLEMENT', ?1, ?2, ?3)",
        params![
            ENTITY_TYPE,
            teacher_id,
            json!({
                "settlement_id": settlement_id,
                "month": month,
                "year": year,
                "amount_cents": amount_cents,
                "method": method,
                "total_cents": detail.total_cents,
                "settled_cents": settled,
                "status": status_for(detail.total_cents, settled),
            })
            .to_string()
        ],
    )
    .map_err(|err| db_err("Journalisation de l'audit", err))?;

    tx.commit()
        .map_err(|err| db_err("Validation de la transaction", err))?;

    Ok(settlement_id)
}

/// Settlements of a teacher, newest first, optionally limited to one month.
pub fn teacher_settlements(
    conn: &Connection,
    teacher_id: i64,
    month: Option<i32>,
    year: Option<i32>,
) -> Result<Vec<Settlement>, String> {
    let _: String = conn
        .query_row(
            "SELECT full_name FROM teachers WHERE id = ?1",
            params![teacher_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture de l'enseignant", err))?
        .ok_or_else(|| "Enseignant introuvable".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(amount_cents, 0), COALESCE(payment_method, ''),
                    notes, COALESCE(created_at, '')
               FROM teacher_settlements
              WHERE teacher_id = ?1
                AND (?2 IS NULL OR month = ?2)
                AND (?3 IS NULL OR year = ?3)
              ORDER BY COALESCE(created_at, '') DESC, id DESC",
        )
        .map_err(|err| db_err("Préparation de l'historique des règlements", err))?;
    let rows = stmt
        .query_map(params![teacher_id, month, year], |row| {
            Ok(Settlement {
                id: row.get(0)?,
                amount_cents: row.get(1)?,
                payment_method: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|err| db_err("Lecture des règlements", err))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des règlements", err))
}

/// Payroll summary of every active teacher for one month.
pub fn compensation_summary(
    conn: &Connection,
    month: i32,
    year: i32,
) -> Result<Vec<TeacherCompSummary>, String> {
    validate_period(month, year)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, full_name FROM teachers
              WHERE deleted_at IS NULL AND COALESCE(status, 'actif') = 'actif' AND (EXISTS (SELECT 1 FROM teacher_school_years ty WHERE ty.teacher_id=teachers.id AND ty.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)) OR EXISTS (SELECT 1 FROM groups g WHERE g.teacher_id=teachers.id AND g.deleted_at IS NULL AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)))
              ORDER BY full_name COLLATE NOCASE ASC",
        )
        .map_err(|err| db_err("Préparation du résumé de compensation", err))?;
    let teachers = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| db_err("Lecture des enseignants", err))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des enseignants", err))?;

    let mut summaries = Vec::with_capacity(teachers.len());
    for (teacher_id, teacher_name) in teachers {
        let configured = compensation_config(conn, teacher_id)?.is_some();
        if !configured {
            summaries.push(TeacherCompSummary {
                teacher_id,
                teacher_name,
                mode: String::new(),
                total_due_cents: 0,
                total_settled_cents: 0,
                remaining_cents: 0,
                status: STATUS_NOT_CONFIGURED.to_string(),
            });
            continue;
        }

        let detail = calculate_compensation(conn, teacher_id, month, year)?;
        let settled = settled_total(conn, teacher_id, month, year)?;
        summaries.push(TeacherCompSummary {
            teacher_id,
            teacher_name,
            mode: detail.mode.clone(),
            total_due_cents: detail.total_cents,
            total_settled_cents: settled,
            remaining_cents: detail.total_cents - settled,
            status: status_for(detail.total_cents, settled).to_string(),
        });
    }

    Ok(summaries)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_set_compensation(
    db: State<'_, Db>,
    teacher_id: i64,
    mode: String,
    value_cents: i64,
    bonus_pct: Option<f64>,
) -> Result<(), String> {
    let conn = db.conn();
    set_compensation(&conn, teacher_id, &mode, value_cents, bonus_pct)
}

#[tauri::command]
pub fn cmd_calculate_compensation(
    db: State<'_, Db>,
    teacher_id: i64,
    month: i32,
    year: i32,
) -> Result<CompensationDetail, String> {
    let conn = db.conn();
    calculate_compensation(&conn, teacher_id, month, year)
}

#[tauri::command]
pub fn cmd_record_settlement(
    db: State<'_, Db>,
    teacher_id: i64,
    month: i32,
    year: i32,
    amount_cents: i64,
    method: String,
    notes: Option<String>,
) -> Result<i64, String> {
    let conn = db.conn();
    record_settlement(
        &conn,
        teacher_id,
        month,
        year,
        amount_cents,
        &method,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn cmd_get_teacher_settlements(
    db: State<'_, Db>,
    teacher_id: i64,
    month: Option<i32>,
    year: Option<i32>,
) -> Result<Vec<Settlement>, String> {
    let conn = db.conn();
    teacher_settlements(&conn, teacher_id, month, year)
}

#[tauri::command]
pub fn cmd_get_all_teacher_compensation_summary(
    db: State<'_, Db>,
    month: i32,
    year: i32,
) -> Result<Vec<TeacherCompSummary>, String> {
    let conn = db.conn();
    compensation_summary(&conn, month, year)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::super::teachers::{create_teacher, set_teacher_status, CreateTeacherInput};
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn teacher(conn: &Connection, name: &str) -> i64 {
        create_teacher(
            conn,
            &CreateTeacherInput {
                full_name: name.to_string(),
                phone: None,
                email: None,
                notes: None,
                subject_ids: vec![1],
            },
        )
        .unwrap()
    }

    /// A group taught by `teacher_id`, with `students` active enrollments.
    fn group(conn: &Connection, teacher_id: i64, fee_cents: i64, students: i64) -> i64 {
        conn.execute(
            "INSERT INTO groups (subject_id, level_id, teacher_id, school_year_id,
                                 day_of_week, start_time, end_time, monthly_fee_cents, capacity, status)
             VALUES (1, 10, ?1, 1, 'Lundi', '16:00', '18:00', ?2, 20, 'actif')",
            params![teacher_id, fee_cents],
        )
        .unwrap();
        let group_id = conn.last_insert_rowid();

        for index in 0..students {
            conn.execute(
                "INSERT INTO students (full_name, phone) VALUES (?1, '0612345678')",
                params![format!("Élève {index}")],
            )
            .unwrap();
            let student_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO enrollments (student_id, group_id, start_date, status)
                 VALUES (?1, ?2, '2026-03-01', 'actif')",
                params![student_id, group_id],
            )
            .unwrap();
        }
        group_id
    }

    fn activity(
        conn: &Connection,
        teacher_id: i64,
        date: &str,
        kind: &str,
        hours: Option<f64>,
        sessions: Option<i64>,
    ) {
        conn.execute(
            "INSERT INTO teacher_activities
                (teacher_id, activity_date, activity_type, hours, sessions, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![teacher_id, date, kind, hours, sessions],
        )
        .unwrap();
    }

    #[test]
    fn fixed_monthly_ignores_groups_and_hours() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_FIXED, 500_000, None).unwrap();
        group(&conn, id, 40_000, 5);
        activity(&conn, id, "2026-03-04", "cours", Some(10.0), Some(4));

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.base_amount_cents, 500_000);
        assert_eq!(detail.bonus_amount_cents, 0);
        assert_eq!(detail.total_cents, 500_000);
        assert_eq!(detail.remaining_cents, 500_000);
        assert_eq!(detail.detail_lines, vec!["Montant fixe : 5000.00 DH"]);
    }

    #[test]
    fn hourly_multiplies_the_logged_hours_of_the_month_only() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_HOURLY, 8_000, None).unwrap(); // 80 DH/h

        activity(&conn, id, "2026-03-02", "cours", Some(2.5), None);
        activity(&conn, id, "2026-03-09", "cours", Some(3.0), None);
        activity(&conn, id, "2026-03-20", "rattrapage", Some(1.5), None);
        // Another month must not leak into the calculation.
        activity(&conn, id, "2026-04-02", "cours", Some(10.0), None);

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.hours, Some(7.0));
        assert_eq!(detail.base_amount_cents, 56_000); // 7 h × 80 DH
        assert_eq!(
            detail.detail_lines[0],
            "7 heures × 80.00 DH / heure = 560.00 DH"
        );

        let april = calculate_compensation(&conn, id, 4, 2026).unwrap();
        assert_eq!(april.base_amount_cents, 80_000);
    }

    #[test]
    fn per_session_multiplies_the_logged_sessions() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_PER_SESSION, 15_000, None).unwrap(); // 150 DH

        activity(&conn, id, "2026-03-02", "cours", None, Some(1));
        activity(&conn, id, "2026-03-05", "cours", None, Some(2));
        activity(&conn, id, "2026-03-06", "examen", Some(2.0), Some(1));

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.sessions, Some(4));
        assert_eq!(detail.base_amount_cents, 60_000);
        assert_eq!(
            detail.detail_lines[0],
            "4 séances × 150.00 DH / séance = 600.00 DH"
        );
    }

    #[test]
    fn percentage_uses_theoretical_revenue_not_collections() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim Ilham");
        // 40 % => stored 4000.
        set_compensation(&conn, id, MODE_PERCENTAGE, 4_000, None).unwrap();

        // 5 students × 400 DH = 2000 DH theoretical, and nothing is invoiced
        // or collected at all.
        group(&conn, id, 40_000, 5);

        let outstanding: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoices", [], |row| row.get(0))
            .unwrap();
        assert_eq!(outstanding, 0, "no invoice exists");

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.theoretical_cents, 200_000);
        assert_eq!(detail.base_amount_cents, 80_000); // 40 % of 2000 DH
        assert_eq!(detail.total_cents, 80_000);
        assert_eq!(
            detail.detail_lines,
            vec![
                "Mathématiques — Tronc Commun : 5 élèves × 400.00 DH = 2000.00 DH",
                "Total théorique : 2000.00 DH",
                "Montant principal (40%) : 800.00 DH",
            ]
        );
    }

    #[test]
    fn percentage_sums_every_group_and_ignores_inactive_ones() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_PERCENTAGE, 5_000, None).unwrap(); // 50 %

        group(&conn, id, 40_000, 2); // 800 DH
        group(&conn, id, 30_000, 1); // 300 DH

        // An archived group must not be billed to the centre.
        let archived = group(&conn, id, 25_000, 4);
        conn.execute(
            "UPDATE groups SET status = 'archive' WHERE id = ?1",
            params![archived],
        )
        .unwrap();

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.theoretical_cents, 110_000);
        assert_eq!(detail.base_amount_cents, 55_000);
    }

    #[test]
    fn bonus_is_cumulative_with_every_main_mode() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        group(&conn, id, 40_000, 5); // 2000 DH theoretical

        // fixed 500 DH + 5 % of 2000 DH = 500 + 100
        set_compensation(&conn, id, MODE_FIXED, 50_000, Some(5.0)).unwrap();
        let fixed = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(fixed.base_amount_cents, 50_000);
        assert_eq!(fixed.bonus_amount_cents, 10_000);
        assert_eq!(fixed.total_cents, 60_000);
        assert_eq!(
            fixed.detail_lines.last().unwrap(),
            "Bonus recrutement : 2000.00 DH × 5% = 100.00 DH"
        );

        // percentage 10 % + bonus 5 % = 200 + 100
        set_compensation(&conn, id, MODE_PERCENTAGE, 1_000, Some(5.0)).unwrap();
        let pct = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(pct.base_amount_cents, 20_000);
        assert_eq!(pct.bonus_amount_cents, 10_000);
        assert_eq!(pct.total_cents, 30_000);
    }

    #[test]
    fn calculation_requires_a_configuration() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        assert_eq!(
            calculate_compensation(&conn, id, 3, 2026).unwrap_err(),
            "Compensation non configurée"
        );
    }

    #[test]
    fn set_compensation_validates_every_mode_and_value() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");

        assert!(set_compensation(&conn, id, "weekly", 1000, None)
            .unwrap_err()
            .contains("Mode de compensation invalide"));
        assert_eq!(
            set_compensation(&conn, id, MODE_FIXED, 0, None).unwrap_err(),
            "La valeur de la compensation doit être supérieure à 0"
        );
        assert!(set_compensation(&conn, id, MODE_PERCENTAGE, 10_001, None)
            .unwrap_err()
            .contains("pourcentage"));
        assert!(set_compensation(&conn, id, MODE_FIXED, 1_000, Some(150.0))
            .unwrap_err()
            .contains("bonus"));

        set_compensation(&conn, id, MODE_PERCENTAGE, 10_000, Some(100.0)).unwrap();
        let config = super::super::teachers::compensation_config(&conn, id)
            .unwrap()
            .unwrap();
        assert_eq!(config.mode, MODE_PERCENTAGE);
        assert_eq!(config.value_cents, 10_000);
        assert_eq!(config.bonus_pct, Some(100.0));

        // A zero bonus is normalised away.
        set_compensation(&conn, id, MODE_HOURLY, 7_500, Some(0.0)).unwrap();
        let cleared = super::super::teachers::compensation_config(&conn, id)
            .unwrap()
            .unwrap();
        assert_eq!(cleared.bonus_pct, None);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'SET_COMPENSATION'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "only the accepted configurations are audited");
    }

    #[test]
    fn settlements_accumulate_and_move_the_status() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_FIXED, 500_000, None).unwrap();

        let first =
            record_settlement(&conn, id, 3, 2026, 200_000, "virement", Some("Acompte")).unwrap();
        assert!(first > 0);

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.already_settled_cents, 200_000);
        assert_eq!(detail.remaining_cents, 300_000);

        let status = |conn: &Connection| -> String {
            conn.query_row(
                "SELECT status FROM teacher_compensation WHERE teacher_id = ?1 AND month = 3 AND year = 2026",
                params![id],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(status(&conn), STATUS_PARTIAL);

        record_settlement(&conn, id, 3, 2026, 300_000, "espèces", None).unwrap();
        assert_eq!(status(&conn), STATUS_SETTLED);

        let detail = calculate_compensation(&conn, id, 3, 2026).unwrap();
        assert_eq!(detail.already_settled_cents, 500_000);
        assert_eq!(detail.remaining_cents, 0);

        let settlements = teacher_settlements(&conn, id, Some(3), Some(2026)).unwrap();
        assert_eq!(settlements.len(), 2);
        assert_eq!(settlements[0].amount_cents, 300_000);

        // Another month is untouched.
        assert_eq!(
            settled_total(&conn, id, 4, 2026).unwrap(),
            0,
            "settlements belong to their payroll month"
        );
    }

    #[test]
    fn settlement_validations() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");

        // No configuration -> nothing can be settled.
        assert_eq!(
            record_settlement(&conn, id, 3, 2026, 10_000, "espèces", None).unwrap_err(),
            "Compensation non configurée"
        );

        set_compensation(&conn, id, MODE_FIXED, 100_000, None).unwrap();
        assert_eq!(
            record_settlement(&conn, id, 3, 2026, 0, "espèces", None).unwrap_err(),
            "Le montant doit être supérieur à 0"
        );
        assert!(record_settlement(&conn, id, 13, 2026, 1_000, "espèces", None).is_err());
        assert_eq!(
            record_settlement(&conn, id, 3, 2026, 1_000, "  ", None).unwrap_err(),
            "Le mode de paiement est obligatoire"
        );
    }

    #[test]
    fn summary_covers_configured_and_unconfigured_teachers() {
        let conn = test_conn();
        let configured = teacher(&conn, "Ahmed Berrada");
        set_compensation(&conn, configured, MODE_FIXED, 400_000, None).unwrap();
        record_settlement(&conn, configured, 3, 2026, 100_000, "espèces", None).unwrap();

        teacher(&conn, "Zineb Alami");

        // An inactive teacher is not part of the payroll run.
        let inactive = teacher(&conn, "Salma Qadiri");
        set_compensation(&conn, inactive, MODE_FIXED, 300_000, None).unwrap();
        set_teacher_status(&conn, inactive, "inactif").unwrap();

        let summary = compensation_summary(&conn, 3, 2026).unwrap();
        assert_eq!(summary.len(), 2);
        assert_eq!(summary[0].teacher_name, "Ahmed Berrada");
        assert_eq!(summary[0].total_due_cents, 400_000);
        assert_eq!(summary[0].total_settled_cents, 100_000);
        assert_eq!(summary[0].remaining_cents, 300_000);
        assert_eq!(summary[0].status, STATUS_PARTIAL);

        assert_eq!(summary[1].teacher_name, "Zineb Alami");
        assert_eq!(summary[1].status, STATUS_NOT_CONFIGURED);
        assert_eq!(summary[1].total_due_cents, 0);
        assert_eq!(summary[1].mode, "");
    }

    #[test]
    fn settlement_is_audited() {
        let conn = test_conn();
        let id = teacher(&conn, "Karim");
        set_compensation(&conn, id, MODE_FIXED, 100_000, None).unwrap();
        record_settlement(&conn, id, 3, 2026, 60_000, "chèque", Some("Chèque 123")).unwrap();

        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE action = 'SETTLEMENT'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("\"amount_cents\":60000"));
        assert!(details.contains("\"settled_cents\":60000"));
        assert!(details.contains("\"status\":\"partial\""));
    }

    #[test]
    fn period_helpers_reject_impossible_months() {
        assert!(validate_period(0, 2026).is_err());
        assert!(validate_period(13, 2026).is_err());
        assert!(validate_period(1, 1900).is_err());
        assert!(validate_period(12, 2026).is_ok());
        assert_eq!(period_prefix(3, 2026), "2026-03");
    }

    // Keep the unused import lint quiet in case the helper set changes.
    #[test]
    fn money_and_percentage_formatting() {
        assert_eq!(money(123_456), "1234.56 DH");
        assert_eq!(number(7.0), "7");
        assert_eq!(number(7.5), "7.5");
        assert_eq!(percentage(4_000), "40");
        assert_eq!(percentage(2_550), "25.5");
    }
}
