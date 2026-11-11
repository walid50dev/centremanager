//! Enrollment workflow (Phase 4).
//!
//! The model is **prepaid**: enrolling a student in a group immediately
//! generates the invoice for the month of the start date — a full month, with
//! no prorata, whatever the day. Ending an enrollment keeps that invoice
//! (V1 never refunds), it only stops future months.
//!
//! The `enrollments` table has a plain `UNIQUE (student_id, group_id)`, so a
//! student who left a group and comes back is *re-enrolled on the same row*
//! (start date reset, `end_date` cleared) instead of inserting a duplicate.

use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use super::db_err;
use super::groups::get_group;
use crate::db::Db;
use crate::models::{GroupRow, StudentEnrollment};

const ENTITY_TYPE: &str = "enrollment";

/// Payload for the batch enrollment command.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchEnrollmentInput {
    pub student_id: i64,
    pub group_id: i64,
    pub start_date: String,
    pub custom_monthly_fee_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnrollmentResult {
    pub id: i64,
    pub enrollment_fee_invoice_id: Option<i64>,
    pub enrollment_fee_amount_cents: Option<i64>,
}

// ---------------------------------------------------------------------------
// Due date
// ---------------------------------------------------------------------------

pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Last calendar day of `month`.
pub fn last_day_of_month(year: i32, month: i32) -> u32 {
    match month {
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Same day next month, clamped to the end of the month.
///
/// `31 janvier` → `28 (29) février`, `31 mars` → `30 avril`, `31 mai` →
/// `30 juin`, `30 janvier` → `28 février`.
pub fn adjust_due_date(year: i32, month: i32, day: i32) -> String {
    let last_day = last_day_of_month(year, month);
    let due_day = day.min(last_day as i32);
    format!("{year:04}-{month:02}-{due_day:02}")
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| "Date d'inscription invalide (format attendu AAAA-MM-JJ)".to_string())
}

fn today() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

fn ensure_student_active(conn: &Connection, student_id: i64) -> Result<(), String> {
    let status: Option<Option<String>> = conn
        .query_row(
            "SELECT status FROM students WHERE id = ?1 AND deleted_at IS NULL",
            params![student_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture de l'élève", err))?;

    match status {
        None => Err("Élève introuvable".to_string()),
        Some(value) => {
            let value = value.unwrap_or_else(|| "actif".to_string());
            if value == "actif" {
                Ok(())
            } else {
                Err("Cet élève est inactif : impossible de l'inscrire".to_string())
            }
        }
    }
}

fn ensure_group_active(conn: &Connection, group_id: i64) -> Result<GroupRow, String> {
    let group = get_group(conn, group_id)?;
    if group.status != "actif" {
        return Err("Ce groupe est inactif : impossible d'y inscrire un élève".to_string());
    }
    Ok(group)
}

/// `(id, status)` of the existing (student, group) pair, if any.
fn existing_enrollment(
    conn: &Connection,
    student_id: i64,
    group_id: i64,
) -> Result<Option<(i64, String)>, String> {
    conn.query_row(
        "SELECT id, COALESCE(status, 'actif') FROM enrollments
         WHERE student_id = ?1 AND group_id = ?2",
        params![student_id, group_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|err| db_err("Lecture de l'inscription", err))
}

/// The invoice for a month already exists → keep it (no duplicate, no reset).
fn ensure_invoice(
    conn: &Connection,
    enrollment_id: i64,
    date: NaiveDate,
    monthly_fee_cents: i64,
) -> Result<(i64, bool), String> {
    let month = date.month() as i32;
    let year = date.year();

    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM invoices
             WHERE enrollment_id = ?1 AND period_month = ?2 AND period_year = ?3",
            params![enrollment_id, month, year],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture de la facture", err))?;

    if let Some(id) = existing {
        return Ok((id, false));
    }

    let due_date = adjust_due_date(year, month, date.day() as i32);
    conn.execute(
        "INSERT INTO invoices
            (enrollment_id, period_month, period_year, amount_cents, paid_amount_cents, status, due_date)
         VALUES (?1, ?2, ?3, ?4, 0, 'impayé', ?5)",
        params![enrollment_id, month, year, monthly_fee_cents, due_date],
    )
    .map_err(|err| db_err("Création de la facture", err))?;

    Ok((conn.last_insert_rowid(), true))
}

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

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/// Enroll one student, generating the first invoice. Runs inside the caller's
/// transaction when there is one.
fn enroll_on(
    conn: &Connection,
    student_id: i64,
    group_id: i64,
    start_date: &str,
    custom_monthly_fee_cents: Option<i64>,
) -> Result<EnrollmentResult, String> {
    let date = parse_date(start_date)?;
    if matches!(custom_monthly_fee_cents, Some(fee) if fee < 0) {
        return Err("Tarif personnalisé invalide".to_string());
    }
    ensure_student_active(conn, student_id)?;
    let group = ensure_group_active(conn, group_id)?;

    let existing = existing_enrollment(conn, student_id, group_id)?;
    if let Some((_, status)) = &existing {
        if status == "actif" {
            return Err("Déjà inscrit dans ce groupe".to_string());
        }
    }

    // Capacity is checked against active enrollments only.
    let enrolled: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM enrollments
             WHERE group_id = ?1 AND COALESCE(status, 'actif') = 'actif'",
            params![group_id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Comptage des inscrits", err))?;
    if enrolled >= group.capacity {
        return Err("Groupe complet".to_string());
    }

    let start = date.format("%Y-%m-%d").to_string();
    let enrollment_id = match existing {
        // Re-enrollment after an end: reuse the row, the UNIQUE pair forbids
        // a second one.
        Some((id, _)) => {
            conn.execute(
                "UPDATE enrollments SET start_date = ?1, end_date = NULL, status = 'actif', custom_monthly_fee_cents = ?3
                 WHERE id = ?2",
                params![start, id, custom_monthly_fee_cents],
            )
            .map_err(|err| db_err("Réactivation de l'inscription", err))?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO enrollments (student_id, group_id, start_date, status, custom_monthly_fee_cents)
                 VALUES (?1, ?2, ?3, 'actif', ?4)",
                params![student_id, group_id, start, custom_monthly_fee_cents],
            )
            .map_err(|err| db_err("Création de l'inscription", err))?;
            conn.last_insert_rowid()
        }
    };

    let (invoice_id, created) = ensure_invoice(conn, enrollment_id, date, custom_monthly_fee_cents.unwrap_or(group.monthly_fee_cents))?;

    // A fee invoice has no enrollment_id: it must survive deletion of a group.
    // The unique student/year constraint prevents duplicates across a batch.
    let year_id: i64 = conn.query_row(
        "SELECT school_year_id FROM groups WHERE id=?1 AND school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)",
        params![group_id], |r| r.get(0))
        .map_err(|_| "Groupe hors de l'année scolaire active".to_string())?;
    let fee: i64 = conn.query_row("SELECT enrollment_fee_cents FROM students WHERE id=?1", params![student_id], |r| r.get(0))
        .map_err(|e| db_err("Lecture des frais de l'élève", e))?;
    // Persist even the zero-fee decision, so later groups cannot charge it
    // retroactively and deleting a group cannot reset the decision.
    let first_enrollment = conn.execute(
        "INSERT OR IGNORE INTO enrollment_fee_attempts(student_id,school_year_id) VALUES(?1,?2)",
        params![student_id,year_id]).map_err(|e| db_err("Décision des frais d'inscription", e))? == 1;
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM enrollment_fees WHERE student_id=?1 AND school_year_id=?2)",
        params![student_id, year_id], |r| r.get(0)).map_err(|e| db_err("Lecture des frais d'inscription", e))?;
    let fee_invoice_id = if fee > 0 && first_enrollment && !exists {
        conn.execute("INSERT INTO invoices(enrollment_id, period_month, period_year, amount_cents, paid_amount_cents, status, due_date, type) VALUES(NULL, ?1, ?2, ?3, 0, 'impayé', ?4, 'frais_inscription')",
            params![date.month() as i32, date.year(), fee, start]).map_err(|e| db_err("Création des frais d'inscription", e))?;
        let id = conn.last_insert_rowid();
        conn.execute("INSERT INTO enrollment_fees(student_id, school_year_id, amount, invoice_id) VALUES(?1, ?2, ?3, ?4)",
            params![student_id, year_id, fee, id]).map_err(|e| db_err("Création des frais d'inscription", e))?;
        Some(id)
    } else { None };

    log_audit(
        conn,
        "ENROLL",
        enrollment_id,
        Some(
            json!({
                "student_id": student_id,
                "group_id": group_id,
                "start_date": start,
                "monthly_fee_cents": group.monthly_fee_cents,
                "invoice_id": invoice_id,
                "invoice_created": created,
                "enrollment_fee_invoice_id": fee_invoice_id,
            })
            .to_string(),
        ),
    )?;

    Ok(EnrollmentResult { id: enrollment_id, enrollment_fee_invoice_id: fee_invoice_id,
        enrollment_fee_amount_cents: fee_invoice_id.map(|_| fee) })
}

/// Test helper: exercise a single enrollment transaction directly.
#[cfg(test)]
pub fn enroll_student(
    conn: &Connection,
    student_id: i64,
    group_id: i64,
    start_date: &str,
) -> Result<i64, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;
    let id = enroll_on(&tx, student_id, group_id, start_date, None)?;
    tx.commit()
        .map_err(|err| db_err("Validation de l'inscription", err))?;
    Ok(id.id)
}

/// Test helper exposing the IDs for atomic batch assertions.
#[cfg(test)]
pub fn enroll_student_batch(
    conn: &Connection,
    items: &[BatchEnrollmentInput],
) -> Result<Vec<i64>, String> {
    Ok(enroll_student_batch_details(conn, items)?.into_iter().map(|result| result.id).collect())
}

pub fn enroll_student_batch_details(conn: &Connection, items: &[BatchEnrollmentInput]) -> Result<Vec<EnrollmentResult>, String> {
    if items.is_empty() {
        return Err("Aucune inscription sélectionnée".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        match enroll_on(&tx, item.student_id, item.group_id, &item.start_date, item.custom_monthly_fee_cents) {
            Ok(id) => ids.push(id),
            Err(error) => {
                // Dropping the transaction would roll back too; be explicit.
                let _ = tx.rollback();
                return Err(error);
            }
        }
    }

    tx.commit()
        .map_err(|err| db_err("Validation des inscriptions", err))?;
    Ok(ids)
}

/// End an enrollment. The current month's invoice is deliberately untouched.
pub fn end_enrollment(conn: &Connection, enrollment_id: i64) -> Result<(), String> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT COALESCE(status, 'actif'), start_date FROM enrollments WHERE id = ?1",
            params![enrollment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| db_err("Lecture de l'inscription", err))?;

    let Some((status, start_date)) = row else {
        return Err("Inscription introuvable".to_string());
    };
    if status != "actif" {
        return Err("Cette inscription est déjà terminée".to_string());
    }

    let end_date = today();
    conn.execute(
        "UPDATE enrollments SET status = 'terminé', end_date = ?1 WHERE id = ?2",
        params![end_date, enrollment_id],
    )
    .map_err(|err| db_err("Fin de l'inscription", err))?;

    log_audit(
        conn,
        "END_ENROLLMENT",
        enrollment_id,
        Some(
            json!({
                "start_date": start_date.unwrap_or_default(),
                "end_date": end_date,
                "current_month_kept": true,
            })
            .to_string(),
        ),
    )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Every enrollment of a student, newest first.
pub fn student_enrollments(
    conn: &Connection,
    student_id: i64,
) -> Result<Vec<StudentEnrollment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.id, g.id,
                    COALESCE(s.name, '—'), COALESCE(l.name, '—'), b.name, t.full_name,
                    COALESCE(g.day_of_week, ''), COALESCE(g.start_time, ''), COALESCE(g.end_time, ''),
                    COALESCE(e.custom_monthly_fee_cents, g.monthly_fee_cents), COALESCE(e.start_date, ''), e.end_date,
                    COALESCE(e.status, 'actif')
             FROM enrollments e
             JOIN groups g ON g.id = e.group_id
             LEFT JOIN subjects s ON s.id = g.subject_id
             LEFT JOIN levels l ON l.id = g.level_id
             LEFT JOIN branches b ON b.id = g.branch_id
             LEFT JOIN teachers t ON t.id = g.teacher_id
             WHERE e.student_id = ?1 AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)
             ORDER BY e.start_date DESC, e.id DESC",
        )
        .map_err(|err| db_err("Préparation des inscriptions", err))?;

    let rows = stmt
        .query_map(params![student_id], map_student_enrollment)
        .map_err(|err| db_err("Lecture des inscriptions", err))?;

    let mut enrollments = Vec::new();
    for row in rows {
        enrollments.push(row.map_err(|err| db_err("Lecture d'une inscription", err))?);
    }
    Ok(enrollments)
}

fn map_student_enrollment(row: &Row<'_>) -> rusqlite::Result<StudentEnrollment> {
    Ok(StudentEnrollment {
        enrollment_id: row.get(0)?,
        group_id: row.get(1)?,
        subject_name: row.get(2)?,
        level_name: row.get(3)?,
        branch_name: row.get(4)?,
        teacher_name: row.get(5)?,
        day_of_week: row.get(6)?,
        start_time: row.get(7)?,
        end_time: row.get(8)?,
        monthly_fee_cents: row.get(9)?,
        start_date: row.get(10)?,
        end_date: row.get(11)?,
        status: row.get(12)?,
    })
}

/// Active groups the student is not enrolled in yet (optionally per level).
pub fn available_groups(
    conn: &Connection,
    student_id: i64,
    level_id: Option<i64>,
) -> Result<Vec<GroupRow>, String> {
    super::groups::available_groups_for_student(conn, student_id, level_id)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_enroll_student(
    db: State<'_, Db>,
    student_id: i64,
    group_id: i64,
    start_date: String,
) -> Result<EnrollmentResult, String> {
    let conn = db.conn();
    let item = BatchEnrollmentInput { student_id, group_id, start_date, custom_monthly_fee_cents: None };
    enroll_student_batch_details(&conn, &[item]).map(|mut rows| rows.remove(0))
}

#[tauri::command]
pub fn cmd_enroll_student_batch(
    db: State<'_, Db>,
    enrollments: Vec<BatchEnrollmentInput>,
) -> Result<Vec<EnrollmentResult>, String> {
    let conn = db.conn();
    enroll_student_batch_details(&conn, &enrollments)
}

#[tauri::command]
pub fn cmd_end_enrollment(db: State<'_, Db>, enrollment_id: i64) -> Result<(), String> {
    let conn = db.conn();
    end_enrollment(&conn, enrollment_id)
}

#[tauri::command]
pub fn cmd_get_student_enrollments(
    db: State<'_, Db>,
    student_id: i64,
) -> Result<Vec<StudentEnrollment>, String> {
    let conn = db.conn();
    student_enrollments(&conn, student_id)
}

#[tauri::command]
pub fn cmd_get_available_groups_for_student(
    db: State<'_, Db>,
    student_id: i64,
    level_id: Option<i64>,
) -> Result<Vec<GroupRow>, String> {
    let conn = db.conn();
    available_groups(&conn, student_id, level_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::groups::{create_group, CreateGroupInput};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn group(conn: &Connection, fee: i64, capacity: i32, day: &str) -> i64 {
        let input = CreateGroupInput {
            name: None,
            subject_id: 1,
            level_id: 10,
            branch_id: None,
            teacher_id: None,
            school_year_id: 1,
            day_of_week: day.to_string(),
            start_time: "16:00".to_string(),
            end_time: "18:00".to_string(),
            room: None,
            monthly_fee_cents: fee,
            capacity,
            schedules: None,
        };
        create_group(conn, &input).unwrap()
    }

    fn student(conn: &Connection, name: &str, phone: &str) -> i64 {
        conn.execute(
            "INSERT INTO students (full_name, phone, status) VALUES (?1, ?2, 'actif')",
            params![name, phone],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn invoice_of(conn: &Connection, enrollment_id: i64) -> (i64, i64, i64, String, String) {
        conn.query_row(
            "SELECT id, period_month, period_year, due_date, status
             FROM invoices WHERE enrollment_id = ?1",
            params![enrollment_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap()
    }

    #[test]
    fn enrollment_fee_is_created_on_first_enrollment_and_can_be_paid() {
        let conn = test_conn();
        super::super::settings::set_enrollment_fee(&conn, 20_000).unwrap();
        let g = group(&conn, 30_000, 10, "Lundi");
        let s = student(&conn, "Test Fee", "0612345678");
        conn.execute("UPDATE students SET enrollment_fee_cents=20000 WHERE id=?1", params![s]).unwrap();
        let rows = enroll_student_batch_details(&conn, &[BatchEnrollmentInput { student_id:s, group_id:g, start_date:"2026-09-01".into(), custom_monthly_fee_cents: None }]).unwrap();
        let fee = rows[0].enrollment_fee_invoice_id.unwrap();
        assert_eq!(rows[0].enrollment_fee_amount_cents, Some(20_000));
        let invoices = super::super::invoices::student_invoices(&conn, s).unwrap();
        let charge = invoices.iter().find(|i| i.id == fee).unwrap();
        assert_eq!(charge.kind, "enrollment_fee");
        assert_eq!(charge.amount_cents, 20_000);
        let stored: (i64, String, i64, i64) = conn.query_row("SELECT i.amount_cents, i.type, f.student_id, f.school_year_id FROM invoices i JOIN enrollment_fees f ON f.invoice_id=i.id WHERE i.id=?1", params![fee], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(stored, (20_000, "frais_inscription".to_string(), s, 1));
        let payment = super::super::payments::record_payment(&conn, s, &[fee], 5_000, "espèces", None).unwrap();
        let partial = super::super::invoices::student_invoices(&conn, s).unwrap();
        assert_eq!(partial.iter().find(|i| i.id == fee).unwrap().status, "partiel");
        let receipt = super::super::payments::create_receipt(&conn, payment).unwrap();
        let data = super::super::payments::receipt_data(&conn, receipt).unwrap();
        assert_eq!(data.items[0].kind, "enrollment_fee");
        assert_eq!(data.items[0].amount, 5_000);
        assert_eq!(super::super::dashboard::revenue_of(&conn, Local::now().month() as i32, Local::now().year()).unwrap(), 5_000);
        let export = super::super::year_export::data(&conn, 1, "payments").unwrap();
        assert_eq!(export[0].get("invoice_kind").unwrap(), "enrollment_fee");
        super::super::payments::record_payment(&conn, s, &[fee], 15_000, "espèces", None).unwrap();
        assert_eq!(super::super::invoices::student_invoices(&conn, s).unwrap().iter().find(|i| i.id == fee).unwrap().status, "payé");
    }

    #[test]
    fn enrollment_fee_is_unique_in_same_year_and_zero_skips_it() {
        let conn = test_conn();
        super::super::settings::set_enrollment_fee(&conn, 20_000).unwrap();
        let s = student(&conn, "Test Once", "0612345678");
        conn.execute("UPDATE students SET enrollment_fee_cents=20000 WHERE id=?1", params![s]).unwrap();
        let a = group(&conn, 10_000, 10, "Lundi");
        let b = group(&conn, 10_000, 10, "Mardi");
        let inputs = [BatchEnrollmentInput { student_id:s, group_id:a, start_date:"2026-09-01".into(), custom_monthly_fee_cents: None }, BatchEnrollmentInput { student_id:s, group_id:b, start_date:"2026-09-01".into(), custom_monthly_fee_cents: None }];
        let rows = enroll_student_batch_details(&conn, &inputs).unwrap();
        assert!(rows[0].enrollment_fee_invoice_id.is_some());
        assert!(rows[1].enrollment_fee_invoice_id.is_none());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM enrollment_fees WHERE student_id=?1", params![s], |r| r.get::<_, i64>(0)).unwrap(), 1);
        super::super::settings::set_enrollment_fee(&conn, 0).unwrap();
        let other = student(&conn, "No Fee", "0612345679");
        enroll_student(&conn, other, a, "2026-09-01").unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM enrollment_fees WHERE student_id=?1", params![other], |r| r.get::<_, i64>(0)).unwrap(), 0);
        super::super::settings::set_enrollment_fee(&conn, 20_000).unwrap();
        super::super::trash::delete_group_data(&conn, a).unwrap();
        let result = enroll_student_batch_details(&conn, &[BatchEnrollmentInput { student_id:other, group_id:b, start_date:"2026-09-01".into(), custom_monthly_fee_cents: None }]).unwrap();
        assert!(result[0].enrollment_fee_invoice_id.is_none(), "zero decision survives deleting the first group");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM enrollment_fees WHERE student_id=?1", params![other], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn enrollment_fee_is_new_and_independently_configured_next_year() {
        let conn = test_conn();
        super::super::settings::set_enrollment_fee(&conn, 20_000).unwrap();
        let s = student(&conn, "Test Year", "0612345678");
        conn.execute("UPDATE students SET enrollment_fee_cents=20000 WHERE id=?1", params![s]).unwrap();
        let a = group(&conn, 10_000, 10, "Lundi");
        enroll_student(&conn, s, a, "2026-09-01").unwrap();
        conn.execute("INSERT INTO school_years (label,start_date,end_date,is_active) VALUES ('2030-2031','2030-09-01','2031-06-30',0)", []).unwrap();
        let next = conn.last_insert_rowid();
        conn.execute("UPDATE school_years SET is_active=(id=?1)", params![next]).unwrap();
        assert_eq!(super::super::settings::enrollment_fee(&conn).unwrap(), 0);
        super::super::settings::set_enrollment_fee(&conn, 30_000).unwrap();
        conn.execute("UPDATE students SET enrollment_fee_cents=30000 WHERE id=?1", params![s]).unwrap();
        conn.execute("INSERT INTO groups(subject_id,level_id,school_year_id,monthly_fee_cents,capacity,status) VALUES (1,10,?1,10000,10,'actif')", params![next]).unwrap();
        let b = conn.last_insert_rowid();
        enroll_student(&conn, s, b, "2030-09-01").unwrap();
        let fees = super::super::invoices::student_invoices(&conn, s).unwrap();
        assert_eq!(fees.iter().filter(|i| i.kind == "enrollment_fee").count(), 1);
        assert_eq!(fees.iter().find(|i| i.kind == "enrollment_fee").unwrap().amount_cents, 30_000);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM enrollment_fees WHERE student_id=?1", params![s], |r| r.get::<_, i64>(0)).unwrap(), 2);
        conn.execute("UPDATE school_years SET is_active=(id=1)", []).unwrap();
        assert_eq!(super::super::settings::enrollment_fee(&conn).unwrap(), 20_000);
    }

    #[test]
    fn due_date_clamps_to_the_end_of_the_month() {
        // Jan 31 -> Feb 28 (29 on leap years)
        assert_eq!(adjust_due_date(2026, 2, 31), "2026-02-28");
        assert_eq!(adjust_due_date(2028, 2, 31), "2028-02-29");
        // Jan 30 -> Feb 28 / Feb 29 in 2028
        assert_eq!(adjust_due_date(2026, 2, 30), "2026-02-28");
        assert_eq!(adjust_due_date(2028, 2, 30), "2028-02-29");
        // March 31 -> April 30
        assert_eq!(adjust_due_date(2026, 4, 31), "2026-04-30");
        // May 31 -> June 30
        assert_eq!(adjust_due_date(2026, 6, 31), "2026-06-30");
        // Regular days are untouched
        assert_eq!(adjust_due_date(2026, 3, 15), "2026-03-15");
        assert_eq!(adjust_due_date(2026, 12, 31), "2026-12-31");

        assert!(is_leap_year(2024));
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2026));
        assert_eq!(last_day_of_month(2026, 2), 28);
        assert_eq!(last_day_of_month(2024, 2), 29);
        assert_eq!(last_day_of_month(2026, 4), 30);
    }

    #[test]
    fn enrolling_generates_the_first_invoice_with_the_adjusted_due_date() {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 10, "Lundi");
        let student_id = student(&conn, "Yassine El Amrani", "0612345678");

        let id = enroll_student(&conn, student_id, group_id, "2026-01-31").unwrap();

        let (_, month, year, due_date, status) = invoice_of(&conn, id);
        assert_eq!(month, 1);
        assert_eq!(year, 2026);
        assert_eq!(
            due_date, "2026-01-31",
            "the first invoice is due the enrollment day"
        );
        assert_eq!(status, "impayé");

        let amount: i64 = conn
            .query_row(
                "SELECT amount_cents FROM invoices WHERE enrollment_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(amount, 30_000, "full month, no prorata");
        let paid: i64 = conn
            .query_row(
                "SELECT paid_amount_cents FROM invoices WHERE enrollment_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(paid, 0);

        let (action, entity_type, entity_id): (String, String, i64) = conn
            .query_row(
                "SELECT action, entity_type, entity_id FROM audit_log WHERE entity_type='enrollment'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (action.as_str(), entity_type.as_str(), entity_id),
            ("ENROLL", "enrollment", id)
        );
    }

    #[test]
    fn a_february_enrollment_is_due_on_the_clamped_day() {
        let conn = test_conn();
        let group_id = group(&conn, 25_000, 10, "Mardi");
        let student_id = student(&conn, "Salma Benjelloun", "0723456789");

        // Enrolled on 30 January: the January invoice is due 30 January.
        let id = enroll_student(&conn, student_id, group_id, "2026-01-30").unwrap();
        assert_eq!(invoice_of(&conn, id).3, "2026-01-30");

        // Enrolled on 31 March: due 31 March, and the *next* month's invoice is
        // what the clamp is for — checked directly through the helper.
        let other = group(&conn, 25_000, 10, "Jeudi");
        let second = enroll_student(&conn, student_id, other, "2026-03-31").unwrap();
        assert_eq!(invoice_of(&conn, second).3, "2026-03-31");
        assert_eq!(adjust_due_date(2026, 4, 31), "2026-04-30");
    }

    #[test]
    fn duplicate_enrollment_is_rejected_then_reenrollment_after_end_works() {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 10, "Lundi");
        let student_id = student(&conn, "Omar Tazi", "0698765432");

        let first = enroll_student(&conn, student_id, group_id, "2026-01-05").unwrap();
        assert_eq!(
            enroll_student(&conn, student_id, group_id, "2026-01-05").unwrap_err(),
            "Déjà inscrit dans ce groupe"
        );
        assert_eq!(
            count_rows(&conn, "SELECT COUNT(*) FROM enrollments"),
            1,
            "the duplicate attempt must not insert anything"
        );

        end_enrollment(&conn, first).unwrap();
        let again = enroll_student(&conn, student_id, group_id, "2026-04-02").unwrap();
        assert_eq!(again, first, "the same row is reactivated (UNIQUE pair)");
        assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM enrollments"), 1);

        let (status, start, end): (String, String, Option<String>) = conn
            .query_row(
                "SELECT status, start_date, end_date FROM enrollments WHERE id = ?1",
                params![again],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "actif");
        assert_eq!(start, "2026-04-02");
        assert_eq!(end, None);
    }

    #[test]
    fn a_full_group_refuses_new_students() {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 1, "Lundi");
        let first = student(&conn, "Salma Benjelloun", "0723456789");
        let second = student(&conn, "Omar Tazi", "0698765432");

        enroll_student(&conn, first, group_id, "2026-01-05").unwrap();
        assert_eq!(
            enroll_student(&conn, second, group_id, "2026-01-05").unwrap_err(),
            "Groupe complet"
        );
    }

    #[test]
    fn inactive_students_and_groups_cannot_enroll() {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 10, "Lundi");
        let student_id = student(&conn, "Nadia Chraibi", "0655443322");

        conn.execute(
            "UPDATE students SET status='inactif' WHERE id = ?1",
            params![student_id],
        )
        .unwrap();
        assert_eq!(
            enroll_student(&conn, student_id, group_id, "2026-01-05").unwrap_err(),
            "Cet élève est inactif : impossible de l'inscrire"
        );

        conn.execute(
            "UPDATE students SET status='actif' WHERE id = ?1",
            params![student_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE groups SET status='inactif' WHERE id = ?1",
            params![group_id],
        )
        .unwrap();
        assert_eq!(
            enroll_student(&conn, student_id, group_id, "2026-01-05").unwrap_err(),
            "Ce groupe est inactif : impossible d'y inscrire un élève"
        );

        assert_eq!(
            enroll_student(&conn, 999, group_id, "2026-01-05").unwrap_err(),
            "Élève introuvable"
        );
        assert_eq!(
            enroll_student(&conn, student_id, 999, "2026-01-05").unwrap_err(),
            "Groupe introuvable"
        );
        assert_eq!(
            enroll_student(&conn, student_id, group_id, "05/01/2026").unwrap_err(),
            "Date d'inscription invalide (format attendu AAAA-MM-JJ)"
        );
    }

    #[test]
    fn custom_fee_is_used_for_new_invoices_without_rewriting_history() {
        let conn = test_conn();
        let g = group(&conn, 30_000, 10, "Lundi");
        let s = student(&conn, "Salma Test", "0612345678");
        let input = BatchEnrollmentInput { student_id: s, group_id: g, start_date: "2026-09-01".into(), custom_monthly_fee_cents: Some(17_500) };
        let id = enroll_student_batch_details(&conn, &[input]).unwrap()[0].id;
        super::super::invoices::generate_monthly_invoices(&conn, 10, 2026).unwrap();
        conn.execute("UPDATE enrollments SET custom_monthly_fee_cents=20000 WHERE id=?1", params![id]).unwrap();
        super::super::invoices::generate_monthly_invoices(&conn, 10, 2026).unwrap();
        super::super::invoices::generate_monthly_invoices(&conn, 11, 2026).unwrap();
        let invoices = super::super::invoices::student_invoices(&conn, s).unwrap();
        assert_eq!(invoices.iter().map(|i| i.amount_cents).collect::<Vec<_>>(), vec![20_000, 17_500, 17_500]);
    }

    #[test]
    fn batch_enrollment_creates_every_row_and_the_invoices() {
        let conn = test_conn();
        let maths = group(&conn, 30_000, 10, "Lundi");
        let physique = group(&conn, 25_000, 10, "Mercredi");
        let student_id = student(&conn, "Yassine El Amrani", "0612345678");

        // "d9a wehda": three groups, same day.
        let ids = enroll_student_batch(
            &conn,
            &[
                BatchEnrollmentInput {
                    student_id,
                    group_id: maths,
                    start_date: "2026-09-15".to_string(),
                    custom_monthly_fee_cents: None,
                },
                BatchEnrollmentInput {
                    student_id,
                    group_id: physique,
                    start_date: "2026-09-15".to_string(),
                    custom_monthly_fee_cents: None,
                },
            ],
        )
        .unwrap();

        assert_eq!(ids.len(), 2);
        assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM enrollments"), 2);
        assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM invoices"), 2);
        assert_eq!(
            count_rows(
                &conn,
                "SELECT COUNT(*) FROM audit_log WHERE action='ENROLL'"
            ),
            2
        );
        // Every invoice is due the same day, full month.
        let due: Vec<String> = ids.iter().map(|id| invoice_of(&conn, *id).3).collect();
        assert_eq!(due, vec!["2026-09-15", "2026-09-15"]);
    }

    #[test]
    fn batch_enrollment_is_atomic_and_supports_different_dates() {
        let conn = test_conn();
        let first = group(&conn, 30_000, 10, "Lundi");
        let second = group(&conn, 25_000, 10, "Mercredi");
        let student_id = student(&conn, "Salma Benjelloun", "0723456789");

        // "ayam mkhtalfa": two groups, two start dates.
        let ids = enroll_student_batch(
            &conn,
            &[
                BatchEnrollmentInput {
                    student_id,
                    group_id: first,
                    start_date: "2026-01-31".to_string(),
                    custom_monthly_fee_cents: None,
                },
                BatchEnrollmentInput {
                    student_id,
                    group_id: second,
                    start_date: "2026-02-10".to_string(),
                    custom_monthly_fee_cents: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(ids.len(), 2);
        assert_eq!(invoice_of(&conn, ids[0]).3, "2026-01-31");
        assert_eq!(invoice_of(&conn, ids[1]).3, "2026-02-10");

        // A failing item rolls the whole batch back.
        let other_student = student(&conn, "Omar Tazi", "0698765432");
        let result = enroll_student_batch(
            &conn,
            &[
                BatchEnrollmentInput {
                    student_id: other_student,
                    group_id: second,
                    start_date: "2026-03-01".to_string(),
                    custom_monthly_fee_cents: None,
                },
                // Already enrolled -> the second insert must not survive.
                BatchEnrollmentInput {
                    student_id,
                    group_id: first,
                    start_date: "2026-03-01".to_string(),
                    custom_monthly_fee_cents: None,
                },
            ],
        );
        assert_eq!(result.unwrap_err(), "Déjà inscrit dans ce groupe");
        assert_eq!(
            count_rows(&conn, "SELECT COUNT(*) FROM enrollments"),
            2,
            "the first item of the failed batch was rolled back"
        );
        assert_eq!(
            count_rows(&conn, "SELECT COUNT(*) FROM invoices"),
            2,
            "no orphan invoice either"
        );
        assert!(
            conn.query_row(
                "SELECT COUNT(*) FROM enrollments WHERE student_id = ?1",
                params![other_student],
                |row| row.get::<_, i64>(0)
            )
            .unwrap()
                == 0
        );
    }

    #[test]
    fn empty_batch_is_rejected() {
        let conn = test_conn();
        assert_eq!(
            enroll_student_batch(&conn, &[]).unwrap_err(),
            "Aucune inscription sélectionnée"
        );
    }

    #[test]
    fn ending_keeps_the_current_month_invoice() {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 10, "Lundi");
        let student_id = student(&conn, "Yassine El Amrani", "0612345678");
        let enrollment_id = enroll_student(&conn, student_id, group_id, "2026-01-31").unwrap();

        let before = invoice_of(&conn, enrollment_id);
        end_enrollment(&conn, enrollment_id).unwrap();
        let after = invoice_of(&conn, enrollment_id);
        assert_eq!(before, after, "the invoice is neither deleted nor refunded");

        let (status, end_date): (String, Option<String>) = conn
            .query_row(
                "SELECT status, end_date FROM enrollments WHERE id = ?1",
                params![enrollment_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "terminé");
        assert!(end_date.is_some());

        let action: String = conn
            .query_row(
                "SELECT action FROM audit_log WHERE entity_type='enrollment' ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(action, "END_ENROLLMENT");

        assert_eq!(
            end_enrollment(&conn, enrollment_id).unwrap_err(),
            "Cette inscription est déjà terminée"
        );
        assert_eq!(
            end_enrollment(&conn, 999).unwrap_err(),
            "Inscription introuvable"
        );
    }

    #[test]
    fn student_enrollments_join_labels_and_sort_newest_first() {
        let conn = test_conn();
        let maths = group(&conn, 30_000, 10, "Lundi");
        let physique = group(&conn, 25_000, 10, "Mercredi");
        let student_id = student(&conn, "Hind Ouazzani", "0712345678");

        enroll_student(&conn, student_id, maths, "2026-01-10").unwrap();
        enroll_student(&conn, student_id, physique, "2026-02-20").unwrap();
        let list = student_enrollments(&conn, student_id).unwrap();

        assert_eq!(list.len(), 2);
        assert_eq!(list[0].start_date, "2026-02-20", "newest first");
        assert_eq!(list[0].subject_name, "Mathématiques");
        assert_eq!(list[0].level_name, "Tronc Commun");
        assert_eq!(list[0].day_of_week, "Mercredi");
        assert_eq!(list[0].monthly_fee_cents, 25_000);
        assert_eq!(list[0].status, "actif");
        assert_eq!(list[0].end_date, None);

        assert!(student_enrollments(&conn, 999).unwrap().is_empty());
    }

    #[test]
    fn available_groups_ignore_full_groups_only_when_asked() {
        let conn = test_conn();
        let full = group(&conn, 30_000, 1, "Lundi");
        let open = group(&conn, 25_000, 5, "Mardi");
        let student_id = student(&conn, "Hind Ouazzani", "0712345678");
        let other = student(&conn, "Omar Tazi", "0698765432");

        enroll_student(&conn, other, full, "2026-01-10").unwrap();

        // Both are "available" for the student (the UI disables the full one).
        let groups = available_groups(&conn, student_id, None).unwrap();
        assert_eq!(groups.len(), 2);
        let full_row = groups.iter().find(|group| group.id == full).unwrap();
        assert_eq!(full_row.enrolled_count, 1);
        assert_eq!(full_row.capacity, 1);

        enroll_student(&conn, student_id, open, "2026-01-10").unwrap();
        let groups = available_groups(&conn, student_id, None).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, full);
    }

    #[test]
    fn counts_helper() {
        // `count_rows` is used above; keep one direct assertion on it.
        let conn = test_conn();
        assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM groups"), 0);
        group(&conn, 10_000, 4, "Dimanche");
        assert_eq!(count_rows(&conn, "SELECT COUNT(*) FROM groups"), 1);
    }

    fn count_rows(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }
}
