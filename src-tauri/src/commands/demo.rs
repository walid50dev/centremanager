//! Demo data seeder (Phase 9).
//!
//! Fills an **empty** database with a realistic centre — 15 students, 5 teachers
//! with four different compensation modes, 8 groups, enrollments spread over two
//! months, invoices for the current and the previous month, payments that leave
//! a ~60 % collection rate with a few late invoices, teacher activities and
//! settlements — so a fresh install can be demonstrated without typing anything.
//!
//! The generator is deterministic: the same database always gets the same demo
//! data, which keeps screenshots, tests and support calls reproducible. It is
//! available in **development builds only** (`cmd_seed_demo_data` refuses in a
//! release build) and it never touches a database that already has students.

use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, Connection};
use tauri::State;

use super::activities::record_activity;
use super::compensation::{calculate_compensation, record_settlement, set_compensation};
use super::enrollments::enroll_student;
use super::groups::{create_group, CreateGroupInput};
use super::invoices::generate_monthly_invoices;
use super::payments::record_payment;
use super::students::{create_student, CreateStudentInput};
use super::teachers::{create_teacher, CreateTeacherInput};
use crate::db::Db;

/// Demo students: (full name, level id, phone).
///
/// Level ids come from the Phase 2 reference seed: 1–6 primaire, 7–9 collège,
/// 10–12 lycée. The list mixes both phone prefixes used in Morocco (06 / 07).
const DEMO_STUDENTS: [(&str, i64, &str); 15] = [
    ("Youssef El Amrani", 10, "0612345678"),
    ("Fatima Zahra Bennis", 12, "0709876543"),
    ("Amine Tazi", 11, "0611223344"),
    ("Salma Idrissi", 9, "0705566778"),
    ("Hamza Berrada", 7, "0698765432"),
    ("Nadia Chraibi", 6, "0701234567"),
    ("Mehdi Skalli", 8, "0612349876"),
    ("Imane Fassi", 12, "0703456789"),
    ("Omar Benjelloun", 5, "0655443322"),
    ("Kenza Alaoui", 11, "0709871234"),
    ("Rachid Chraibi", 10, "0666778899"),
    ("Hajar Sabri", 4, "0702345678"),
    ("Anas Ouazzani", 3, "0614567890"),
    ("Layla Bennani", 2, "0708901234"),
    ("Soufiane Cherkaoui", 1, "0612340987"),
];

/// Demo teachers: (full name, subject name, phone).
const DEMO_TEACHERS: [(&str, &str, &str); 5] = [
    ("Mohamed Alaoui", "Mathématiques", "0661112233"),
    ("Khadija Fassi", "Physique-Chimie", "0708887766"),
    ("Hassan Berrada", "SVT", "0662223344"),
    ("Nadia Cherkaoui", "Français", "0709998887"),
    ("Omar Skalli", "Anglais", "0663334455"),
];

/// Compensation per teacher index: (mode, value, bonus %).
///
/// `percentage` is stored as percentage × 100, exactly like the Phase 6 UI.
const DEMO_COMPENSATION: [(&str, i64, Option<f64>); 5] = [
    ("percentage", 4_000, Some(5.0)), // 40 % + 5 % de bonus
    ("hourly", 15_000, None),         // 150,00 DH / heure
    ("per_session", 20_000, None),    // 200,00 DH / séance
    ("fixed_monthly", 300_000, None), // 3 000,00 DH / mois
    ("percentage", 3_500, None),      // 35 %
];

/// Demo groups: (subject, level, teacher index, fee cents, capacity, day, start).
const DEMO_GROUPS: [(&str, i64, usize, i64, i32, &str, &str); 8] = [
    ("Mathématiques", 11, 0, 45_000, 20, "Lundi", "16:00"),
    ("Mathématiques", 10, 0, 30_000, 18, "Mercredi", "17:00"),
    ("Physique-Chimie", 12, 1, 50_000, 16, "Mardi", "18:00"),
    ("SVT", 11, 2, 35_000, 12, "Jeudi", "16:00"),
    ("Français", 9, 3, 25_000, 20, "Samedi", "09:00"),
    ("Français", 12, 3, 40_000, 10, "Vendredi", "10:00"),
    ("Anglais", 8, 4, 20_000, 20, "Samedi", "11:00"),
    ("Anglais", 10, 4, 30_000, 14, "Dimanche", "16:00"),
];

/// Which demo students join which demo groups (1–3 groups each, by index).
const DEMO_ENROLLMENTS: [&[usize]; 15] = [
    &[0, 1],
    &[2],
    &[0, 1, 7],
    &[4, 6],
    &[4],
    &[5, 6],
    &[6, 7],
    &[2],
    &[4, 5],
    &[0, 7],
    &[1],
    &[3, 4],
    &[6],
    &[4],
    &[5, 0],
];

fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// `(month, year)` of the month before `(month, year)`.
fn previous_period(month: i32, year: i32) -> (i32, i32) {
    if month == 1 {
        (12, year - 1)
    } else {
        (month - 1, year)
    }
}

fn subject_id(conn: &Connection, name: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT id FROM subjects WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |row| row.get(0),
    )
    .map_err(|_| format!("Matière introuvable : {name}"))
}

fn school_year_id(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT id FROM school_years WHERE is_active = 1 ORDER BY id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .map_err(|_| "Aucune année scolaire active".to_string())
}

fn count(conn: &Connection, table: &str) -> Result<i64, String> {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .map_err(|err| format!("Comptage de {table} : {err}"))
}

/// Seed the whole demo centre and return the human summary.
///
/// Refuses to run on a database that already holds students: the demo is meant
/// for a fresh install, and doubling it would corrupt the collection rate.
pub fn seed_demo_data(conn: &Connection) -> Result<String, String> {
    if count(conn, "students")? > 0 {
        return Err(
            "La base contient déjà des élèves : les données de démonstration ne s'ajoutent \
             qu'à une base vide"
                .to_string(),
        );
    }

    let now = today();
    let (month, year) = (now.month() as i32, now.year());
    let (prev_month, prev_year) = previous_period(month, year);
    // The demo starts either two months ago (invoice already late) or on the 1st
    // of the current month, so both "late" and "on time" invoices exist.
    let previous_start = NaiveDate::from_ymd_opt(prev_year, prev_month as u32, 5)
        .ok_or_else(|| "Date de démonstration invalide".to_string())?;
    let current_start = NaiveDate::from_ymd_opt(year, month as u32, 1)
        .ok_or_else(|| "Date de démonstration invalide".to_string())?;
    let previous_start = previous_start.format("%Y-%m-%d").to_string();
    let current_start = current_start.format("%Y-%m-%d").to_string();

    let year_id = school_year_id(conn)?;

    // ---------------------------------------------------------- teachers ---
    let mut teacher_ids = Vec::with_capacity(DEMO_TEACHERS.len());
    for (index, (name, subject, phone)) in DEMO_TEACHERS.iter().enumerate() {
        let teacher_id = create_teacher(
            conn,
            &CreateTeacherInput {
                full_name: (*name).to_string(),
                phone: Some((*phone).to_string()),
                email: Some(format!(
                    "{}@centre-demo.ma",
                    name.to_lowercase().replace(' ', ".")
                )),
                notes: Some("Enseignant de démonstration".to_string()),
                subject_ids: vec![subject_id(conn, subject)?],
            },
        )?;
        let (mode, value, bonus) = DEMO_COMPENSATION[index];
        set_compensation(conn, teacher_id, mode, value, bonus)?;
        teacher_ids.push(teacher_id);
    }

    // ------------------------------------------------------------ groups ---
    let mut group_ids = Vec::with_capacity(DEMO_GROUPS.len());
    for (index, (subject, level_id, teacher, fee, capacity, day, time)) in
        DEMO_GROUPS.iter().enumerate()
    {
        let start_hour = time.replace(':', "");
        let end = format!(
            "{}:{}",
            start_hour[..2].parse::<i32>().unwrap_or(16) + 2,
            &start_hour[2..]
        );
        let group_id = create_group(
            conn,
            &CreateGroupInput {
                subject_id: subject_id(conn, subject)?,
                level_id: *level_id,
                branch_id: None,
                teacher_id: Some(teacher_ids[*teacher]),
                school_year_id: year_id,
                day_of_week: (*day).to_string(),
                start_time: (*time).to_string(),
                end_time: end,
                room: Some(format!("Salle {}", index + 1)),
                monthly_fee_cents: *fee,
                capacity: *capacity,
            },
        )?;
        group_ids.push(group_id);
    }

    // -------------------------------------------------------- enrollments ---
    let mut student_ids = Vec::with_capacity(DEMO_STUDENTS.len());
    for (index, (name, level_id, phone)) in DEMO_STUDENTS.iter().enumerate() {
        let student_id = create_student(
            conn,
            &CreateStudentInput {
                full_name: (*name).to_string(),
                date_of_birth: Some(format!(
                    "20{:02}-{:02}-{:02}",
                    5 + index % 12,
                    1 + index % 12,
                    1 + index % 27
                )),
                phone: (*phone).to_string(),
                parent_phone: Some(format!("07{:08}", 10_000_000 + index * 1_111)),
                level_id: Some(*level_id),
                branch_id: None,
                address: Some(format!("{}. Rue Atlas, Casablanca", 10 + index)),
                notes: None,
            },
        )?;
        student_ids.push(student_id);
    }

    for (student_index, groups) in DEMO_ENROLLMENTS.iter().enumerate() {
        for (position, group_index) in groups.iter().enumerate() {
            // Half the students joined last month (their invoices are already
            // due), the other half joined this month.
            let start = if (student_index + position) % 2 == 0 {
                previous_start.clone()
            } else {
                current_start.clone()
            };
            enroll_student(
                conn,
                student_ids[student_index],
                group_ids[*group_index],
                &start,
            )?;
        }
    }

    // ----------------------------------------------------------- invoices ---
    generate_monthly_invoices(conn, prev_month, prev_year)?;
    generate_monthly_invoices(conn, month, year)?;

    // ----------------------------------------------------------- payments ---
    // Deterministic pattern over the **current** month: 4 invoices in 10 paid in
    // full, 2 paid halfway in two instalments (the multi-payment case), 4 left
    // untouched — a ~60 % collection rate. The previous month is left unpaid on
    // purpose: those are the late invoices the dashboard, the échéances and the
    // sidebar badge show.
    const METHODS: [&str; 3] = ["espèces", "virement", "chèque"];
    let mut invoices: Vec<(i64, i64, i64, i64)> = Vec::new(); // (id, enrollment, student, amount)
    {
        let mut stmt = conn
            .prepare(
                "SELECT i.id, i.enrollment_id, e.student_id, i.amount_cents
                 FROM invoices i
                 JOIN enrollments e ON e.id = i.enrollment_id
                 WHERE i.period_month = ?1 AND i.period_year = ?2
                 ORDER BY i.id",
            )
            .map_err(|err| format!("Lecture des factures : {err}"))?;
        let rows = stmt
            .query_map(params![month, year], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|err| format!("Lecture des factures : {err}"))?;
        for row in rows {
            invoices.push(row.map_err(|err| format!("Lecture des factures : {err}"))?);
        }
    }

    let mut payments = 0_i64;
    for (index, (invoice_id, _enrollment, student_id, amount)) in invoices.iter().enumerate() {
        let pattern = index % 10;
        let method = METHODS[index % METHODS.len()];
        if pattern < 4 {
            record_payment(conn, *student_id, &[*invoice_id], *amount, method, None)?;
            payments += 1;
        } else if pattern == 4 || pattern == 5 {
            // Half the invoice, in two instalments: the invoice stays `partiel`
            // and the history shows two rows, which is the case the UI has to
            // render everywhere.
            let half = amount / 2;
            let first = half / 2;
            record_payment(
                conn,
                *student_id,
                &[*invoice_id],
                first,
                method,
                Some("1ère tranche"),
            )?;
            record_payment(
                conn,
                *student_id,
                &[*invoice_id],
                half - first,
                method,
                Some("2ème tranche"),
            )?;
            payments += 2;
        }
    }

    // --------------------------------------------------------- activities ---
    let mut activities = 0_i64;
    let activity_types = ["cours", "cours", "rattrapage", "examen", "autre"];
    for (index, teacher_id) in teacher_ids.iter().enumerate() {
        let (mode, _, _) = DEMO_COMPENSATION[index];
        let entries = 6 + index % 4;
        for entry in 0..entries {
            let day = 1 + ((entry * 2 + index) % 26) as u32;
            let date = NaiveDate::from_ymd_opt(year, month as u32, day)
                .ok_or_else(|| "Date d'activité invalide".to_string())?
                .format("%Y-%m-%d")
                .to_string();
            let kind = activity_types[(entry + index) % activity_types.len()];
            let (hours, sessions) = if mode == "per_session" {
                (None, Some(1))
            } else {
                (Some(1.5), None)
            };
            record_activity(
                conn,
                *teacher_id,
                &date,
                kind,
                hours,
                sessions,
                Some("Séance de démonstration"),
            )?;
            activities += 1;
        }
    }

    // -------------------------------------------------------- settlements ---
    for (index, teacher_id) in teacher_ids.iter().enumerate() {
        if index > 1 {
            continue;
        }
        let detail = calculate_compensation(conn, *teacher_id, month, year)?;
        if detail.remaining_cents <= 0 {
            continue;
        }
        // The first teacher is paid in full, the second one halfway.
        let amount = if index == 0 {
            detail.remaining_cents
        } else {
            detail.remaining_cents / 2
        };
        if amount > 0 {
            record_settlement(conn, *teacher_id, month, year, amount, "virement", None)?;
        }
    }

    let invoices_total = count(conn, "invoices")?;
    // The summary is the exact template the specification asks for (English),
    // because the owner and any log line read it verbatim. The toast *prefix*
    // is localised by the UI (`settings.demo.success`).
    let _ = activities;
    Ok(format!(
        "Demo data: {} students, {} teachers, {} groups, {} invoices, {} payments",
        count(conn, "students")?,
        count(conn, "teachers")?,
        count(conn, "groups")?,
        invoices_total,
        payments
    ))
}

/// Development-only entry point used by the Settings page.
#[tauri::command]
pub fn cmd_seed_demo_data(db: State<'_, Db>) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err(
            "Les données de démonstration ne sont disponibles que dans la version de \
             développement"
                .to_string(),
        );
    }
    let conn = db.conn();
    seed_demo_data(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::enrollments::end_enrollment;
    use crate::commands::invoices::payment_alerts;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn scalar(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn demo_seed_builds_the_documented_centre() {
        let conn = test_conn();
        let summary = seed_demo_data(&conn).unwrap();
        assert!(
            summary.starts_with("Demo data: 15 students, 5 teachers, 8 groups"),
            "{summary}"
        );

        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM students"), 15);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM teachers"), 5);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM groups"), 8);
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(*) FROM teachers WHERE compensation_mode IS NOT NULL"
            ),
            5,
            "every teacher gets a compensation configuration"
        );
        // Four different modes are used, as documented.
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(DISTINCT compensation_mode) FROM teachers"
            ),
            4,
            "the demo covers the four compensation modes"
        );

        // Enrollments: 1–3 groups per student, never a duplicate pair.
        let enrollments = scalar(&conn, "SELECT COUNT(*) FROM enrollments");
        assert!(
            (15..=45).contains(&enrollments),
            "unexpected enrollment count: {enrollments}"
        );
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(*) FROM (SELECT student_id, group_id FROM enrollments
                  GROUP BY student_id, group_id HAVING COUNT(*) > 1)"
            ),
            0
        );

        // Two months of invoices, both generated once.
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(DISTINCT period_month || '-' || period_year) FROM invoices"
            ),
            2
        );
        assert_eq!(
            scalar(&conn, "SELECT COUNT(*) FROM invoices"),
            enrollments * 2,
            "one invoice per enrollment and per month"
        );

        // Payments: a ~60 % collection rate on the current month, nothing paid
        // on the previous one (those are the late invoices of the demo).
        let now = today();
        let current_paid: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(paid_amount_cents), 0) FROM invoices
                 WHERE period_month = ?1 AND period_year = ?2",
                params![now.month() as i32, now.year()],
                |row| row.get(0),
            )
            .unwrap();
        let current_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(amount_cents), 0) FROM invoices
                 WHERE period_month = ?1 AND period_year = ?2",
                params![now.month() as i32, now.year()],
                |row| row.get(0),
            )
            .unwrap();
        let rate = current_paid as f64 / current_total as f64;
        assert!(
            (0.5..=0.7).contains(&rate),
            "collection rate should stay around 60 %, got {rate}"
        );
        let (prev_month, prev_year) = previous_period(now.month() as i32, now.year());
        let prev_paid: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(paid_amount_cents), 0) FROM invoices
                 WHERE period_month = ?1 AND period_year = ?2",
                params![prev_month, prev_year],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prev_paid, 0, "the previous month stays unpaid on purpose");

        // …and it shows up as late payments, which is the point of the demo.
        let alerts = payment_alerts(&conn, prev_month, prev_year).unwrap();
        assert!(
            alerts.late.len() >= 10,
            "expected late invoices, got {}",
            alerts.late.len()
        );

        // Activities and settlements.
        assert!(scalar(&conn, "SELECT COUNT(*) FROM teacher_activities") >= 25);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM teacher_settlements"), 2);

        // Statuses are consistent with the amounts.
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(*) FROM invoices
                 WHERE (status = 'payé' AND paid_amount_cents < amount_cents)
                    OR (status = 'impayé' AND paid_amount_cents > 0)"
            ),
            0
        );
        assert!(scalar(&conn, "SELECT COUNT(*) FROM payments") > 0);
        assert!(
            scalar(&conn, "SELECT COUNT(DISTINCT receipt_number) FROM receipts") >= 0,
            "receipts are created on demand, not by the seeder"
        );
    }

    #[test]
    fn demo_seed_refuses_a_database_that_already_has_students() {
        let conn = test_conn();
        seed_demo_data(&conn).unwrap();
        let error = seed_demo_data(&conn).unwrap_err();
        assert!(error.contains("déjà des élèves"), "{error}");

        // Nothing was added twice.
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM students"), 15);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM groups"), 8);
    }

    #[test]
    fn demo_seed_survives_an_ended_enrollment() {
        // A demo database is a playground: ending an enrollment must not break
        // the pages that read it afterwards.
        let conn = test_conn();
        seed_demo_data(&conn).unwrap();
        let enrollment: i64 = conn
            .query_row(
                "SELECT id FROM enrollments ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        end_enrollment(&conn, enrollment).unwrap();
        assert_eq!(
            scalar(
                &conn,
                "SELECT COUNT(*) FROM enrollments WHERE status = 'actif'"
            ),
            scalar(&conn, "SELECT COUNT(*) FROM enrollments") - 1
        );
    }
}
