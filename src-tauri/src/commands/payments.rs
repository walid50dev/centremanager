//! Payment commands (Phase 5).
//!
//! Money is **prepaid**: recording a payment allocates the
//! amount to the oldest unpaid invoices first (by `due_date`, then `id`), and
//! anything left over becomes an *advance* (`invoice_id = NULL`) for the next
//! months. Explicit deletion removes an entire payment batch and recalculates invoices.
//!
//! Receipts are **snapshots**: [`create_receipt`] copies the student name, the
//! amount, the payment date and the group labels into the `receipts` row, so a
//! later rename never rewrites an old receipt.

use chrono::{Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use tauri::State;

use super::db_err;
use super::invoices::french_month_name;
use super::settings::get_setting_value;
use crate::db::Db;
use crate::models::{PaginatedPayments, PaymentRow, ReceiptData, ReceiptItem, ReceiptPeriod};

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
    record_payment_at(conn, student_id, invoice_ids, amount_cents, method, notes, None)
}

pub fn record_payment_at(
    conn: &Connection, student_id: i64, invoice_ids: &[i64], amount_cents: i64,
    method: &str, notes: Option<&str>, payment_date: Option<&str>,
) -> Result<i64, String> {
    let timestamp = if let Some(value) = payment_date {
        let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Date de paiement invalide".to_string())?;
        let today = Local::now().date_naive();
        let (start, end): (Option<String>, Option<String>) = conn.query_row(
            "SELECT start_date, end_date FROM school_years WHERE is_active=1 LIMIT 1", [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| db_err("Année scolaire", e))?;
        let canonical_date = date.format("%Y-%m-%d").to_string();
        if value != canonical_date.as_str() || date > today || (date != today && (start.as_deref().map_or(true, |s| value < s) || end.as_deref().map_or(true, |e| value > e))) {
            return Err("La date doit être passée et comprise dans l'année scolaire active".to_string());
        }
        format!("{} {}", date.format("%Y-%m-%d"), Local::now().format("%H:%M:%S"))
    } else { now_timestamp() };
    if amount_cents <= 0 {
        return Err("Le montant doit être supérieur à 0".to_string());
    }
    if invoice_ids.is_empty() {
        return Err("Aucune facture sélectionnée".to_string());
    }

    let student_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM students WHERE id = ?1 AND deleted_at IS NULL)",
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
                    LEFT JOIN enrollments e ON e.id = i.enrollment_id
                    LEFT JOIN groups g ON g.id=e.group_id
                    LEFT JOIN enrollment_fees f ON f.invoice_id=i.id
                    WHERE i.id = ?1 AND ((e.student_id = ?2 AND g.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)) OR (f.student_id=?2 AND f.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)))
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
                 LEFT JOIN enrollments e ON e.id = i.enrollment_id
                 LEFT JOIN enrollment_fees f ON f.invoice_id=i.id
                 WHERE i.id = ?1 AND (e.student_id = ?2 OR f.student_id = ?2)",
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

    // Every allocation shares the timestamp and a durable transaction batch id.
    let created_at = timestamp;
    let mut leftover = amount_cents;
    let mut first_payment_id: Option<i64> = None;
    let mut allocations: Vec<(i64, i64)> = Vec::new();
    let mut payment_ids: Vec<i64> = Vec::new();

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
        payment_ids.push(payment_id);
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
        let id = tx.last_insert_rowid();
        payment_ids.push(id);
        if first_payment_id.is_none() {
            first_payment_id = Some(id);
        }
        advance_cents = leftover;
    }

    let first_id = first_payment_id.ok_or_else(|| "Aucun montant à affecter".to_string())?;

    for id in &payment_ids {
        tx.execute("UPDATE payments SET batch_id = ?1, school_year_id = (SELECT id FROM school_years WHERE is_active=1 LIMIT 1) WHERE id = ?2", params![first_id, id])
            .map_err(|err| db_err("Regroupement du paiement", err))?;
    }

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

    let where_clause = "WHERE (p.school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1) OR p.school_year_id IS NULL) AND (?1 IS NULL OR p.student_id = ?1)
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
                    COALESCE(p.payment_method, ''), p.notes, COALESCE(p.created_at, ''), i.period_month, i.period_year, COALESCE(NULLIF(TRIM(g.name),''), TRIM(COALESCE(su.name,'') || ' ' || COALESCE(l.name,''))), CASE WHEN f.id IS NOT NULL THEN 'enrollment_fee' WHEN p.invoice_id IS NULL THEN 'advance' ELSE 'invoice' END, y.label
             FROM payments p
             JOIN students s ON s.id = p.student_id
             LEFT JOIN invoices i ON i.id = p.invoice_id
             LEFT JOIN enrollment_fees f ON f.invoice_id=i.id
             LEFT JOIN school_years y ON y.id=f.school_year_id
             LEFT JOIN enrollments e ON e.id=i.enrollment_id
             LEFT JOIN groups g ON g.id=e.group_id
             LEFT JOIN subjects su ON su.id=g.subject_id
             LEFT JOIN levels l ON l.id=g.level_id
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
                    period_month: row.get(8)?,
                    period_year: row.get(9)?,
                    group_name: row.get(10)?,
                    invoice_kind: row.get(11)?,
                    school_year_label: row.get(12)?,
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

/// Payment rows in one transaction. New payments have a durable batch id.
/// For old payments, audit transaction boundaries avoid combining payments made
/// in the same second; without an audit record only the known row is used.
fn receipt_session(conn: &Connection, payment_id: i64) -> Result<Vec<i64>, String> {
    let (student, stamp, batch): (i64, String, Option<i64>) = conn.query_row(
        "SELECT student_id, COALESCE(created_at, ''), batch_id FROM payments WHERE id=?1",
        params![payment_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| db_err("Lecture du paiement", e))?;
    if let Some(batch_id) = batch {
        let mut stmt = conn.prepare("SELECT id FROM payments WHERE batch_id=?1 ORDER BY id")
            .map_err(|e| db_err("Lecture des paiements", e))?;
        let rows = stmt.query_map(params![batch_id], |r| r.get(0)).map_err(|e| db_err("Lecture des paiements", e))?;
        return rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| db_err("Lecture des paiements", e));
    }
    let first: Option<i64> = conn.query_row(
        "SELECT MAX(entity_id) FROM audit_log WHERE action='PAYMENT' AND entity_type='payment' AND entity_id<=?1",
        params![payment_id], |r| r.get(0)).map_err(|e| db_err("Lecture du journal", e))?;
    if let Some(first) = first {
        let mut stmt = conn.prepare("SELECT p.id FROM payments p JOIN payments base ON base.id=?1
          WHERE base.student_id=?2 AND COALESCE(base.created_at,'')=?3 AND p.student_id=?2 AND COALESCE(p.created_at,'')=?3
          AND p.batch_id IS NULL AND p.id>=?1 AND p.id<COALESCE((SELECT MIN(entity_id) FROM audit_log WHERE action='PAYMENT' AND entity_type='payment' AND entity_id>?1), 9223372036854775807) ORDER BY p.id")
          .map_err(|e| db_err("Lecture des paiements", e))?;
        let ids = stmt.query_map(params![first, student, stamp], |r| r.get(0))
            .map_err(|e| db_err("Lecture des paiements", e))?
            .collect::<rusqlite::Result<Vec<i64>>>().map_err(|e| db_err("Lecture des paiements", e))?;
        if ids.contains(&payment_id) { return Ok(ids); }
    }
    Ok(vec![payment_id])
}

/// Delete one whole transaction, including its receipt, atomically. Each history
/// row is an allocation; deleting one must not leave a partially valid receipt.
pub fn delete_payment(conn: &Connection, payment_id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| db_err("Ouverture de la transaction", e))?;
    let ids = receipt_session(&tx, payment_id)?;
    let owner: i64 = tx.query_row("SELECT student_id FROM payments WHERE id=?1", params![payment_id], |r| r.get(0)).map_err(|e| db_err("Lecture du paiement",e))?;
    let mut removed = Vec::new();
    for id in &ids {
        let (student_id, invoice_id, amount, allowed): (i64, Option<i64>, i64, bool) = tx.query_row(
            "SELECT student_id, invoice_id, amount_cents, (school_year_id IS NULL OR school_year_id=(SELECT id FROM school_years WHERE is_active=1 LIMIT 1)) FROM payments WHERE id=?1", params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| db_err("Lecture du paiement", e))?;
        if !allowed { return Err("Paiement hors de l'année scolaire active".into()); }
        if student_id != owner { return Err("Transaction incohérente ; suppression annulée".into()); }
        if let Some(invoice) = invoice_id {
            let (paid, due, previous_status): (i64, i64, String) = tx.query_row("SELECT COALESCE(paid_amount_cents,0),amount_cents,COALESCE(status,'impayé') FROM invoices WHERE id=?1", params![invoice], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e| db_err("Lecture de la facture", e))?;
            if amount < 0 || paid < amount { return Err("Paiement incohérent avec la facture ; suppression annulée".into()); }
            let remaining_paid = paid - amount;
            tx.execute("UPDATE invoices SET paid_amount_cents=?1,status=?2 WHERE id=?3", params![remaining_paid,if previous_status == "annulé" { "annulé" } else { status_for(remaining_paid,due) },invoice]).map_err(|e| db_err("Mise à jour de la facture",e))?;
        }
        removed.push(json!({"id":id,"student_id":student_id,"invoice_id":invoice_id,"amount_cents":amount}));
    }
    for id in &ids {
        tx.execute("DELETE FROM receipts WHERE payment_id=?1", params![id]).map_err(|e|db_err("Suppression du reçu",e))?;
        tx.execute("DELETE FROM payments WHERE id=?1", params![id]).map_err(|e|db_err("Suppression du paiement",e))?;
    }
    tx.execute("INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('DELETE_PAYMENT','payment',?1,?2)", params![payment_id,json!({"student_id":owner,"deleted_allocations":removed}).to_string()]).map_err(|e|db_err("Journalisation",e))?;
    tx.commit().map_err(|e| db_err("Validation de la suppression",e))
}

#[tauri::command]
pub fn cmd_delete_payment(db: State<'_, Db>, payment_id: i64) -> Result<(), String> { delete_payment(&db.conn(), payment_id) }

fn receipt_items(conn: &Connection, ids: &[i64]) -> Result<Vec<ReceiptItem>, String> {
    let mut items = Vec::new();
    for id in ids {
        let row: (i64, Option<i64>, String, String, String, Option<i32>, Option<i32>, Option<String>, String) = conn.query_row(
            "SELECT p.amount_cents, p.invoice_id, COALESCE(s.name,''), COALESCE(l.name,''), COALESCE(b.name,''), i.period_month, i.period_year, CASE WHEN f.id IS NOT NULL THEN COALESCE(y.label,'') ELSE NULL END, COALESCE(g.name,'')
             FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id
             LEFT JOIN enrollment_fees f ON f.invoice_id=i.id LEFT JOIN school_years y ON y.id=f.school_year_id
             LEFT JOIN enrollments e ON e.id=i.enrollment_id LEFT JOIN groups g ON g.id=e.group_id
             LEFT JOIN subjects s ON s.id=g.subject_id LEFT JOIN levels l ON l.id=g.level_id
             LEFT JOIN branches b ON b.id=g.branch_id WHERE p.id=?1", params![id],
            |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)))
            .map_err(|e| db_err("Lecture des détails du reçu", e))?;
        let (amount, invoice, subject, level, branch, month, year, school_year, custom_name) = row;
        let group_name = if custom_name.trim().is_empty() { [level.as_str(), branch.as_str()].into_iter().filter(|v| !v.trim().is_empty()).collect::<Vec<_>>().join(" · ") } else { custom_name };
        items.push(ReceiptItem { subject, group_name, month: school_year.clone().unwrap_or_else(|| match (month, year) { (Some(m), Some(y)) => format!("{} {}", french_month_name(m), y), _ => String::new() }), amount,
            kind: if school_year.is_some() { "enrollment_fee" } else if invoice.is_none() { "advance" } else { "invoice" }.to_string() });
    }
    Ok(items)
}

fn receipt_student_level(conn: &Connection, student_id: i64) -> Result<String, String> {
    conn.query_row("SELECT COALESCE(l.name,'') FROM students s LEFT JOIN levels l ON l.id=s.level_id WHERE s.id=?1", params![student_id], |r| r.get(0))
        .map_err(|e| db_err("Lecture du niveau", e))
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

    let session = receipt_session(conn, payment_id)?;
    // Any allocation of the same transaction resolves to the same receipt.
    for session_id in &session {
        if let Some(existing) = conn
            .query_row(
            "SELECT id FROM receipts WHERE payment_id = ?1 ORDER BY id LIMIT 1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
            .map_err(|err| db_err("Lecture du reçu", err))?
        {
            return Ok(existing);
        }
    }
    let payment_id = *session.first().ok_or_else(|| "Paiement introuvable".to_string())?;

    let student_name: String = conn
        .query_row(
            "SELECT full_name FROM students WHERE id = ?1",
            params![student_id],
            |row| row.get(0),
        )
        .map_err(|err| db_err("Lecture de l'élève", err))?;

    let items = receipt_items(conn, &session)?;
    let amount_cents: i64 = items.iter().map(|item| item.amount).sum();
    let items_json = serde_json::to_string(&items).map_err(|e| format!("Détails du reçu : {e}"))?;
    let student_level = receipt_student_level(conn, student_id)?;

    if amount_cents <= 0 {
        return Err("Aucun montant à justifier".to_string());
    }

    let groups_text = groups_of_payments(conn, &session)?.join(", ");
    let center_name = super::settings::get_centre_info(conn)?.name;

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
                (payment_id, receipt_number, student_name, amount_cents, payment_date, groups_text, center_name, student_level, items_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                payment_id,
                number,
                student_name,
                amount_cents,
                created_at,
                groups_text,
                center_name,
                student_level,
                items_json
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
    // (number, student, amount, date, groups, centre, payment id)
    type ReceiptRow = (String, String, i64, String, String, String, Option<i64>, Option<String>, Option<String>);
    let row: Option<ReceiptRow> = conn
        .query_row(
            "SELECT COALESCE(receipt_number, ''),
                    COALESCE(student_name, ''),
                    COALESCE(amount_cents, 0),
                    COALESCE(payment_date, ''),
                    COALESCE(groups_text, ''),
                    COALESCE(center_name, ''),
                    payment_id, student_level, items_json
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
                    row.get(6)?, row.get(7)?, row.get(8)?,
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
        payment_id, frozen_level, frozen_items,
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
                Some((_student_id, _created_at)) => {
                    let ids = receipt_session(conn, payment_id)?;
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

    let student_level = match (frozen_level, payment_id) {
        (Some(level), _) => level,
        (None, Some(id)) => conn.query_row("SELECT COALESCE(l.name, '') FROM payments p LEFT JOIN students s ON s.id=p.student_id LEFT JOIN levels l ON l.id=s.level_id WHERE p.id=?1", params![id], |r| r.get(0)).optional().map_err(|e| db_err("Lecture du niveau", e))?.unwrap_or_default(),
        _ => String::new(),
    };
    let items: Vec<ReceiptItem> = if let Some(json) = frozen_items {
        serde_json::from_str(&json).map_err(|e| format!("Détails du reçu invalides : {e}"))?
    } else {
        let reconstructed = match payment_id { Some(id) => receipt_items(conn, &receipt_session(conn, id)?)?, None => Vec::new() };
        // Older totals were grouped by timestamp; do not attribute money to
        // invoices if that grouping is ambiguous or cannot be reconstructed.
        if reconstructed.iter().map(|item| item.amount).sum::<i64>() == amount_cents { reconstructed }
        else { vec![ReceiptItem { subject: String::new(), group_name: String::new(), month: String::new(), amount: amount_cents, kind: "unavailable".to_string() }] }
    };

    let center_name = if center_name.trim().is_empty() {
        super::settings::get_centre_info(conn)?.name
    } else { center_name };
    let center_logo = super::settings::get_centre_info(conn)?.logo;
    Ok(ReceiptData {
        receipt_number,
        centre_name: center_name.clone(),
        centre_logo: center_logo.clone(),
        date: payment_date.clone(),
        total: amount_cents,
        center_name,
        center_address: get_setting_value(conn, "center_address")?,
        center_phone: get_setting_value(conn, "center_phone")?,
        center_logo,
        student_name,
        student_level,
        items,
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
pub fn cmd_get_unattributed_payment_count(db: State<'_, Db>) -> Result<i64, String> {
    db.conn().query_row("SELECT count(*) FROM payments WHERE school_year_id IS NULL", [], |r| r.get(0))
        .map_err(|err| db_err("Vérification des paiements", err))
}

#[tauri::command]
pub fn cmd_record_payment(
    db: State<'_, Db>,
    student_id: i64,
    invoice_ids: Vec<i64>,
    amount_cents: i64,
    method: String,
    notes: Option<String>,
    payment_date: Option<String>,
) -> Result<i64, String> {
    let conn = db.conn();
    record_payment_at(
        &conn,
        student_id,
        &invoice_ids,
        amount_cents,
        &method,
        notes.as_deref(),
        payment_date.as_deref(),
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
pub fn cmd_get_receipt_data(db: State<'_, Db>, receipt_id: Option<i64>, payment_id: Option<i64>) -> Result<ReceiptData, String> {
    let conn = db.conn();
    let id = match (receipt_id, payment_id) {
        (Some(id), _) => id,
        (None, Some(id)) => create_receipt(&conn, id)?,
        _ => return Err("Reçu introuvable".to_string()),
    };
    receipt_data(&conn, id)
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
                name: None,
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

    fn invoice_ids(conn: &Connection, student_id: i64) -> Vec<i64> {
        student_invoices(conn, student_id)
            .unwrap()
            .into_iter()
            .map(|invoice| invoice.id)
            .collect()
    }

    #[test]
    fn deleting_one_allocation_reverses_whole_batch_and_receipt() {
        let conn = test_conn();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let student_id = student(&conn, "Salma", "0612345678");
        let first = group_of(&conn, 1, 10, 10000);
        let second = group_of(&conn, 2, 10, 20000);
        enroll_student(&conn, student_id, first, "2026-03-01").unwrap();
        enroll_student(&conn, student_id, second, "2026-03-01").unwrap();
        let invoices = invoice_ids(&conn, student_id);
        let payment = record_payment(&conn, student_id, &invoices, 35000, "espèces", None).unwrap();
        let receipt = create_receipt(&conn, payment).unwrap();
        let session = receipt_session(&conn, payment).unwrap();
        assert_eq!(session.len(), 3);
        delete_payment(&conn, *session.last().unwrap()).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM payments", [], |r| r.get::<_,i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM receipts WHERE id=?1", params![receipt], |r| r.get::<_,i64>(0)).unwrap(), 0);
        assert!(student_invoices(&conn, student_id).unwrap().iter().all(|i| i.paid_amount_cents == 0));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM audit_log WHERE action='DELETE_PAYMENT'", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
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
    fn receipt_one_subject_uses_partial_payment_not_invoice_total() {
        let c = test_conn();
        let g = group(&c, 30_000); let s = student(&c, "Salma", "0612345678");
        enroll_student(&c, s, g, "2026-03-01").unwrap();
        let p = record_payment(&c, s, &invoice_ids(&c, s), 12_000, "espèces", None).unwrap();
        let data = receipt_data(&c, create_receipt(&c, p).unwrap()).unwrap();
        assert_eq!(data.items.len(), 1); assert_eq!(data.items[0].amount, 12_000);
        assert_eq!(data.items[0].subject, "Mathématiques"); assert_eq!(data.items[0].month, "Mars 2026");
    }

    #[test]
    fn receipt_three_subjects_is_frozen_and_batches_are_distinct() {
        let c = test_conn(); let s = student(&c, "Salma", "0612345678");
        for subject in [1, 2, 3] { let g = group_of(&c, subject, 10, 30_000); enroll_student(&c, s, g, "2026-03-01").unwrap(); }
        let ids = invoice_ids(&c, s);
        let p = record_payment(&c, s, &ids, 75_000, "chèque", None).unwrap();
        let receipt = create_receipt(&c, p).unwrap();
        let data = receipt_data(&c, receipt).unwrap();
        assert_eq!(data.items.len(), 3); assert_eq!(data.items.iter().map(|i| i.amount).sum::<i64>(), 75_000);
        assert_eq!(data.items.iter().filter(|i| i.amount == 15_000).count(), 1);
        c.execute("UPDATE subjects SET name='Changed' WHERE id=1", []).unwrap();
        assert_eq!(receipt_data(&c, receipt).unwrap().items[0].subject, data.items[0].subject);
        let p2 = record_payment(&c, s, &ids, 15_000, "espèces", None).unwrap();
        assert_ne!(create_receipt(&c, p2).unwrap(), receipt);
        assert_eq!(receipt_data(&c, create_receipt(&c, p2).unwrap()).unwrap().amount_cents, 15_000);
    }

    #[test]
    fn unknown_ids_are_reported() {
        let conn = test_conn();
        assert!(create_receipt(&conn, 999).is_err());
        assert!(receipt_data(&conn, 999).is_err());
    }
}
