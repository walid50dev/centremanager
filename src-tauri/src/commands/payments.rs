//! Payment commands (Phase 5).
//!
//! Money is **prepaid** and **never deleted**: recording a payment allocates the
//! amount to the oldest unpaid invoices first (by `due_date`, then `id`), and
//! anything left over becomes an *advance* (`invoice_id = NULL`) for the next
//! months. Nothing in this module can remove a payment or an invoice.
//!
//! Receipts are **snapshots**: [`create_receipt`] copies the student name, the
//! amount, the payment date and the group labels into the `receipts` row, so a
//! later rename never rewrites an old receipt.

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use tauri::State;

use super::db_err;
use super::invoices::french_month_name;
use super::settings::get_setting_value;
use crate::db::Db;
use crate::models::{PaginatedPayments, PaymentRow, ReceiptData, ReceiptPeriod};

const ENTITY_TYPE: &str = "payment";

fn now_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Invoice status derived from the amounts, never from the caller.
pub fn status_for(paid_amount_cents: i64, amount_cents: i64) -> &'static str {
    if paid_amount_cents >= amount_cents {
        "payé"
    } else if paid_amount_cents > 0 {
        "partiel"
    } else {
        "impayé"
    }
}

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

/// Record money received from a student and allocate it to `invoice_ids`.
///
/// The allocation is oldest-first; a remaining amount is stored as an advance.
/// Returns the id of the **first** payment row created (used for the receipt).
pub fn record_payment(
    conn: &Connection,
    student_id: i64,
    invoice_ids: &[i64],
    amount_cents: i64,
    method: &str,
    notes: Option<&str>,
) -> Result<i64, String> {
    if amount_cents <= 0 {
        return Err("Le montant doit être supérieur à 0".to_string());
    }
    if invoice_ids.is_empty() {
        return Err("Aucune facture sélectionnée".to_string());
    }

    let student_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM students WHERE id = ?1)",
            params![student_id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Lecture de l'élève", err))?;
    if !student_exists {
        return Err("Élève introuvable".to_string());
    }

    // Every invoice must belong to this student — checked before touching money.
    for invoice_id in invoice_ids {
        let belongs: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM invoices i
                    JOIN enrollments e ON e.id = i.enrollment_id
                    WHERE i.id = ?1 AND e.student_id = ?2
                 )",
                params![invoice_id, student_id],
                |row| row.get(0),
            )
            .map_err(|err| db_err("Lecture de la facture", err))?;
        if !belongs {
            return Err(format!(
                "La facture #{invoice_id} n'appartient pas à cet élève"
            ));
        }
    }

    let method = {
        let trimmed = method.trim();
        if trimmed.is_empty() {
            "espèces".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let mut unique_ids: Vec<i64> = invoice_ids.to_vec();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| db_err("Ouverture de la transaction", err))?;

    // Oldest due date first (id breaks ties), exactly like the allocation rule.
    let mut invoices: Vec<(i64, i64, i64, String)> = Vec::with_capacity(unique_ids.len());
    for invoice_id in &unique_ids {
        let row = tx
            .query_row(
                "SELECT i.id, i.amount_cents, COALESCE(i.paid_amount_cents, 0),
                        COALESCE(i.due_date, '')
                 FROM invoices i
                 JOIN enrollments e ON e.id = i.enrollment_id
                 WHERE i.id = ?1 AND e.student_id = ?2",
                params![invoice_id, student_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .map_err(|err| db_err("Lecture de la facture", err))?;
        invoices.push(row);
    }
    invoices.sort_by(|a, b| a.3.cmp(&b.3).then(a.0.cmp(&b.0)));

    // Every row of one call shares this timestamp: it is what `create_receipt`
    // uses to regroup the allocation lines into a single receipt.
    let created_at = now_timestamp();
    let mut leftover = amount_cents;
    let mut first_payment_id: Option<i64> = None;
    let mut allocations: Vec<(i64, i64)> = Vec::new();

    for (invoice_id, amount, paid, _) in &invoices {
        if leftover <= 0 {
            break;
        }
        let remaining = (*amount - *paid).max(0);
        if remaining <= 0 {
            continue;
        }

        let allocate = remaining.min(leftover);
        tx.execute(
            "INSERT INTO payments
                (student_id, invoice_id, amount_cents, payment_method, notes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![student_id, invoice_id, allocate, method, notes, created_at],
        )
        .map_err(|err| db_err("Enregistrement du paiement", err))?;
        let payment_id = tx.last_insert_rowid();
        if first_payment_id.is_none() {
            first_payment_id = Some(payment_id);
        }
        allocations.push((*invoice_id, allocate));

        let new_paid = paid + allocate;
        tx.execute(
            "UPDATE invoices SET paid_amount_cents = ?1, status = ?2 WHERE id = ?3",
            params![new_paid, status_for(new_paid, *amount), invoice_id],
        )
        .map_err(|err| db_err("Mise à jour de la facture", err))?;

        leftover -= allocate;
    }

    // Anything left is an advance on future invoices.
    let mut advance_cents = 0_i64;
    if leftover > 0 {
        tx.execute(
            "INSERT INTO payments
                (student_id, invoice_id, amount_cents, payment_method, notes, created_at)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
            params![student_id, leftover, method, notes, created_at],
        )
        .map_err(|err| db_err("Enregistrement de l'avance", err))?;
        if first_payment_id.is_none() {
            first_payment_id = Some(tx.last_insert_rowid());
        }
        advance_cents = leftover;
    }

    let first_id = first_payment_id.ok_or_else(|| "Aucun montant à affecter".to_string())?;

    tx.execute(
        "INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('PAYMENT', ?1, ?2, ?3)",
        params![
            ENTITY_TYPE,
            first_id,
            json!({
                "student_id": student_id,
                "amount_cents": amount_cents,
                "method": method,
                "invoice_ids": unique_ids,
                "allocations": allocations
                    .iter()
                    .map(|(invoice_id, amount)| json!({ "invoice_id": invoice_id, "amount_cents": amount }))
                    .collect::<Vec<_>>(),
                "advance_cents": advance_cents,
                "created_at": created_at,
            })
            .to_string()
        ],
    )
    .map_err(|err| db_err("Journalisation de l'audit", err))?;

    tx.commit()
        .map_err(|err| db_err("Validation du paiement", err))?;

    Ok(first_id)
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/// Paginated payment history, optionally filtered by student and/or month.
pub fn payments_history(
    conn: &Connection,
    student_id: Option<i64>,
    month: Option<i32>,
    year: Option<i32>,
    page: i32,
    limit: i32,
) -> Result<PaginatedPayments, String> {
    // The month filter needs both halves; a lone month is ignored.
    let (filter_month, filter_year) = match (month, year) {
        (Some(m), Some(y)) => (Some(m), Some(y)),
        _ => (None, None),
    };

    let page = page.max(1);
    let limit = limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    let where_clause = "WHERE (?1 IS NULL OR p.student_id = ?1)
        AND (?2 IS NULL OR (i.period_month = ?2 AND i.period_year = ?3))";

    let total: i32 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*)
                 FROM payments p
                 LEFT JOIN invoices i ON i.id = p.invoice_id
                 {where_clause}"
            ),
            params![student_id, filter_month, filter_year],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Comptage des paiements", err))?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT p.id, p.student_id, s.full_name, p.invoice_id, p.amount_cents,
                    COALESCE(p.payment_method, ''), p.notes, COALESCE(p.created_at, '')
             FROM payments p
             JOIN students s ON s.id = p.student_id
             LEFT JOIN invoices i ON i.id = p.invoice_id
             {where_clause}
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT ?4 OFFSET ?5"
        ))
        .map_err(|err| db_err("Lecture des paiements", err))?;

    let rows = stmt
        .query_map(
            params![student_id, filter_month, filter_year, limit, offset],
            |row| {
                Ok(PaymentRow {
                    id: row.get(0)?,
                    student_id: row.get(1)?,
                    student_name: row.get(2)?,
                    invoice_id: row.get(3)?,
                    amount_cents: row.get(4)?,
                    payment_method: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(|err| db_err("Lecture des paiements", err))?;

    let data = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des paiements", err))?;

    Ok(PaginatedPayments {
        data,
        total,
        page,
        limit,
    })
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/// Payment rows created by the same `cmd_record_payment` call.
fn receipt_session(
    conn: &Connection,
    student_id: i64,
    created_at: &str,
) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM payments
             WHERE student_id = ?1 AND created_at = ?2
             ORDER BY id",
        )
        .map_err(|err| db_err("Lecture des paiements", err))?;
    let rows = stmt
        .query_map(params![student_id, created_at], |row| row.get::<_, i64>(0))
        .map_err(|err| db_err("Lecture des paiements", err))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des paiements", err))
}

/// Group labels covered by a list of payment rows (deduplicated, ordered).
fn groups_of_payments(conn: &Connection, payment_ids: &[i64]) -> Result<Vec<String>, String> {
    let mut labels: Vec<String> = Vec::new();
    for payment_id in payment_ids {
        let label: Option<String> = conn
            .query_row(
                "SELECT TRIM(COALESCE(su.name, '') || ' ' || COALESCE(l.name, ''))
                 FROM payments p
                 JOIN invoices i    ON i.id = p.invoice_id
                 JOIN enrollments e ON e.id = i.enrollment_id
                 JOIN groups g      ON g.id = e.group_id
                 LEFT JOIN subjects su ON su.id = g.subject_id
                 LEFT JOIN levels l    ON l.id = g.level_id
                 WHERE p.id = ?1",
                params![payment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| db_err("Lecture du groupe", err))?;

        if let Some(label) = label {
            let label = label.trim().to_string();
            if !label.is_empty() && !labels.contains(&label) {
                labels.push(label);
            }
        }
    }
    Ok(labels)
}

/// Periods covered by a list of payment rows, oldest first.
fn periods_of_payments(
    conn: &Connection,
    payment_ids: &[i64],
) -> Result<Vec<ReceiptPeriod>, String> {
    let mut periods: Vec<ReceiptPeriod> = Vec::new();
    for payment_id in payment_ids {
        let period: Option<(i64, i64)> = conn
            .query_row(
                "SELECT i.period_month, i.period_year
                 FROM payments p JOIN invoices i ON i.id = p.invoice_id
                 WHERE p.id = ?1",
                params![payment_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|err| db_err("Lecture de la période", err))?;

        if let Some((month, year)) = period {
            let entry = ReceiptPeriod {
                month: month as i32,
                year: year as i32,
            };
            if !periods
                .iter()
                .any(|p| p.month == entry.month && p.year == entry.year)
            {
                periods.push(entry);
            }
        }
    }
    periods.sort_by(|a, b| a.year.cmp(&b.year).then(a.month.cmp(&b.month)));
    Ok(periods)
}

/// Create (or reuse) the frozen receipt of a payment.
pub fn create_receipt(conn: &Connection, payment_id: i64) -> Result<i64, String> {
    let payment: Option<(i64, String)> = conn
        .query_row(
            "SELECT student_id, COALESCE(created_at, '') FROM payments WHERE id = ?1",
            params![payment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| db_err("Lecture du paiement", err))?;

    let Some((student_id, created_at)) = payment else {
        return Err("Paiement introuvable".to_string());
    };

    // Printing twice must not spawn a second receipt.
    if let Some(existing) = conn
        .query_row(
            "SELECT id FROM receipts WHERE payment_id = ?1 ORDER BY id LIMIT 1",
            params![payment_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|err| db_err("Lecture du reçu", err))?
    {
        return Ok(existing);
    }

    let student_name: String = conn
        .query_row(
            "SELECT full_name FROM students WHERE id = ?1",
            params![student_id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Lecture de l'élève", err))?;

    let session = receipt_session(conn, student_id, &created_at)?;
    let amount_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM payments
             WHERE student_id = ?1 AND created_at = ?2",
            params![student_id, created_at],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Total du paiement", err))?;

    if amount_cents <= 0 {
        return Err("Aucun montant à justifier".to_string());
    }

    let groups_text = groups_of_payments(conn, &session)?.join(", ");
    let center_name = get_setting_value(conn, "center_name")?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Centre".to_string());

    // REC-YYYYMMDD-XXXX, numbered per day of *payment*.
    let day_stamp: String = created_at
        .chars()
        .take(10)
        .collect::<String>()
        .replace('-', "");
    let day_stamp = if day_stamp.len() == 8 {
        day_stamp
    } else {
        Local::now().format("%Y%m%d").to_string()
    };

    let mut attempt = 0_i64;
    loop {
        let used: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM receipts WHERE receipt_number LIKE ?1",
                params![format!("REC-{day_stamp}-%")],
                |row| row.get(0),
            )
            .map_err(|err| db_err("Comptage des reçus", err))?;
        let number = format!("REC-{day_stamp}-{:04}", used + 1 + attempt);

        match conn.execute(
            "INSERT INTO receipts
                (payment_id, receipt_number, student_name, amount_cents, payment_date, groups_text, center_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                payment_id,
                number,
                student_name,
                amount_cents,
                created_at,
                groups_text,
                center_name
            ],
        ) {
            Ok(_) => {
                let receipt_id = conn.last_insert_rowid();
                conn.execute(
                    "INSERT INTO audit_log (action, entity_type, entity_id, details)
                     VALUES ('RECEIPT', 'receipt', ?1, ?2)",
                    params![
                        receipt_id,
                        json!({
                            "payment_id": payment_id,
                            "receipt_number": number,
                            "student_id": student_id,
                            "amount_cents": amount_cents,
                        })
                        .to_string()
                    ],
                )
                .map_err(|err| db_err("Journalisation de l'audit", err))?;
                return Ok(receipt_id);
            }
            // Number already taken (same second, other receipt): try the next one.
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.code == rusqlite::ErrorCode::ConstraintViolation && attempt < 50 =>
            {
                attempt += 1;
            }
            Err(err) => return Err(db_err("Création du reçu", err)),
        }
    }
}

/// Everything printed on a receipt: frozen row + centre identity.
pub fn receipt_data(conn: &Connection, receipt_id: i64) -> Result<ReceiptData, String> {
    let row: Option<(String, String, i64, String, String, String, Option<i64>)> = conn
        .query_row(
            "SELECT COALESCE(receipt_number, ''),
                    COALESCE(student_name, ''),
                    COALESCE(amount_cents, 0),
                    COALESCE(payment_date, ''),
                    COALESCE(groups_text, ''),
                    COALESCE(center_name, ''),
                    payment_id
             FROM receipts WHERE id = ?1",
            params![receipt_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|err| db_err("Lecture du reçu", err))?;

    let Some((
        receipt_number,
        student_name,
        amount_cents,
        payment_date,
        groups_text,
        center_name,
        payment_id,
    )) = row
    else {
        return Err("Reçu introuvable".to_string());
    };

    // Method and periods live on the (immutable) payment rows of the session.
    let (payment_method, periods) = match payment_id {
        Some(payment_id) => {
            let method: String = conn
                .query_row(
                    "SELECT COALESCE(payment_method, '') FROM payments WHERE id = ?1",
                    params![payment_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|err| db_err("Lecture du paiement", err))?
                .unwrap_or_default();

            let session = conn
                .query_row(
                    "SELECT student_id, COALESCE(created_at, '') FROM payments WHERE id = ?1",
                    params![payment_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(|err| db_err("Lecture du paiement", err))?;

            let periods = match session {
                Some((student_id, created_at)) => {
                    let ids = receipt_session(conn, student_id, &created_at)?;
                    periods_of_payments(conn, &ids)?
                }
                None => Vec::new(),
            };
            (method, periods)
        }
        None => (String::new(), Vec::new()),
    };

    let period_text = periods
        .iter()
        .map(|period| format!("{} {}", french_month_name(period.month), period.year))
        .collect::<Vec<_>>()
        .join(", ");

    Ok(ReceiptData {
        receipt_number,
        center_name: if center_name.trim().is_empty() {
            get_setting_value(conn, "center_name")?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Centre".to_string())
        } else {
            center_name
        },
        center_address: get_setting_value(conn, "center_address")?,
        center_phone: get_setting_value(conn, "center_phone")?,
        center_logo: get_setting_value(conn, "center_logo")?,
        student_name,
        amount_cents,
        payment_date,
        payment_method,
        groups_text,
        period_text,
        periods,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_record_payment(
    db: State<'_, Db>,
    student_id: i64,
    invoice_ids: Vec<i64>,
    amount_cents: i64,
    method: String,
    notes: Option<String>,
) -> Result<i64, String> {
    let conn = db.conn();
    record_payment(
        &conn,
        student_id,
        &invoice_ids,
        amount_cents,
        &method,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn cmd_get_payments_history(
    db: State<'_, Db>,
    student_id: Option<i64>,
    month: Option<i32>,
    year: Option<i32>,
    page: Option<i32>,
    limit: Option<i32>,
) -> Result<PaginatedPayments, String> {
    let conn = db.conn();
    payments_history(
        &conn,
        student_id,
        month,
        year,
        page.unwrap_or(1),
        limit.unwrap_or(20),
    )
}

#[tauri::command]
pub fn cmd_create_receipt(db: State<'_, Db>, payment_id: i64) -> Result<i64, String> {
    let conn = db.conn();
    create_receipt(&conn, payment_id)
}

#[tauri::command]
pub fn cmd_get_receipt_data(db: State<'_, Db>, receipt_id: i64) -> Result<ReceiptData, String> {
    let conn = db.conn();
    receipt_data(&conn, receipt_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::enrollments::enroll_student;
    use crate::commands::groups::{create_group, CreateGroupInput};
    use crate::commands::invoices::student_invoices;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn group(conn: &Connection, fee: i64) -> i64 {
        group_of(conn, 1, 10, fee)
    }

    fn group_of(conn: &Connection, subject_id: i64, level_id: i64, fee: i64) -> i64 {
        create_group(
            conn,
            &CreateGroupInput {
                subject_id,
                level_id,
                branch_id: None,
                teacher_id: None,
                school_year_id: 1,
                day_of_week: "Lundi".to_string(),
                start_time: "16:00".to_string(),
                end_time: "18:00".to_string(),
                room: None,
                monthly_fee_cents: fee,
                capacity: 20,
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

    fn invoice_ids(conn: &Connection, student_id: i64) -> Vec<i64> {
        student_invoices(conn, student_id)
            .unwrap()
            .into_iter()
            .map(|invoice| invoice.id)
            .collect()
    }

    #[test]
    fn status_follows_the_amounts() {
        assert_eq!(status_for(0, 30_000), "impayé");
        assert_eq!(status_for(1, 30_000), "partiel");
        assert_eq!(status_for(29_999, 30_000), "partiel");
        assert_eq!(status_for(30_000, 30_000), "payé");
        assert_eq!(status_for(31_000, 30_000), "payé");
    }

    #[test]
    fn full_payment_settles_the_invoice() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        let payment_id = record_payment(&conn, s, &ids, 30_000, "espèces", Some("mars")).unwrap();
        assert!(payment_id > 0);

        let invoices = student_invoices(&conn, s).unwrap();
        assert_eq!(invoices[0].status, "payé");
        assert_eq!(invoices[0].paid_amount_cents, 30_000);
        assert_eq!(invoices[0].remaining_cents, 0);

        // Audit trail carries the allocation.
        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log WHERE action = 'PAYMENT' ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("\"amount_cents\":30000"));
        assert!(details.contains("\"advance_cents\":0"));
    }

    #[test]
    fn partial_payment_leaves_the_invoice_partial() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        record_payment(&conn, s, &ids, 10_000, "virement", None).unwrap();
        let invoices = student_invoices(&conn, s).unwrap();
        assert_eq!(invoices[0].status, "partiel");
        assert_eq!(invoices[0].remaining_cents, 20_000);
    }

    #[test]
    fn allocation_goes_to_the_oldest_invoice_first() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-01-10").unwrap();
        crate::commands::invoices::generate_monthly_invoices(&conn, 2, 2026).unwrap();
        crate::commands::invoices::generate_monthly_invoices(&conn, 3, 2026).unwrap();

        let invoices = student_invoices(&conn, s).unwrap();
        assert_eq!(invoices.len(), 3);
        // Pass them newest-first on purpose: the backend must re-sort.
        let newest_first: Vec<i64> = invoices.iter().map(|invoice| invoice.id).collect();
        record_payment(&conn, s, &newest_first, 45_000, "espèces", None).unwrap();

        let after = student_invoices(&conn, s).unwrap();
        let january = after.iter().find(|i| i.period_month == 1).unwrap();
        let february = after.iter().find(|i| i.period_month == 2).unwrap();
        let march = after.iter().find(|i| i.period_month == 3).unwrap();

        // 45 000 = January in full (30 000) + 15 000 on February.
        assert_eq!(january.status, "payé");
        assert_eq!(february.status, "partiel");
        assert_eq!(february.paid_amount_cents, 15_000);
        assert_eq!(february.remaining_cents, 15_000);
        assert_eq!(march.status, "impayé");
        assert_eq!(march.paid_amount_cents, 0);
    }

    #[test]
    fn overpayment_becomes_an_advance() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        record_payment(&conn, s, &ids, 40_000, "espèces", None).unwrap();

        let (advance, invoice): (i64, Option<i64>) = conn
            .query_row(
                "SELECT amount_cents, invoice_id FROM payments
                 WHERE invoice_id IS NULL ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(advance, 10_000);
        assert!(invoice.is_none());

        let invoices = student_invoices(&conn, s).unwrap();
        assert_eq!(invoices[0].status, "payé");
    }

    #[test]
    fn invalid_payments_are_rejected() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        let other = student(&conn, "Yassine", "0612345679");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        assert!(record_payment(&conn, s, &ids, 0, "espèces", None).is_err());
        assert!(record_payment(&conn, s, &ids, -500, "espèces", None).is_err());
        assert!(record_payment(&conn, s, &[], 1_000, "espèces", None).is_err());
        // Someone else's invoice.
        let error = record_payment(&conn, other, &ids, 1_000, "espèces", None).unwrap_err();
        assert!(error.contains("n'appartient pas"));
        // Nothing was written.
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM payments", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn history_is_paginated_and_filtered() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s1 = student(&conn, "Salma", "0612345678");
        let s2 = student(&conn, "Yassine", "0612345679");
        enroll_student(&conn, s1, g, "2026-03-01").unwrap();
        enroll_student(&conn, s2, g, "2026-03-01").unwrap();

        for student in [s1, s2] {
            let ids = invoice_ids(&conn, student);
            record_payment(&conn, student, &ids, 10_000, "espèces", None).unwrap();
        }

        let all = payments_history(&conn, None, None, None, 1, 20).unwrap();
        assert_eq!(all.total, 2);
        assert_eq!(all.data.len(), 2);

        let filtered = payments_history(&conn, Some(s1), None, None, 1, 20).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.data[0].student_id, s1);
        assert_eq!(filtered.data[0].student_name, "Salma");

        let by_period = payments_history(&conn, None, Some(3), Some(2026), 1, 20).unwrap();
        assert_eq!(by_period.total, 2);
        let other_period = payments_history(&conn, None, Some(4), Some(2026), 1, 20).unwrap();
        assert_eq!(other_period.total, 0);

        let page_two = payments_history(&conn, None, None, None, 2, 1).unwrap();
        assert_eq!(page_two.data.len(), 1);
        assert_eq!(page_two.page, 2);
    }

    #[test]
    fn receipt_freezes_the_student_name_and_totals() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma Benjelloun", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        let payment_id = record_payment(&conn, s, &ids, 30_000, "espèces", None).unwrap();
        let receipt_id = create_receipt(&conn, payment_id).unwrap();

        // The student is renamed after the receipt was issued…
        conn.execute(
            "UPDATE students SET full_name = 'Salma B. (mariée)' WHERE id = ?1",
            params![s],
        )
        .unwrap();

        let data = receipt_data(&conn, receipt_id).unwrap();
        assert_eq!(data.student_name, "Salma Benjelloun");
        assert_eq!(data.amount_cents, 30_000);
        assert_eq!(data.payment_method, "espèces");
        assert!(data.receipt_number.starts_with("REC-"));
        assert!(data.groups_text.contains("Mathématiques"));
        assert_eq!(data.period_text, "Mars 2026");
        assert_eq!(data.periods.len(), 1);
        assert_eq!(data.periods[0].month, 3);
    }

    #[test]
    fn receipt_number_is_unique_per_day() {
        let conn = test_conn();
        let g = group(&conn, 30_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        crate::commands::invoices::generate_monthly_invoices(&conn, 4, 2026).unwrap();

        let ids = invoice_ids(&conn, s);
        assert_eq!(ids.len(), 2);
        let first = record_payment(&conn, s, &[ids[0]], 10_000, "espèces", None).unwrap();
        let second = record_payment(&conn, s, &[ids[1]], 10_000, "espèces", None).unwrap();

        let r1 = create_receipt(&conn, first).unwrap();
        let r2 = create_receipt(&conn, second).unwrap();
        assert_ne!(r1, r2);

        let n1 = receipt_data(&conn, r1).unwrap().receipt_number;
        let n2 = receipt_data(&conn, r2).unwrap().receipt_number;
        assert_ne!(n1, n2);
        assert!(n1.ends_with("-0001"));
        assert!(n2.ends_with("-0002"));

        // Printing again returns the same receipt, never a duplicate.
        assert_eq!(create_receipt(&conn, first).unwrap(), r1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM receipts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn receipt_covers_every_invoice_paid_at_once() {
        let conn = test_conn();
        let g1 = group_of(&conn, 1, 10, 30_000); // Mathématiques — Tronc Commun
        let g2 = group_of(&conn, 2, 11, 25_000); // Physique-Chimie — 1ère Bac
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g1, "2026-03-01").unwrap();
        enroll_student(&conn, s, g2, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        let payment_id = record_payment(&conn, s, &ids, 55_000, "chèque", None).unwrap();
        let receipt_id = create_receipt(&conn, payment_id).unwrap();
        let data = receipt_data(&conn, receipt_id).unwrap();

        assert_eq!(data.amount_cents, 55_000);
        assert!(data.groups_text.contains("Mathématiques"));
        assert!(data.groups_text.contains("Physique-Chimie"));
        assert_eq!(data.groups_text.matches(", ").count(), 1);
        // One payment row per invoice, one receipt for the pair.
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM payments", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[test]
    fn receipt_totals_the_invoice_and_the_advance() {
        let conn = test_conn();
        let g = group(&conn, 10_000);
        let s = student(&conn, "Salma", "0612345678");
        enroll_student(&conn, s, g, "2026-03-01").unwrap();
        let ids = invoice_ids(&conn, s);

        let payment_id = record_payment(&conn, s, &ids, 25_000, "espèces", None).unwrap();
        let receipt_id = create_receipt(&conn, payment_id).unwrap();
        let data = receipt_data(&conn, receipt_id).unwrap();
        assert_eq!(data.amount_cents, 25_000);
        assert_eq!(data.groups_text, "Mathématiques Tronc Commun");
    }

    #[test]
    fn unknown_ids_are_reported() {
        let conn = test_conn();
        assert!(create_receipt(&conn, 999).is_err());
        assert!(receipt_data(&conn, 999).is_err());
    }
}
