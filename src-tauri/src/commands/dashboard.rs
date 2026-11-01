//! Home page aggregates (Phase 7).
//!
//! Everything here is **read-only**: the dashboard never writes a row, it only
//! folds the existing tables into the numbers of one month.
//!
//! | Command | Reads |
//! | --- | --- |
//! | [`dashboard_kpis`] | `students`, `payments`, `invoices`, `groups`, `teachers`, `enrollments` |
//! | [`dashboard_alerts`] | the unpaid invoices due in the ±7 day window |
//! | [`recent_payments`] | the last `N` payment rows |
//!
//! Two definitions are worth spelling out, because they are the whole point of
//! the screen:
//!
//! * **Revenue** is money *received* during the month — `payments.created_at`,
//!   not the invoice period. A September invoice paid in October is October's
//!   revenue.
//! * **Theoretical revenue** is what the month *asks for* — the sum of
//!   `invoices.amount_cents` for that period. The collection rate is the ratio
//!   of the two, so it never mixes the two calendars.
//!
//! The previous month is computed with an explicit year rollover
//! (`January → December of the previous year`); the payroll summary of Phase 6
//! is deliberately **not** duplicated here, the dashboard calls the existing
//! `cmd_get_all_teacher_compensation_summary` from the frontend.

use chrono::{Duration, Local, NaiveDate};
use rusqlite::{params, Connection};
use tauri::State;

use super::db_err;
use super::invoices::parse_iso_date;
use crate::db::Db;
use crate::models::{AlertItem, DashboardKPIs, RecentPayment};

/// Days of history / anticipation shown in the “échéances” list.
const ALERT_WINDOW_DAYS: i64 = 7;
/// Hard cap of the list, whatever the caller asks for.
const MAX_RECENT_PAYMENTS: i32 = 50;
/// Maximum number of rows in the échéances list.
const MAX_ALERTS: i64 = 15;

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn validate_period(month: i32, year: i32) -> Result<(), String> {
    if !(1..=12).contains(&month) {
        return Err("Mois invalide (1 à 12)".to_string());
    }
    if !(2000..=2100).contains(&year) {
        return Err("Année invalide".to_string());
    }
    Ok(())
}

/// Month before `(month, year)`, rolling the year over in January.
pub fn previous_month(month: i32, year: i32) -> (i32, i32) {
    if month <= 1 {
        (12, year - 1)
    } else {
        (month - 1, year)
    }
}

/// First day of a month — the anchor of every window computation.
fn first_day_of(month: i32, year: i32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month as u32, 1).unwrap_or_else(|| today())
}

fn last_day_of(month: i32, year: i32) -> NaiveDate {
    let (next_month, next_year) = if month >= 12 {
        (1, year + 1)
    } else {
        (month + 1, year)
    };
    first_day_of(next_month, next_year) - Duration::days(1)
}

fn scalar(conn: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<i64, String> {
    conn.query_row(sql, args, |row| row.get::<_, i64>(0))
        .map_err(|err| db_err("Lecture du tableau de bord", err))
}

/// ISO date (`YYYY-MM-DD`) of `day`, used as the SQLite filter value.
fn iso(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

/// Money received during a month, from `payments.created_at`.
pub fn revenue_of(conn: &Connection, month: i32, year: i32) -> Result<i64, String> {
    scalar(
        conn,
        "SELECT COALESCE(SUM(amount_cents), 0) FROM payments
          WHERE CAST(strftime('%m', created_at) AS INTEGER) = ?1
            AND CAST(strftime('%Y', created_at) AS INTEGER) = ?2",
        params![month, year],
    )
}

/// What the invoices of a month ask for.
fn theoretical_of(conn: &Connection, month: i32, year: i32) -> Result<i64, String> {
    scalar(
        conn,
        "SELECT COALESCE(SUM(amount_cents), 0) FROM invoices
          WHERE period_month = ?1 AND period_year = ?2",
        params![month, year],
    )
}

/// Students holding an active enrollment at some point during the month.
fn students_during(conn: &Connection, month: i32, year: i32) -> Result<i32, String> {
    let from = iso(first_day_of(month, year));
    let to = iso(last_day_of(month, year));
    let count = scalar(
        conn,
        "SELECT COUNT(DISTINCT e.student_id) FROM enrollments e
          WHERE date(e.start_date) <= date(?1)
            AND (e.end_date IS NULL OR TRIM(e.end_date) = '' OR date(e.end_date) >= date(?2))",
        params![to, from],
    )?;
    Ok(count as i32)
}

/// Collection rate in percent, rounded to two decimals (`0.0` without invoices).
pub fn collection_rate(revenue_cents: i64, theoretical_cents: i64) -> f64 {
    if theoretical_cents <= 0 {
        return 0.0;
    }
    let rate = (revenue_cents as f64 / theoretical_cents as f64) * 100.0;
    (rate * 100.0).round() / 100.0
}

/// The five headline numbers of a month, plus the previous month's revenue.
pub fn dashboard_kpis(conn: &Connection, month: i32, year: i32) -> Result<DashboardKPIs, String> {
    validate_period(month, year)?;
    let (prev_month, prev_year) = previous_month(month, year);

    let total_active_students = scalar(
        conn,
        "SELECT COUNT(*) FROM students WHERE COALESCE(status, 'actif') = 'actif'",
        &[],
    )?;
    let monthly_revenue_cents = revenue_of(conn, month, year)?;
    let theoretical_revenue_cents = theoretical_of(conn, month, year)?;
    let active_groups = scalar(
        conn,
        "SELECT COUNT(*) FROM groups WHERE COALESCE(status, 'actif') = 'actif'",
        &[],
    )?;
    let active_teachers = scalar(
        conn,
        "SELECT COUNT(*) FROM teachers WHERE COALESCE(status, 'actif') = 'actif'",
        &[],
    )?;
    let prev_month_revenue_cents = revenue_of(conn, prev_month, prev_year)?;
    let prev_month_students = students_during(conn, prev_month, prev_year)?;

    Ok(DashboardKPIs {
        total_active_students: total_active_students as i32,
        monthly_revenue_cents,
        theoretical_revenue_cents,
        collection_rate: collection_rate(monthly_revenue_cents, theoretical_revenue_cents),
        active_groups: active_groups as i32,
        active_teachers: active_teachers as i32,
        prev_month_revenue_cents,
        prev_month_students,
    })
}

/// Severity of an alert from its distance to the due date.
pub fn severity_for(days_remaining: i32) -> &'static str {
    if days_remaining < 0 {
        "late"
    } else if days_remaining <= 3 {
        "upcoming"
    } else {
        "ok"
    }
}

/// Group label used by the alert rows (“Mathématiques Tronc Commun”).
fn group_label(subject: &str, level: &str) -> String {
    match (subject.trim(), level.trim()) {
        ("", "") => String::new(),
        ("", level) => level.to_string(),
        (subject, "") => subject.to_string(),
        (subject, level) => format!("{subject} {level}"),
    }
}

/// Unpaid invoices due between `reference - 7d` and `reference + 7d`.
///
/// The reference day is a parameter so the behaviour is testable without
/// freezing the clock; [`dashboard_alerts`] passes the real today.
pub fn dashboard_alerts_on(
    conn: &Connection,
    reference_day: NaiveDate,
) -> Result<Vec<AlertItem>, String> {
    let from = iso(reference_day - Duration::days(ALERT_WINDOW_DAYS));
    let to = iso(reference_day + Duration::days(ALERT_WINDOW_DAYS));

    let mut stmt = conn
        .prepare(
            "SELECT s.id,
                    COALESCE(s.full_name, ''),
                    COALESCE(su.name, ''),
                    COALESCE(l.name, ''),
                    i.amount_cents,
                    COALESCE(i.paid_amount_cents, 0),
                    COALESCE(i.due_date, '')
             FROM invoices i
             JOIN enrollments e ON e.id = i.enrollment_id
             JOIN students s    ON s.id = e.student_id
             LEFT JOIN groups g   ON g.id = e.group_id
             LEFT JOIN subjects su ON su.id = g.subject_id
             LEFT JOIN levels l    ON l.id = g.level_id
             WHERE COALESCE(i.status, 'impayé') <> 'payé'
               AND COALESCE(i.paid_amount_cents, 0) < i.amount_cents
               AND i.due_date IS NOT NULL
               AND date(i.due_date) BETWEEN date(?1) AND date(?2)
             ORDER BY date(i.due_date) ASC, i.id ASC
             LIMIT ?3",
        )
        .map_err(|err| db_err("Préparation des échéances", err))?;

    let rows = stmt
        .query_map(params![from, to, MAX_ALERTS], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|err| db_err("Lecture des échéances", err))?;

    let mut alerts = Vec::new();
    for row in rows {
        let (student_id, student_name, subject, level, amount_cents, paid_cents, due_date) =
            row.map_err(|err| db_err("Lecture des échéances", err))?;

        let Some(due) = parse_iso_date(&due_date) else {
            continue;
        };
        let days_remaining = (due - reference_day).num_days() as i32;

        alerts.push(AlertItem {
            student_id,
            student_name,
            group_name: group_label(&subject, &level),
            amount_cents: (amount_cents - paid_cents).max(0),
            due_date: iso(due),
            days_remaining,
            severity: severity_for(days_remaining).to_string(),
        });
    }

    Ok(alerts)
}

/// [`dashboard_alerts_on`] against the real current date.
pub fn dashboard_alerts(conn: &Connection) -> Result<Vec<AlertItem>, String> {
    dashboard_alerts_on(conn, today())
}

/// The most recent payments, newest first.
pub fn recent_payments(conn: &Connection, limit: i32) -> Result<Vec<RecentPayment>, String> {
    if limit <= 0 {
        return Err("Limite invalide".to_string());
    }
    let capped = limit.min(MAX_RECENT_PAYMENTS);

    let mut stmt = conn
        .prepare(
            "SELECT p.id,
                    COALESCE(s.full_name, ''),
                    p.amount_cents,
                    COALESCE(p.payment_method, ''),
                    COALESCE(p.created_at, '')
             FROM payments p
             LEFT JOIN students s ON s.id = p.student_id
             ORDER BY datetime(p.created_at) DESC, p.id DESC
             LIMIT ?1",
        )
        .map_err(|err| db_err("Préparation des derniers paiements", err))?;

    let rows = stmt
        .query_map(params![capped], |row| {
            Ok(RecentPayment {
                id: row.get(0)?,
                student_name: row.get(1)?,
                amount_cents: row.get(2)?,
                payment_method: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|err| db_err("Lecture des derniers paiements", err))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des derniers paiements", err))?;

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_get_dashboard_kpis(
    db: State<'_, Db>,
    month: i32,
    year: i32,
) -> Result<DashboardKPIs, String> {
    let conn = db.conn();
    dashboard_kpis(&conn, month, year)
}

#[tauri::command]
pub fn cmd_get_dashboard_alerts(db: State<'_, Db>) -> Result<Vec<AlertItem>, String> {
    let conn = db.conn();
    dashboard_alerts(&conn)
}

#[tauri::command]
pub fn cmd_get_recent_payments(
    db: State<'_, Db>,
    limit: i32,
) -> Result<Vec<RecentPayment>, String> {
    let conn = db.conn();
    recent_payments(&conn, limit)
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

    fn day(value: &str) -> NaiveDate {
        parse_iso_date(value).unwrap()
    }

    fn student(conn: &Connection, name: &str, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO students (full_name, phone, status) VALUES (?1, '0612345678', ?2)",
            params![name, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// Group 1 of the seed subject/level, active by default.
    fn group(conn: &Connection, fee_cents: i64, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO groups (subject_id, level_id, school_year_id, day_of_week,
                                 start_time, end_time, monthly_fee_cents, capacity, status)
             VALUES (1, 10, 1, 'Lundi', '16:00', '18:00', ?1, 20, ?2)",
            params![fee_cents, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn enrollment(
        conn: &Connection,
        student_id: i64,
        group_id: i64,
        start: &str,
        end: Option<&str>,
    ) -> i64 {
        conn.execute(
            "INSERT INTO enrollments (student_id, group_id, start_date, end_date, status)
             VALUES (?1, ?2, ?3, ?4, 'actif')",
            params![student_id, group_id, start, end],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn invoice(
        conn: &Connection,
        enrollment_id: i64,
        month: i32,
        year: i32,
        amount: i64,
        paid: i64,
        due_date: &str,
    ) -> i64 {
        conn.execute(
            "INSERT INTO invoices (enrollment_id, period_month, period_year, amount_cents,
                                   paid_amount_cents, status, due_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                enrollment_id,
                month,
                year,
                amount,
                paid,
                super::super::payments::status_for(paid, amount),
                due_date
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn payment(conn: &Connection, student_id: i64, amount: i64, method: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO payments (student_id, invoice_id, amount_cents, payment_method, created_at)
             VALUES (?1, NULL, ?2, ?3, ?4)",
            params![student_id, amount, method, created_at],
        )
        .unwrap();
    }

    fn teacher(conn: &Connection, name: &str, status: &str) {
        conn.execute(
            "INSERT INTO teachers (full_name, status) VALUES (?1, ?2)",
            params![name, status],
        )
        .unwrap();
    }

    #[test]
    fn empty_database_reports_zeroes() {
        let conn = test_conn();
        let kpis = dashboard_kpis(&conn, 3, 2026).unwrap();

        assert_eq!(kpis.total_active_students, 0);
        assert_eq!(kpis.monthly_revenue_cents, 0);
        assert_eq!(kpis.theoretical_revenue_cents, 0);
        assert_eq!(kpis.collection_rate, 0.0);
        assert_eq!(kpis.active_groups, 0);
        assert_eq!(kpis.active_teachers, 0);
        assert_eq!(kpis.prev_month_revenue_cents, 0);
        assert_eq!(kpis.prev_month_students, 0);
    }

    #[test]
    fn inactive_rows_are_not_counted() {
        let conn = test_conn();
        student(&conn, "Actif", "actif");
        student(&conn, "Inactif", "inactif");
        group(&conn, 30_000, "actif");
        group(&conn, 30_000, "inactif");
        teacher(&conn, "Karim", "actif");
        teacher(&conn, "Zineb", "inactif");
        teacher(&conn, "Salma", "actif");

        let kpis = dashboard_kpis(&conn, 3, 2026).unwrap();
        assert_eq!(kpis.total_active_students, 1);
        assert_eq!(kpis.active_groups, 1);
        assert_eq!(kpis.active_teachers, 2);
    }

    #[test]
    fn revenue_uses_the_payment_date_and_the_rate_the_invoice_period() {
        let conn = test_conn();
        let s1 = student(&conn, "Salma", "actif");
        let s2 = student(&conn, "Yassine", "actif");
        let g = group(&conn, 30_000, "actif");
        let e1 = enrollment(&conn, s1, g, "2026-01-05", None);
        let e2 = enrollment(&conn, s2, g, "2026-01-06", None);

        invoice(&conn, e1, 3, 2026, 30_000, 30_000, "2026-03-05");
        invoice(&conn, e2, 3, 2026, 30_000, 0, "2026-03-06");
        invoice(&conn, e1, 2, 2026, 30_000, 30_000, "2026-02-05");

        // Two payments in March (45 000) and one in February (30 000).
        payment(&conn, s1, 30_000, "espèces", "2026-03-05 10:00:00");
        payment(&conn, s2, 15_000, "virement", "2026-03-20 18:30:00");
        payment(&conn, s1, 30_000, "espèces", "2026-02-05 09:00:00");

        let march = dashboard_kpis(&conn, 3, 2026).unwrap();
        assert_eq!(march.theoretical_revenue_cents, 60_000);
        assert_eq!(march.monthly_revenue_cents, 45_000);
        assert_eq!(march.collection_rate, 75.0);
        assert_eq!(march.prev_month_revenue_cents, 30_000);

        let february = dashboard_kpis(&conn, 2, 2026).unwrap();
        assert_eq!(february.theoretical_revenue_cents, 30_000);
        assert_eq!(february.monthly_revenue_cents, 30_000);
        assert_eq!(february.collection_rate, 100.0);
    }

    #[test]
    fn collection_rate_is_zero_without_invoices_and_never_divides_by_zero() {
        let conn = test_conn();
        let s = student(&conn, "Salma", "actif");
        payment(&conn, s, 20_000, "espèces", "2026-03-05 10:00:00");

        let kpis = dashboard_kpis(&conn, 3, 2026).unwrap();
        assert_eq!(kpis.monthly_revenue_cents, 20_000);
        assert_eq!(kpis.theoretical_revenue_cents, 0);
        assert_eq!(kpis.collection_rate, 0.0);

        assert_eq!(collection_rate(0, 0), 0.0);
        assert_eq!(collection_rate(25_000, 100_000), 25.0);
        // Rounded to two decimals: 1/3 → 33.33, not 33.333…
        assert_eq!(collection_rate(10_000, 30_000), 33.33);
        // Over-collection is allowed (an advance can push the rate above 100).
        assert_eq!(collection_rate(120_000, 100_000), 120.0);
    }

    #[test]
    fn january_compares_with_december_of_the_previous_year() {
        let conn = test_conn();
        assert_eq!(previous_month(1, 2026), (12, 2025));
        assert_eq!(previous_month(3, 2026), (2, 2026));
        assert_eq!(previous_month(12, 2026), (11, 2026));

        let s = student(&conn, "Salma", "actif");
        payment(&conn, s, 12_000, "espèces", "2025-12-28 11:00:00");
        payment(&conn, s, 5_000, "espèces", "2026-01-04 11:00:00");

        let january = dashboard_kpis(&conn, 1, 2026).unwrap();
        assert_eq!(january.monthly_revenue_cents, 5_000);
        assert_eq!(january.prev_month_revenue_cents, 12_000);
    }

    #[test]
    fn previous_month_students_only_counts_enrollments_of_that_month() {
        let conn = test_conn();
        let g = group(&conn, 30_000, "actif");

        let early = student(&conn, "Depuis longtemps", "actif");
        enrollment(&conn, early, g, "2025-09-01", None);

        let leaving = student(&conn, "Parti en mars", "actif");
        enrollment(&conn, leaving, g, "2025-10-01", Some("2026-03-15"));

        let joined_in_march = student(&conn, "Arrivé en mars", "actif");
        enrollment(&conn, joined_in_march, g, "2026-03-02", None);

        // February: the long-standing student and the one who leaves in March.
        let february = students_during(&conn, 2, 2026).unwrap();
        assert_eq!(february, 2, "the two students enrolled in February");

        // March: the leaver is still counted (the enrollment ended mid-month),
        // and the newcomer joined on the 2nd.
        let march = students_during(&conn, 3, 2026).unwrap();
        assert_eq!(march, 3);

        // April: the student who left in March is gone.
        let april = students_during(&conn, 4, 2026).unwrap();
        assert_eq!(april, 2);
    }

    #[test]
    fn alerts_cover_the_week_around_today_and_skip_settled_invoices() {
        let conn = test_conn();
        let reference = day("2026-03-10");
        let s = student(&conn, "Salma Benjelloun", "actif");
        let g = group(&conn, 30_000, "actif");
        let e = enrollment(&conn, s, g, "2025-09-01", None);

        invoice(&conn, e, 3, 2026, 30_000, 0, "2026-03-07"); // 3 days late
        invoice(&conn, e, 4, 2026, 30_000, 0, "2026-03-10"); // today
        invoice(&conn, e, 5, 2026, 30_000, 0, "2026-03-11"); // tomorrow
        invoice(&conn, e, 6, 2026, 30_000, 0, "2026-03-15"); // 5 days out
        invoice(&conn, e, 7, 2026, 30_000, 0, "2026-03-18"); // 8 days out — outside
        invoice(&conn, e, 8, 2026, 30_000, 30_000, "2026-03-12"); // paid — skipped
        invoice(&conn, e, 9, 2026, 30_000, 0, "2026-02-20"); // too old

        let alerts = dashboard_alerts_on(&conn, reference).unwrap();
        let days: Vec<i32> = alerts.iter().map(|alert| alert.days_remaining).collect();
        assert_eq!(days, vec![-3, 0, 1, 5]);
        let severities: Vec<&str> = alerts.iter().map(|a| a.severity.as_str()).collect();
        assert_eq!(severities, vec!["late", "upcoming", "upcoming", "ok"]);
        assert_eq!(alerts[0].student_name, "Salma Benjelloun");
        assert_eq!(alerts[0].group_name, "Mathématiques Tronc Commun");
        assert_eq!(alerts[0].amount_cents, 30_000);
        assert_eq!(alerts[0].due_date, "2026-03-07");
    }

    #[test]
    fn alerts_report_what_is_left_on_a_partial_invoice() {
        let conn = test_conn();
        let reference = day("2026-03-10");
        let s = student(&conn, "Yassine", "actif");
        let g = group(&conn, 30_000, "actif");
        let e = enrollment(&conn, s, g, "2025-09-01", None);
        invoice(&conn, e, 3, 2026, 30_000, 12_000, "2026-03-11");

        let alerts = dashboard_alerts_on(&conn, reference).unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].amount_cents, 18_000);
        assert_eq!(alerts[0].severity, "upcoming");
    }

    #[test]
    fn alerts_are_capped_at_fifteen_rows() {
        let conn = test_conn();
        let reference = day("2026-03-10");
        let g = group(&conn, 10_000, "actif");
        for index in 0..20 {
            let s = student(&conn, &format!("Élève {index}"), "actif");
            let e = enrollment(&conn, s, g, "2025-09-01", None);
            // Same due date, the id breaks the tie.
            invoice(&conn, e, 3, 2026, 10_000, 0, "2026-03-12");
        }

        let alerts = dashboard_alerts_on(&conn, reference).unwrap();
        assert_eq!(alerts.len(), MAX_ALERTS as usize);
        assert!(alerts.iter().all(|alert| alert.due_date == "2026-03-12"));
    }

    #[test]
    fn severity_thresholds_are_late_upcoming_ok() {
        assert_eq!(severity_for(-1), "late");
        assert_eq!(severity_for(-30), "late");
        assert_eq!(severity_for(0), "upcoming");
        assert_eq!(severity_for(3), "upcoming");
        assert_eq!(severity_for(4), "ok");
        assert_eq!(severity_for(7), "ok");
    }

    #[test]
    fn recent_payments_are_newest_first_and_limited() {
        let conn = test_conn();
        let s1 = student(&conn, "Salma", "actif");
        let s2 = student(&conn, "Yassine", "actif");

        payment(&conn, s1, 10_000, "espèces", "2026-03-01 09:00:00");
        payment(&conn, s2, 20_000, "virement", "2026-03-05 15:30:00");
        payment(&conn, s1, 30_000, "chèque", "2026-03-09 12:00:00");

        let rows = recent_payments(&conn, 10).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].amount_cents, 30_000);
        assert_eq!(rows[0].payment_method, "chèque");
        assert_eq!(rows[0].student_name, "Salma");
        assert_eq!(rows[1].student_name, "Yassine");
        assert_eq!(rows[2].amount_cents, 10_000);

        let limited = recent_payments(&conn, 2).unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].amount_cents, 30_000);
    }

    #[test]
    fn recent_payments_rejects_an_impossible_limit() {
        let conn = test_conn();
        assert_eq!(
            recent_payments(&conn, 0).unwrap_err(),
            "Limite invalide".to_string()
        );
        assert!(recent_payments(&conn, 1).unwrap().is_empty());
    }

    #[test]
    fn invalid_periods_are_rejected() {
        let conn = test_conn();
        assert_eq!(
            dashboard_kpis(&conn, 0, 2026).unwrap_err(),
            "Mois invalide (1 à 12)".to_string()
        );
        assert_eq!(
            dashboard_kpis(&conn, 13, 2026).unwrap_err(),
            "Mois invalide (1 à 12)".to_string()
        );
        assert_eq!(
            dashboard_kpis(&conn, 3, 1990).unwrap_err(),
            "Année invalide".to_string()
        );
    }

    #[test]
    fn group_label_joins_subject_and_level() {
        assert_eq!(
            group_label("Mathématiques", "Tronc Commun"),
            "Mathématiques Tronc Commun"
        );
        assert_eq!(group_label("Mathématiques", ""), "Mathématiques");
        assert_eq!(group_label("", "2ème Bac"), "2ème Bac");
        assert_eq!(group_label(" ", " "), "");
    }

    #[test]
    fn last_day_of_handles_february_and_december() {
        assert_eq!(last_day_of(2, 2026), day("2026-02-28"));
        assert_eq!(last_day_of(2, 2024), day("2024-02-29"));
        assert_eq!(last_day_of(12, 2026), day("2026-12-31"));
        assert_eq!(last_day_of(1, 2026), day("2026-01-31"));
        assert_eq!(first_day_of(3, 2026), day("2026-03-01"));
    }
}
