//! Phase 9 — the twenty edge cases, in one place.
//!
//! Every case the release checklist asks for is asserted here against a real
//! migrated database (in memory, or on disk for the backup cycle), using the
//! same functions the commands call. The cases that can only be observed in the
//! UI — Arabic names, LTR phone numbers inside an Arabic modal, double clicks —
//! are covered by the browser suite; the comments say which is which.
//!
//! | # | Case | Covered here |
//! | --- | --- | --- |
//! | 1–6 | end-of-month and leap-year due dates | ✅ |
//! | 7–10 | overpayment, zero, partial accumulation, selective payment | ✅ |
//! | 11–14 | duplicate, capacity, mid-month end, re-enrollment | ✅ |
//! | 15–16 | Arabic student name, LTR phone in RTL | browser |
//! | 17 | level delete guard | ✅ |
//! | 18 | teacher deactivation with active groups | ✅ |
//! | 19 | backup → restore cycle | ✅ |
//! | 20 | double click on a payment | browser (`loading` state) |

use rusqlite::{params, Connection};

use super::compensation::set_compensation;
use super::enrollments::{end_enrollment, enroll_student};
use super::groups::{create_group, list_groups, CreateGroupInput};
use super::invoices::{generate_monthly_invoices, payment_alerts, student_invoices};
use super::levels::delete_level;
use super::payments::record_payment;
use super::students::{create_student, CreateStudentInput};
use super::teachers::{create_teacher, CreateTeacherInput};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::run_migrations(&conn).unwrap();
    conn
}

fn group(conn: &Connection, fee_cents: i64, capacity: i32) -> i64 {
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
            monthly_fee_cents: fee_cents,
            capacity,
        },
    )
    .unwrap()
}

fn student(conn: &Connection, name: &str, phone: &str) -> i64 {
    create_student(
        conn,
        &CreateStudentInput {
            full_name: name.to_string(),
            date_of_birth: None,
            phone: phone.to_string(),
            parent_phone: None,
            level_id: Some(10),
            branch_id: None,
            address: None,
            notes: None,
        },
    )
    .unwrap()
}

fn scalar(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn text(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

/// `(id, amount_cents, due_date)` of the invoice of `(enrollment, month, year)`.
fn invoice_of(conn: &Connection, enrollment_id: i64, month: i32, year: i32) -> (i64, i64, String) {
    conn.query_row(
        "SELECT id, amount_cents, due_date FROM invoices
         WHERE enrollment_id = ?1 AND period_month = ?2 AND period_year = ?3",
        params![enrollment_id, month, year],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .unwrap()
}

fn invoice_status(conn: &Connection, invoice_id: i64) -> (String, i64) {
    conn.query_row(
        "SELECT status, paid_amount_cents FROM invoices WHERE id = ?1",
        params![invoice_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

// ---------------------------------------------------------------------------
// 1–6. Date edge cases
// ---------------------------------------------------------------------------

#[test]
fn due_dates_clamp_to_the_end_of_the_month_and_handle_leap_years() {
    // (start date, invoice month, invoice year, expected due date)
    let cases = [
        // 1. 31 January → February 2025 (non-leap) clamps to the 28th.
        ("2025-01-31", 2, 2025, "2025-02-28"),
        // 2. 31 January → February 2024 (leap) clamps to the 29th.
        ("2024-01-31", 2, 2024, "2024-02-29"),
        // 3. 30 January → February 2025 clamps to the 28th.
        ("2025-01-30", 2, 2025, "2025-02-28"),
        // 4. 31 March → April clamps to the 30th.
        ("2025-03-31", 4, 2025, "2025-04-30"),
        // 5. 31 May → June clamps to the 30th.
        ("2025-05-31", 6, 2025, "2025-06-30"),
        // 6. December enrollment → January invoice keeps the day, next year.
        ("2024-12-15", 1, 2025, "2025-01-15"),
    ];

    for (start_date, month, year, expected) in cases {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 20);
        let student_id = student(&conn, "Youssef El Amrani", "0612345678");
        enroll_student(&conn, student_id, group_id, start_date).unwrap();
        // Always run the generator: it is idempotent for the month the
        // enrollment already created an invoice for.
        generate_monthly_invoices(&conn, month, year).unwrap();

        let due = text(
            &conn,
            &format!(
                "SELECT due_date FROM invoices
                 WHERE period_month = {month} AND period_year = {year}
                 ORDER BY id DESC LIMIT 1"
            ),
        );
        assert_eq!(
            due, expected,
            "start {start_date} → invoice {month}/{year} should be due {expected}"
        );
    }
}

#[test]
fn a_thirtieth_of_february_does_not_exist_and_clamps_every_year() {
    // The same rule for a leap and a non-leap year, so a regression in the
    // leap-year branch is impossible to miss.
    for (year, expected) in [
        (2024, "2024-02-29"),
        (2025, "2025-02-28"),
        (2100, "2100-02-28"),
    ] {
        let conn = test_conn();
        let group_id = group(&conn, 30_000, 20);
        let student_id = student(&conn, "Salma Idrissi", "0705566778");
        let enrollment =
            enroll_student(&conn, student_id, group_id, &format!("{}-01-31", year - 1)).unwrap();
        generate_monthly_invoices(&conn, 2, year).unwrap();
        let (_, _, due) = invoice_of(&conn, enrollment, 2, year);
        assert_eq!(due, expected);
    }
}

// ---------------------------------------------------------------------------
// 7–10. Payment edge cases
// ---------------------------------------------------------------------------

#[test]
fn overpayment_is_stored_as_an_advance_row() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "Amine Tazi", "0611223344");
    let enrollment = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();
    let (invoice_id, _, _) = invoice_of(&conn, enrollment, 3, 2026);

    record_payment(&conn, student_id, &[invoice_id], 50_000, "espèces", None).unwrap();

    let (status, paid) = invoice_status(&conn, invoice_id);
    assert_eq!(status, "payé");
    assert_eq!(paid, 30_000, "the invoice never holds more than its amount");

    let advance: i64 = conn
        .query_row(
            "SELECT amount_cents FROM payments
             WHERE student_id = ?1 AND invoice_id IS NULL",
            params![student_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(advance, 20_000, "the 200.00 DH surplus becomes an advance");

    // Two rows: the allocation and the advance, sharing one timestamp so the
    // receipt groups them.
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM payments"), 2);
}

#[test]
fn a_zero_payment_is_rejected_with_the_documented_message() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "Hamza Berrada", "0698765432");
    let enrollment = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();
    let (invoice_id, _, _) = invoice_of(&conn, enrollment, 3, 2026);

    for amount in [0, -100] {
        let error =
            record_payment(&conn, student_id, &[invoice_id], amount, "espèces", None).unwrap_err();
        assert_eq!(error, "Le montant doit être supérieur à 0");
    }
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM payments"), 0);
    assert_eq!(invoice_status(&conn, invoice_id).0, "impayé");
}

#[test]
fn partial_payments_accumulate_until_the_invoice_is_paid() {
    let conn = test_conn();
    let group_id = group(&conn, 40_000, 20);
    let student_id = student(&conn, "Nadia Chraibi", "0701234567");
    let enrollment = enroll_student(&conn, student_id, group_id, "2026-03-08").unwrap();
    let (invoice_id, _, _) = invoice_of(&conn, enrollment, 3, 2026);

    for (amount, expected_paid) in [(10_000, 10_000), (20_000, 30_000)] {
        record_payment(&conn, student_id, &[invoice_id], amount, "espèces", None).unwrap();
        let (status, paid) = invoice_status(&conn, invoice_id);
        assert_eq!(status, "partiel");
        assert_eq!(paid, expected_paid);
    }

    record_payment(&conn, student_id, &[invoice_id], 10_000, "espèces", None).unwrap();
    let (status, paid) = invoice_status(&conn, invoice_id);
    assert_eq!(status, "payé");
    assert_eq!(paid, 40_000);
    // Three payment rows, no advance.
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM payments"), 3);
    assert_eq!(
        scalar(
            &conn,
            "SELECT COUNT(*) FROM payments WHERE invoice_id IS NULL"
        ),
        0
    );
}

#[test]
fn paying_one_groups_fee_only_settles_the_oldest_invoice() {
    let conn = test_conn();
    let student_id = student(&conn, "Mehdi Skalli", "0612349876");

    // Three groups: 300, 400 and 200 DH, enrolled oldest first.
    let group_a = group(&conn, 30_000, 20);
    let group_b = group(&conn, 40_000, 20);
    let group_c = group(&conn, 20_000, 20);
    let enrollment_a = enroll_student(&conn, student_id, group_a, "2026-03-01").unwrap();
    let enrollment_b = enroll_student(&conn, student_id, group_b, "2026-03-02").unwrap();
    let enrollment_c = enroll_student(&conn, student_id, group_c, "2026-03-03").unwrap();
    let (invoice_a, _, _) = invoice_of(&conn, enrollment_a, 3, 2026);
    let (invoice_b, _, _) = invoice_of(&conn, enrollment_b, 3, 2026);
    let (invoice_c, _, _) = invoice_of(&conn, enrollment_c, 3, 2026);

    // The modal sends every selected invoice; 300 DH settles the oldest only.
    record_payment(
        &conn,
        student_id,
        &[invoice_a, invoice_b, invoice_c],
        30_000,
        "espèces",
        None,
    )
    .unwrap();

    assert_eq!(
        invoice_status(&conn, invoice_a),
        ("payé".to_string(), 30_000)
    );
    assert_eq!(invoice_status(&conn, invoice_b), ("impayé".to_string(), 0));
    assert_eq!(invoice_status(&conn, invoice_c), ("impayé".to_string(), 0));

    // The student still owes 600 DH, split over the two later invoices.
    let alerts = payment_alerts(&conn, 3, 2026).unwrap();
    let row = alerts
        .late
        .iter()
        .chain(alerts.upcoming.iter())
        .chain(alerts.current.iter())
        .find(|entry| entry.student_id == student_id)
        .expect("the student must appear in the alerts");
    assert_eq!(row.total_due_cents, 60_000);
}

// ---------------------------------------------------------------------------
// 11–14. Enrollment edge cases
// ---------------------------------------------------------------------------

#[test]
fn the_same_group_twice_is_refused_by_the_app_and_by_the_database() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "Imane Fassi", "0703456789");

    enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();
    let error = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap_err();
    assert_eq!(error, "Déjà inscrit dans ce groupe");
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM enrollments"), 1);

    // The UNIQUE (student_id, group_id) pair is the last line of defence: a
    // second row cannot exist even if the application check were removed.
    let raw = conn.execute(
        "INSERT INTO enrollments (student_id, group_id, start_date, status)
         VALUES (?1, ?2, '2026-03-05', 'actif')",
        params![student_id, group_id],
    );
    assert!(
        raw.is_err(),
        "the UNIQUE constraint must reject the duplicate"
    );
}

#[test]
fn a_full_group_refuses_the_next_student() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 2);
    let first = student(&conn, "Omar Benjelloun", "0655443322");
    let second = student(&conn, "Kenza Alaoui", "0709871234");
    let third = student(&conn, "Rachid Chraibi", "0666778899");

    enroll_student(&conn, first, group_id, "2026-03-01").unwrap();
    enroll_student(&conn, second, group_id, "2026-03-02").unwrap();
    assert_eq!(
        enroll_student(&conn, third, group_id, "2026-03-03").unwrap_err(),
        "Groupe complet"
    );
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM enrollments"), 2);

    // Ending one enrollment frees the seat again.
    let ended: i64 = conn
        .query_row(
            "SELECT id FROM enrollments WHERE student_id = ?1",
            params![first],
            |row| row.get(0),
        )
        .unwrap();
    end_enrollment(&conn, ended).unwrap();
    enroll_student(&conn, third, group_id, "2026-03-04").unwrap();
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM enrollments"), 3);
}

#[test]
fn ending_mid_month_keeps_the_current_invoice_and_creates_no_next_one() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "Hajar Sabri", "0702345678");

    // Enrolled on 15 October, ended on 20 October.
    let enrollment = enroll_student(&conn, student_id, group_id, "2026-10-15").unwrap();
    let (october_invoice, _, due) = invoice_of(&conn, enrollment, 10, 2026);
    assert_eq!(due, "2026-10-15");
    end_enrollment(&conn, enrollment).unwrap();

    // The October invoice is untouched…
    assert_eq!(invoice_status(&conn, october_invoice).0, "impayé");
    assert_eq!(
        text(&conn, "SELECT status FROM enrollments WHERE id = 1"),
        "terminé"
    );
    // The end date is the day the user ends it (today), never a guessed date.
    let end_date = text(
        &conn,
        "SELECT COALESCE(end_date, '') FROM enrollments WHERE id = 1",
    );
    assert_eq!(end_date.len(), 10, "end date must be stored: {end_date}");
    assert!(
        end_date >= "2026-10-15".to_string(),
        "end date cannot precede the start date: {end_date}"
    );

    // …and November generates nothing for this enrollment.
    assert_eq!(generate_monthly_invoices(&conn, 11, 2026).unwrap(), 0);
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM invoices"), 1);

    // A payment on the October invoice is still possible after the end.
    record_payment(
        &conn,
        student_id,
        &[october_invoice],
        30_000,
        "espèces",
        None,
    )
    .unwrap();
    assert_eq!(invoice_status(&conn, october_invoice).0, "payé");
}

#[test]
fn re_enrolling_reactivates_the_same_row_instead_of_duplicating_it() {
    // Documented behaviour (the alternative allowed by the checklist): the
    // UNIQUE (student_id, group_id) pair means a re-enrollment **reactivates**
    // the previous row. The history is kept in `audit_log` — every ENROLL row
    // records the start date — and by the invoices, which stay attached to the
    // enrollment id.
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "Anas Ouazzani", "0614567890");

    let first = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();
    end_enrollment(&conn, first).unwrap();
    let again = enroll_student(&conn, student_id, group_id, "2026-05-12").unwrap();

    assert_eq!(again, first, "same enrollment row, no duplicate");
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM enrollments"), 1);
    assert_eq!(
        text(&conn, "SELECT status FROM enrollments WHERE id = 1"),
        "actif"
    );
    assert_eq!(
        text(&conn, "SELECT start_date FROM enrollments WHERE id = 1"),
        "2026-05-12"
    );
    assert_eq!(
        text(
            &conn,
            "SELECT COALESCE(end_date, '') FROM enrollments WHERE id = 1"
        ),
        ""
    );

    // The new period gets its own invoice; the March one is still there.
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM invoices"), 2);
    let (_, _, may_due) = invoice_of(&conn, first, 5, 2026);
    assert_eq!(may_due, "2026-05-12");
    assert_eq!(
        scalar(
            &conn,
            "SELECT COUNT(*) FROM invoices WHERE period_month = 3"
        ),
        1
    );

    // Both enrollment events are in the audit trail.
    assert_eq!(
        scalar(
            &conn,
            "SELECT COUNT(*) FROM audit_log WHERE action = 'ENROLL'"
        ),
        2
    );
}

// ---------------------------------------------------------------------------
// 17–19. Data integrity
// ---------------------------------------------------------------------------

#[test]
fn a_level_used_by_a_group_cannot_be_deleted() {
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let level_id: i64 = conn
        .query_row(
            "SELECT level_id FROM groups WHERE id = ?1",
            params![group_id],
            |row| row.get(0),
        )
        .unwrap();

    let error = delete_level(&conn, level_id).unwrap_err();
    assert!(
        error.contains("utilisé par 1 groupe"),
        "unexpected error: {error}"
    );
    assert_eq!(
        scalar(
            &conn,
            &format!("SELECT COUNT(*) FROM levels WHERE id = {level_id}")
        ),
        1,
        "the level still exists"
    );
}

#[test]
fn deactivating_a_teacher_keeps_the_groups_readable() {
    let conn = test_conn();
    let teacher_id = create_teacher(
        &conn,
        &CreateTeacherInput {
            full_name: "Mohamed Alaoui".to_string(),
            phone: Some("0661112233".to_string()),
            email: None,
            notes: None,
            subject_ids: vec![1],
        },
    )
    .unwrap();
    set_compensation(&conn, teacher_id, "percentage", 4_000, Some(5.0)).unwrap();

    let group_id = create_group(
        &conn,
        &CreateGroupInput {
            subject_id: 1,
            level_id: 10,
            branch_id: None,
            teacher_id: Some(teacher_id),
            school_year_id: 1,
            day_of_week: "Lundi".to_string(),
            start_time: "16:00".to_string(),
            end_time: "18:00".to_string(),
            room: None,
            monthly_fee_cents: 30_000,
            capacity: 20,
        },
    )
    .unwrap();

    // The UI deactivates, it never deletes: `status` flips.
    conn.execute(
        "UPDATE teachers SET status = 'inactif' WHERE id = ?1",
        params![teacher_id],
    )
    .unwrap();

    let groups = list_groups(&conn, None, None).unwrap();
    let row = groups.iter().find(|group| group.id == group_id).unwrap();
    assert_eq!(
        row.teacher_name.as_deref(),
        Some("Mohamed Alaoui"),
        "the group keeps showing the (inactive) teacher instead of crashing"
    );
    assert_eq!(row.teacher_id, Some(teacher_id));

    // Enrollment and invoicing keep working on that group.
    let student_id = student(&conn, "Layla Bennani", "0708901234");
    enroll_student(&conn, student_id, group_id, "2026-03-04").unwrap();
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM invoices"), 1);
}

#[test]
fn a_backup_restores_the_data_after_a_deletion() {
    use std::fs;

    let dir = std::env::temp_dir().join(format!("cm-edge-backup-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let live = dir.join("centremanager.db");
    let snapshot = dir.join("backup.db");

    // 1. A real centre in a real file.
    {
        let conn = crate::db::open_connection_at(&live).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let group_id = group(&conn, 30_000, 20);
        let student_id = student(&conn, "Soufiane Cherkaoui", "0612340987");
        let enrollment = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();
        let (invoice_id, _, _) = invoice_of(&conn, enrollment, 3, 2026);
        record_payment(&conn, student_id, &[invoice_id], 30_000, "espèces", None).unwrap();

        // 2. Backup.
        super::backup::backup_file(&conn, &live, snapshot.to_str().unwrap()).unwrap();
        assert!(snapshot.exists());

        // 3. Delete the student (cascades to enrollments/invoices/payments).
        conn.execute("DELETE FROM students WHERE id = ?1", params![student_id])
            .unwrap();
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM students"), 0);
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
    }

    // 4. Restore = swap the file (the V1 procedure the UI documents).
    fs::copy(&snapshot, &live).unwrap();

    // 5. Everything is back.
    {
        let conn = crate::db::open_connection_at(&live).unwrap();
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM students"), 1);
        assert_eq!(
            text(&conn, "SELECT full_name FROM students"),
            "Soufiane Cherkaoui"
        );
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM enrollments"), 1);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM invoices"), 1);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM payments"), 1);
        assert_eq!(
            text(&conn, "SELECT status FROM invoices"),
            "payé",
            "the restored invoice keeps its settled status"
        );
    }

    let _ = fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Cross-check: the receipt of a demo-style payment stays consistent
// ---------------------------------------------------------------------------

#[test]
fn an_arabic_student_name_round_trips_unharmed() {
    // Case 15's data half: the RTL layout is a browser concern, but the name
    // itself must survive storage, search and the invoice list untouched.
    let conn = test_conn();
    let group_id = group(&conn, 30_000, 20);
    let student_id = student(&conn, "أحمد بن علي", "0612345678");
    let enrollment = enroll_student(&conn, student_id, group_id, "2026-03-05").unwrap();

    assert_eq!(text(&conn, "SELECT full_name FROM students"), "أحمد بن علي");
    let invoices = student_invoices(&conn, student_id).unwrap();
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0].id, invoice_of(&conn, enrollment, 3, 2026).0);
    // And the alert list (dashboard, badge) carries it byte for byte.
    let alerts = payment_alerts(&conn, 3, 2026).unwrap();
    assert!(alerts
        .late
        .iter()
        .chain(alerts.upcoming.iter())
        .chain(alerts.current.iter())
        .any(|entry| entry.student_name == "أحمد بن علي"));
}
