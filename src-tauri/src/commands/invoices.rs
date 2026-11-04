//! Invoicing commands (Phase 5).
//!
//! The model is **prepaid, without prorata**: every active enrollment owes the
//! group's full monthly fee, whatever the day the student joined. Enrolling
//! already creates the invoice of the enrollment month (Phase 4); this module
//! generates the *following* months and exposes the money picture:
//!
//! * [`generate_monthly_invoices`] — one invoice per active enrollment and per
//!   month, idempotent (the `UNIQUE (enrollment_id, period_month, period_year)`
//!   constraint is the safety net).
//! * [`student_invoices`] — every invoice of one student, joined labels included.
//! * [`payment_alerts`] — the three collections buckets: late, due within three
//!   days, and settled.

use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, Connection};
use serde_json::json;
use tauri::State;

use super::db_err;
use super::enrollments::adjust_due_date;
use crate::db::Db;
use crate::models::{InvoiceAlert, PaymentAlerts, StudentInvoice};

const ENTITY_TYPE: &str = "invoice";

/// Bucket size for the "Proches" section: invoices due within 3 days.
pub const UPCOMING_WINDOW_DAYS: i64 = 3;

pub fn parse_iso_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok()
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Reference-data month label used by receipts ("Octobre 2025").
pub fn french_month_name(month: i32) -> &'static str {
    match month {
        1 => "Janvier",
        2 => "Février",
        3 => "Mars",
        4 => "Avril",
        5 => "Mai",
        6 => "Juin",
        7 => "Juillet",
        8 => "Août",
        9 => "Septembre",
        10 => "Octobre",
        11 => "Novembre",
        12 => "Décembre",
        _ => "",
    }
}

// ---------------------------------------------------------------------------
// Monthly generation
// ---------------------------------------------------------------------------

/// Create the invoices of `month`/`year` for every **active** enrollment.
///
/// Existing `(enrollment_id, month, year)` rows are skipped, so running the
/// command twice never duplicates anything. The due date keeps the enrollment
/// day, clamped to the end of the month (`31 janvier` → `28 février`).
///
/// Returns the number of invoices created.
pub fn generate_monthly_invoices(conn: &Connection, month: i32, year: i32) -> Result<i32, String> {
    if !(1..=12).contains(&month) {
        return Err("Mois invalide".to_string());
    }
    if !(2000..=2100).contains(&year) {
        return Err("Année invalide".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    let rows: Vec<(i64, String, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT e.id, e.start_date, g.monthly_fee_cents
                 FROM enrollments e
                 JOIN groups g ON g.id = e.group_id
                 JOIN students st ON st.id = e.student_id
                 WHERE g.deleted_at IS NULL AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND st.deleted_at IS NULL AND COALESCE(e.status, 'actif') = 'actif'
                 ORDER BY e.id",
            )
            .map_err(|err| db_err("Lecture des inscriptions", err))?;
        let mapped = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|err| db_err("Lecture des inscriptions", err))?;
        mapped
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|err| db_err("Lecture des inscriptions", err))?
    };

    let mut created = 0_i32;
    for (enrollment_id, start_date, monthly_fee_cents) in rows {
        let already_there: bool = tx
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM invoices
                    WHERE enrollment_id = ?1 AND period_month = ?2 AND period_year = ?3
                 )",
                params![enrollment_id, month, year],
                |row| row.get(0),
            )
            .map_err(|err| db_err("Lecture de la facture", err))?;
        if already_there {
            continue;
        }

        // The enrollment day drives the due date; an unparsable start date
        // falls back to the first of the month rather than dropping the invoice.
        let day = parse_iso_date(&start_date)
            .map(|date| date.day() as i32)
            .unwrap_or(1);
        let due_date = adjust_due_date(year, month, day);

        tx.execute(
            "INSERT INTO invoices
                (enrollment_id, period_month, period_year, amount_cents, paid_amount_cents, status, due_date)
             VALUES (?1, ?2, ?3, ?4, 0, 'impayé', ?5)",
            params![enrollment_id, month, year, monthly_fee_cents, due_date],
        )
        .map_err(|err| db_err("Création de la facture", err))?;
        created += 1;
    }

    tx.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('GENERATE_INVOICES', ?1, NULL, ?2)",
        params![
            ENTITY_TYPE,
            json!({ "month": month, "year": year, "count": created }).to_string()
        ],
    )
    .map_err(|err| db_err("Journalisation de l'audit", err))?;

    tx.commit()
        .map_err(|err| db_err("Validation de la génération", err))?;

    Ok(created)
}

// ---------------------------------------------------------------------------
// Student invoices
// ---------------------------------------------------------------------------

/// Every invoice of one student, newest period first.
pub fn student_invoices(conn: &Connection, student_id: i64) -> Result<Vec<StudentInvoice>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id,
                    i.enrollment_id,
                    COALESCE(su.name, ''),
                    COALESCE(l.name, ''),
                    b.name,
                    COALESCE(i.period_month, 0),
                    COALESCE(i.period_year, 0),
                    i.amount_cents,
                    COALESCE(i.paid_amount_cents, 0),
                    COALESCE(i.status, 'impayé'),
                    COALESCE(i.due_date, '')
             FROM invoices i
             JOIN enrollments e ON e.id = i.enrollment_id
             JOIN groups g      ON g.id = e.group_id
             LEFT JOIN subjects su ON su.id = g.subject_id
             LEFT JOIN levels l    ON l.id = g.level_id
             LEFT JOIN branches b  ON b.id = g.branch_id
             WHERE e.student_id = ?1 AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)
             ORDER BY i.period_year DESC, i.period_month DESC, i.id DESC",
        )
        .map_err(|err| db_err("Lecture des factures", err))?;

    let mapped = stmt
        .query_map(params![student_id], |row| {
            let amount: i64 = row.get(7)?;
            let paid: i64 = row.get(8)?;
            Ok(StudentInvoice {
                id: row.get(0)?,
                enrollment_id: row.get(1)?,
                group_subject: row.get(2)?,
                group_level: row.get(3)?,
                group_branch: row.get(4)?,
                period_month: row.get(5)?,
                period_year: row.get(6)?,
                amount_cents: amount,
                paid_amount_cents: paid,
                remaining_cents: (amount - paid).max(0),
                status: row.get(9)?,
                due_date: row.get(10)?,
            })
        })
        .map_err(|err| db_err("Lecture des factures", err))?;

    mapped
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des factures", err))
}

// ---------------------------------------------------------------------------
// Collections dashboard
// ---------------------------------------------------------------------------

/// Per-student aggregation of one month's invoices.
struct StudentMonth {
    student_id: i64,
    student_name: String,
    student_phone: String,
    groups: Vec<String>,
    total_amount_cents: i64,
    total_paid_cents: i64,
    /// Earliest due date among the unpaid invoices.
    earliest_unpaid_due: Option<NaiveDate>,
    earliest_due: Option<NaiveDate>,
}

/// The three buckets of the Payments page, computed against `reference_day`.
pub fn payment_alerts_on(
    conn: &Connection,
    month: i32,
    year: i32,
    reference_day: NaiveDate,
) -> Result<PaymentAlerts, String> {
    if !(1..=12).contains(&month) {
        return Err("Mois invalide".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT s.id,
                    s.full_name,
                    COALESCE(s.phone, ''),
                    COALESCE(su.name, ''),
                    COALESCE(l.name, ''),
                    i.amount_cents,
                    COALESCE(i.paid_amount_cents, 0),
                    COALESCE(i.status, 'impayé'),
                    COALESCE(i.due_date, '')
             FROM invoices i
             JOIN enrollments e ON e.id = i.enrollment_id
             JOIN students s    ON s.id = e.student_id
             JOIN groups g      ON g.id = e.group_id
             LEFT JOIN subjects su ON su.id = g.subject_id
             LEFT JOIN levels l    ON l.id = g.level_id
             WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND i.period_month = ?1 AND i.period_year = ?2
             ORDER BY s.id, i.due_date, i.id",
        )
        .map_err(|err| db_err("Lecture des factures", err))?;

    let rows = stmt
        .query_map(params![month, year], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(|err| db_err("Lecture des factures", err))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des factures", err))?;

    // Fold the flat rows into one accumulator per student, keeping the input
    // order (already sorted by student) so the buckets stay stable.
    let mut students: Vec<StudentMonth> = Vec::new();
    for (student_id, name, phone, subject, level, amount, paid, status, due_date) in rows {
        let index = match students.iter().position(|s| s.student_id == student_id) {
            Some(index) => index,
            None => {
                students.push(StudentMonth {
                    student_id,
                    student_name: name,
                    student_phone: phone,
                    groups: Vec::new(),
                    total_amount_cents: 0,
                    total_paid_cents: 0,
                    earliest_unpaid_due: None,
                    earliest_due: None,
                });
                students.len() - 1
            }
        };

        let student = &mut students[index];
        let label = if level.is_empty() {
            subject.clone()
        } else if subject.is_empty() {
            level.clone()
        } else {
            format!("{subject} {level}")
        };
        if !label.trim().is_empty() && !student.groups.contains(&label) {
            student.groups.push(label);
        }

        student.total_amount_cents += amount;
        student.total_paid_cents += paid;

        if let Some(date) = parse_iso_date(&due_date) {
            student.earliest_due = Some(
                student
                    .earliest_due
                    .map_or(date, |current| current.min(date)),
            );
            let unsettled = paid < amount && status != "payé";
            if unsettled {
                student.earliest_unpaid_due = Some(
                    student
                        .earliest_unpaid_due
                        .map_or(date, |current| current.min(date)),
                );
            }
        }
    }

    let mut late: Vec<InvoiceAlert> = Vec::new();
    let mut upcoming: Vec<InvoiceAlert> = Vec::new();
    let mut current: Vec<InvoiceAlert> = Vec::new();

    for student in students {
        let total_due = (student.total_amount_cents - student.total_paid_cents).max(0);

        let (last_payment_date, last_payment_method) =
            last_payment_of_month(conn, student.student_id, month, year)?;

        let (due_date, days_late) = if let Some(unpaid_due) = student.earliest_unpaid_due {
            let days = (reference_day - unpaid_due).num_days() as i32;
            (unpaid_due.format("%Y-%m-%d").to_string(), days)
        } else {
            let due = student
                .earliest_due
                .map(|date| date.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            (due, 0)
        };

        let alert = InvoiceAlert {
            student_id: student.student_id,
            student_name: student.student_name,
            student_phone: student.student_phone,
            groups: student.groups.join(", "),
            total_due_cents: total_due,
            total_paid_cents: student.total_paid_cents,
            due_date,
            days_late,
            last_payment_date,
            last_payment_method,
        };

        if total_due <= 0 {
            current.push(alert);
        } else if days_late > 0 {
            late.push(alert);
        } else if days_late >= -(UPCOMING_WINDOW_DAYS as i32) {
            upcoming.push(alert);
        }
        // Otherwise: due later than the 3-day window — not actionable yet, so
        // it is intentionally absent from the dashboard.
    }

    // Most overdue first.
    late.sort_by(|a, b| {
        b.days_late
            .cmp(&a.days_late)
            .then(a.student_name.cmp(&b.student_name))
    });
    // Soonest first (days_late is negative for upcoming invoices).
    upcoming.sort_by(|a, b| {
        a.days_late
            .cmp(&b.days_late)
            .then(a.student_name.cmp(&b.student_name))
    });
    current.sort_by(|a, b| a.student_name.cmp(&b.student_name));

    Ok(PaymentAlerts {
        late,
        upcoming,
        current,
    })
}

/// Latest payment recorded against this month's invoices, if any.
fn last_payment_of_month(
    conn: &Connection,
    student_id: i64,
    month: i32,
    year: i32,
) -> Result<(Option<String>, Option<String>), String> {
    conn.query_row(
        "SELECT p.created_at, COALESCE(p.payment_method, '')
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN enrollments e ON e.id=i.enrollment_id JOIN groups g ON g.id=e.group_id
         WHERE g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) AND p.student_id = ?1 AND i.period_month = ?2 AND i.period_year = ?3
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1",
        params![student_id, month, year],
        |row| {
            Ok((
                Some(row.get::<_, String>(0)?),
                Some(row.get::<_, String>(1)?),
            ))
        },
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok((None, None)),
        other => Err(db_err("Lecture des paiements", other)),
    })
}

/// How many invoices are overdue, **across every period**.
///
/// The sidebar badge must not be limited to the current month: a September
/// invoice that is still unpaid in November is exactly what the owner has to
/// chase, and the current month often has no due date yet (bills are due at the
/// end of the month). An invoice counts once, whatever its remaining balance.
pub fn late_payment_count_on(conn: &Connection, reference_day: NaiveDate) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*)
         FROM invoices i
         JOIN enrollments e ON e.id = i.enrollment_id
         JOIN students s ON s.id = e.student_id
         JOIN groups g ON g.id = e.group_id
         WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)
           AND COALESCE(i.status, 'impayé') <> 'payé'
           AND COALESCE(i.paid_amount_cents, 0) < i.amount_cents
           AND COALESCE(i.due_date, '') <> ''
           AND i.due_date < ?1",
        params![reference_day.format("%Y-%m-%d").to_string()],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture des factures en retard", err))
}

/// [`late_payment_count_on`] against the real current date.
pub fn late_payment_count(conn: &Connection) -> Result<i64, String> {
    late_payment_count_on(conn, today())
}

/// [`payment_alerts_on`] against the real current date.
pub fn payment_alerts(conn: &Connection, month: i32, year: i32) -> Result<PaymentAlerts, String> {
    payment_alerts_on(conn, month, year, today())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_generate_monthly_invoices(
    db: State<'_, Db>,
    month: i32,
    year: i32,
) -> Result<i32, String> {
    let conn = db.conn();
    generate_monthly_invoices(&conn, month, year)
}

#[tauri::command]
pub fn cmd_get_student_invoices(
    db: State<'_, Db>,
    student_id: i64,
) -> Result<Vec<StudentInvoice>, String> {
    let conn = db.conn();
    student_invoices(&conn, student_id)
}

#[tauri::command]
pub fn cmd_get_late_payment_count(db: State<'_, Db>) -> Result<i64, String> {
    let conn = db.conn();
    late_payment_count(&conn)
}

#[tauri::command]
pub fn cmd_get_payment_alerts(
    db: State<'_, Db>,
    month: i32,
    year: i32,
) -> Result<PaymentAlerts, String> {
    let conn = db.conn();
    payment_alerts(&conn, month, year)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::enrollments::{end_enrollment, enroll_student};
    use crate::commands::groups::{create_group, CreateGroupInput};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn group(conn: &Connection, fee: i64) -> i64 {
        create_group(
            conn,
            &CreateGroupInput {
                subject_id: 1,
                level_id: 10,
                branch_id: None,
                teacher_id: None,
                school_year_id: 1,
                day_of_week: "Lundi".to_string(),
                start_time: "16:00".to_string(),
                end_time: "18:00".to_string(),
                room: None,
                monthly_fee_cents: fee,
                capacity: 20,
                schedules: None,
            },
        )
        .unwrap()
    }

    fn student(conn: &Connection, name: &str, phone: &str) -> i64 {
        conn.execute(
            "INSERT INTO students (full_name, phone, status) VALUES (?1, ?2, 'actif')",
            params![name, phone],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn invoice_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM invoices", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn generation_creates_one_invoice_per_active_enrollment() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let g2 = group(&conn, 25_000);
        let s1 = student(&conn, "Salma", "0612345678");
        let s2 = student(&conn, "Yassine", "0612345679");

        enroll_student(&conn, s1, g1, "2026-01-10").unwrap();
        enroll_student(&conn, s1, g2, "2026-01-10").unwrap();
        enroll_student(&conn, s2, g1, "2026-01-12").unwrap();
        // Enrollment created the January invoices already.
        assert_eq!(invoice_count(&conn), 3);

        let created = generate_monthly_invoices(&conn, 2, 2026).unwrap();
        assert_eq!(created, 3);
        assert_eq!(invoice_count(&conn), 6);

        // Amounts come from the group fee, status starts unpaid.
        let row: (i64, String) = conn
            .query_row(
                "SELECT i.amount_cents, i.status FROM invoices i
                 JOIN enrollments e ON e.id = i.enrollment_id
                 WHERE e.id = 1 AND i.period_month = 2 AND i.period_year = 2026",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (30_000, "impayé".to_string()));
    }

    #[test]
    fn generation_is_idempotent() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let s1 = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s1, g1, "2026-01-10").unwrap();

        assert_eq!(generate_monthly_invoices(&conn, 3, 2026).unwrap(), 1);
        assert_eq!(generate_monthly_invoices(&conn, 3, 2026).unwrap(), 0);
        assert_eq!(invoice_count(&conn), 2);

        // One audit row per call, with the created count.
        let details: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT details FROM audit_log WHERE action = 'GENERATE_INVOICES' ORDER BY id",
                )
                .unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
            rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
        };
        assert_eq!(details.len(), 2);
        assert!(details[0].contains("\"count\":1"));
        assert!(details[1].contains("\"count\":0"));
    }

    #[test]
    fn ended_enrollments_are_not_invoiced() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let s1 = student(&conn, "Salma", "0612345678");
        let enrollment = enroll_student(&conn, s1, g1, "2026-01-10").unwrap();
        end_enrollment(&conn, enrollment).unwrap();

        assert_eq!(generate_monthly_invoices(&conn, 2, 2026).unwrap(), 0);
        // Only the January invoice created at enroll time remains.
        assert_eq!(invoice_count(&conn), 1);
    }

    #[test]
    fn generated_due_date_keeps_the_enrollment_day_and_clamps() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let s1 = student(&conn, "Salma", "0612345678");
        // Enrolled on the 31st.
        let enrollment = enroll_student(&conn, s1, g1, "2026-01-31").unwrap();

        generate_monthly_invoices(&conn, 2, 2026).unwrap();
        let due: String = conn
            .query_row(
                "SELECT due_date FROM invoices
                 WHERE enrollment_id = ?1 AND period_month = 2 AND period_year = 2026",
                params![enrollment],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(due, "2026-02-28");

        // 2028 is a leap year.
        generate_monthly_invoices(&conn, 2, 2028).unwrap();
        let due: String = conn
            .query_row(
                "SELECT due_date FROM invoices
                 WHERE enrollment_id = ?1 AND period_month = 2 AND period_year = 2028",
                params![enrollment],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(due, "2028-02-29");
    }

    #[test]
    fn invalid_period_is_rejected() {
        let conn = test_conn();
        assert!(generate_monthly_invoices(&conn, 13, 2026).is_err());
        assert!(generate_monthly_invoices(&conn, 0, 2026).is_err());
        assert!(generate_monthly_invoices(&conn, 5, 1999).is_err());
    }

    #[test]
    fn student_invoices_are_joined_and_sorted() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let s1 = student(&conn, "Salma", "0612345678");
        let enrollment = enroll_student(&conn, s1, g1, "2026-01-10").unwrap();
        generate_monthly_invoices(&conn, 3, 2026).unwrap();

        let invoices = student_invoices(&conn, s1).unwrap();
        assert_eq!(invoices.len(), 2);
        // Newest period first.
        assert_eq!(invoices[0].period_month, 3);
        assert_eq!(invoices[1].period_month, 1);
        assert_eq!(invoices[0].group_subject, "Mathématiques");
        assert_eq!(invoices[0].group_level, "Tronc Commun");
        assert_eq!(invoices[0].enrollment_id, enrollment);
        assert_eq!(invoices[0].remaining_cents, 30_000);
        assert_eq!(invoices[0].status, "impayé");
        assert_eq!(invoices[0].due_date, "2026-03-10");
    }

    #[test]
    fn alerts_split_into_late_upcoming_and_current() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);

        // Late: due yesterday.
        let late_student = student(&conn, "En retard", "0611111111");
        enroll_student(&conn, late_student, g1, "2026-03-01").unwrap();

        // Upcoming: due in two days.
        let soon_student = student(&conn, "Bientôt", "0622222222");
        enroll_student(&conn, soon_student, g1, "2026-03-05").unwrap();

        // Settled: paid in full.
        let paid_student = student(&conn, "À jour", "0633333333");
        let paid_enrollment = enroll_student(&conn, paid_student, g1, "2026-03-20").unwrap();
        conn.execute(
            "UPDATE invoices SET paid_amount_cents = amount_cents, status = 'payé'
             WHERE enrollment_id = ?1",
            params![paid_enrollment],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO payments (student_id, invoice_id, amount_cents, payment_method, created_at)
             SELECT ?1, id, amount_cents, 'espèces', '2026-03-20 10:00:00' FROM invoices
             WHERE enrollment_id = ?2",
            params![paid_student, paid_enrollment],
        )
        .unwrap();

        let reference = NaiveDate::from_ymd_opt(2026, 3, 3).unwrap();
        let alerts = payment_alerts_on(&conn, 3, 2026, reference).unwrap();

        assert_eq!(alerts.late.len(), 1);
        assert_eq!(alerts.late[0].student_name, "En retard");
        assert_eq!(alerts.late[0].days_late, 2);
        assert_eq!(alerts.late[0].total_due_cents, 30_000);

        assert_eq!(alerts.upcoming.len(), 1);
        assert_eq!(alerts.upcoming[0].student_name, "Bientôt");
        assert_eq!(alerts.upcoming[0].days_late, -2);

        assert_eq!(alerts.current.len(), 1);
        assert_eq!(alerts.current[0].student_name, "À jour");
        assert_eq!(alerts.current[0].total_due_cents, 0);
        assert_eq!(alerts.current[0].total_paid_cents, 30_000);
        assert_eq!(
            alerts.current[0].last_payment_method.as_deref(),
            Some("espèces")
        );
    }

    #[test]
    fn late_count_spans_every_period() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);

        let student_id = student(&conn, "En retard", "0611111111");
        let enrollment = enroll_student(&conn, student_id, g1, "2026-01-10").unwrap();

        // January is settled, February is fully paid, March is unpaid.
        generate_monthly_invoices(&conn, 2, 2026).unwrap();
        generate_monthly_invoices(&conn, 3, 2026).unwrap();
        conn.execute(
            "UPDATE invoices SET paid_amount_cents = amount_cents, status = 'payé'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE invoices SET paid_amount_cents = 0, status = 'impayé'
             WHERE enrollment_id = ?1 AND period_month = 3",
            params![enrollment],
        )
        .unwrap();

        // Reference day 5 April 2026: the March invoice is 5 days late and the
        // count is not limited to April (which has no invoice at all).
        let reference = NaiveDate::from_ymd_opt(2026, 4, 5).unwrap();
        assert_eq!(late_payment_count_on(&conn, reference).unwrap(), 1);

        // Before its due date it is not late yet.
        let earlier = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(late_payment_count_on(&conn, earlier).unwrap(), 0);

        // Paying it clears the badge.
        conn.execute(
            "UPDATE invoices SET paid_amount_cents = amount_cents, status = 'payé'
             WHERE enrollment_id = ?1 AND period_month = 3",
            params![enrollment],
        )
        .unwrap();
        assert_eq!(late_payment_count_on(&conn, reference).unwrap(), 0);
    }

    #[test]
    fn alerts_sort_late_by_most_overdue_first() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);

        // Both invoices belong to March; only their due dates differ.
        let a = student(&conn, "Un jour", "0611111111");
        enroll_student(&conn, a, g1, "2026-03-02").unwrap();
        let b = student(&conn, "Vingt jours", "0622222222");
        enroll_student(&conn, b, g1, "2026-03-20").unwrap();

        // Reference day: 25 March. "Un jour" is 23 days late, "Vingt jours" 5.
        let reference = NaiveDate::from_ymd_opt(2026, 3, 25).unwrap();
        let alerts = payment_alerts_on(&conn, 3, 2026, reference).unwrap();
        assert_eq!(alerts.late.len(), 2);
        assert_eq!(alerts.late[0].student_name, "Un jour");
        assert_eq!(alerts.late[0].days_late, 23);
        assert_eq!(alerts.late[1].student_name, "Vingt jours");
        assert_eq!(alerts.late[1].days_late, 5);
    }

    #[test]
    fn alerts_aggregate_several_groups_per_student() {
        let conn = test_conn();
        let g1 = group(&conn, 30_000);
        let g2 = group(&conn, 25_000);
        let s1 = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s1, g1, "2026-03-01").unwrap();
        enroll_student(&conn, s1, g2, "2026-03-01").unwrap();

        let reference = NaiveDate::from_ymd_opt(2026, 3, 5).unwrap();
        let alerts = payment_alerts_on(&conn, 3, 2026, reference).unwrap();
        assert_eq!(alerts.late.len(), 1);
        assert_eq!(alerts.late[0].total_due_cents, 55_000);
        assert!(alerts.late[0].groups.contains("Mathématiques"));
    }

    #[test]
    fn french_month_names_cover_the_year() {
        assert_eq!(french_month_name(1), "Janvier");
        assert_eq!(french_month_name(10), "Octobre");
        assert_eq!(french_month_name(12), "Décembre");
        assert_eq!(french_month_name(13), "");
    }
}
