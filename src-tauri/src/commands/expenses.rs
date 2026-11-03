//! Monthly expenses (Phase 11).
//!
//! The centre pays the same handful of charges every month — rent, WiFi,
//! electricity, water, the assistant's salary, supplies — and the director needs
//! them next to the revenue to know the **real** profit. This module is that
//! ledger: a flat list of rows scoped to `(month, year)`, plus the category list
//! stored in `settings`.
//!
//! Unlike payments and invoices, an expense is **internal tracking**, not a
//! financial record tied to a student: it can be edited and deleted in V1. Every
//! mutation still writes an `audit_log` row (`entity_type = 'expense'`), so
//! nothing disappears without a trace.
//!
//! | Command | Effect |
//! | --- | --- |
//! | [`cmd_create_expense`] | insert + `CREATE` audit row |
//! | [`cmd_update_expense`] | update + `UPDATE` audit row (diff, skipped when nothing changed) |
//! | [`cmd_delete_expense`] | delete + `DELETE` audit row (snapshot kept in the details) |
//! | [`cmd_get_expenses`] | one month, optionally one category |
//! | [`cmd_get_expenses_summary`] | total + per-category totals for the dashboard |
//! | [`cmd_get_expense_categories`] | the editable category list |
//! | [`cmd_set_expense_categories`] | replace that list |

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::State;

use super::db_err;
use super::settings::{get_setting_value, set_setting_value};
use crate::db::Db;

/// `audit_log.entity_type` of every row written here.
const ENTITY_TYPE: &str = "expense";
/// Settings key holding the JSON array of categories.
pub const CATEGORIES_KEY: &str = "expense_categories";
/// Guard rail: a label longer than this is a paste accident.
const MAX_LABEL_LEN: usize = 120;
/// Guard rail on notes, so a pasted file cannot bloat the database.
const MAX_NOTES_LEN: usize = 1000;
/// A single expense above 10 000 000 DH is a typo, not a charge.
const MAX_AMOUNT_CENTS: i64 = 1_000_000_000;

/// Categories shipped with a new database (also seeded in `db::seed_defaults`).
pub const DEFAULT_CATEGORIES: [&str; 7] = [
    "Loyer",
    "WiFi",
    "Électricité",
    "Eau",
    "Assistance",
    "Fournitures",
    "Autre",
];

// ---------------------------------------------------------------------------
// Inputs & outputs
// ---------------------------------------------------------------------------

/// Payload for `cmd_create_expense`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateExpenseInput {
    pub label: String,
    pub amount_cents: i64,
    pub category: String,
    pub month: i32,
    pub year: i32,
    pub notes: Option<String>,
}

/// Payload for `cmd_update_expense` (same shape as the create payload).
pub type UpdateExpenseInput = CreateExpenseInput;

/// Clean, validated values ready for SQL.
#[derive(Debug, Clone)]
struct CleanInput {
    label: String,
    amount_cents: i64,
    category: String,
    month: i32,
    year: i32,
    notes: Option<String>,
}

/// One expense row as the UI sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpenseRow {
    pub id: i64,
    pub label: String,
    pub amount_cents: i64,
    pub category: String,
    pub month: i32,
    pub year: i32,
    pub notes: Option<String>,
    pub created_at: String,
}

/// Totals of one category for the selected month.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryTotal {
    pub category: String,
    pub total_cents: i64,
    pub count: i32,
}

/// Month summary: everything the expenses page and the dashboard need.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpensesSummary {
    pub total_cents: i64,
    pub by_category: Vec<CategoryTotal>,
    pub count: i32,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_period(month: i32, year: i32) -> Result<(), String> {
    if !(1..=12).contains(&month) {
        return Err("Mois invalide (1 à 12)".to_string());
    }
    if !(2000..=2100).contains(&year) {
        return Err("Année invalide (2000 à 2100)".to_string());
    }
    Ok(())
}

/// Trimmed text, `None` when it is empty.
fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

impl CleanInput {
    fn from_input(input: &CreateExpenseInput) -> Result<Self, String> {
        let label = input.label.trim().to_string();
        if label.is_empty() {
            return Err("Le libellé de la dépense est obligatoire".to_string());
        }
        if label.chars().count() > MAX_LABEL_LEN {
            return Err(format!(
                "Le libellé ne peut pas dépasser {MAX_LABEL_LEN} caractères"
            ));
        }

        if input.amount_cents <= 0 {
            return Err("Le montant doit être supérieur à zéro".to_string());
        }
        if input.amount_cents > MAX_AMOUNT_CENTS {
            return Err("Le montant est trop élevé".to_string());
        }

        let category = input.category.trim().to_string();
        if category.is_empty() {
            return Err("La catégorie est obligatoire".to_string());
        }

        validate_period(input.month, input.year)?;

        let notes = trimmed(&input.notes);
        if let Some(text) = notes.as_deref() {
            if text.chars().count() > MAX_NOTES_LEN {
                return Err(format!(
                    "Les notes ne peuvent pas dépasser {MAX_NOTES_LEN} caractères"
                ));
            }
        }

        Ok(Self {
            label,
            amount_cents: input.amount_cents,
            category,
            month: input.month,
            year: input.year,
            notes,
        })
    }

    /// The audit payload of a create/update.
    fn json(&self) -> Value {
        json!({
            "label": self.label,
            "amount_cents": self.amount_cents,
            "category": self.category,
            "month": self.month,
            "year": self.year,
            "notes": self.notes,
        })
    }
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

fn map_row(row: &Row<'_>) -> rusqlite::Result<ExpenseRow> {
    Ok(ExpenseRow {
        id: row.get(0)?,
        label: row.get(1)?,
        amount_cents: row.get(2)?,
        category: row.get(3)?,
        month: row.get(4)?,
        year: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
    })
}

const SELECT_EXPENSE: &str = "SELECT id, label, amount_cents, category, month, year, notes,
            COALESCE(created_at, '')
     FROM monthly_expenses";

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/// Create one expense, write the audit row and return the new id.
pub fn create_expense(conn: &Connection, input: &CreateExpenseInput) -> Result<i64, String> {
    let clean = CleanInput::from_input(input)?;

    conn.execute(
        "INSERT INTO monthly_expenses (label, amount_cents, category, month, year, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            clean.label,
            clean.amount_cents,
            clean.category,
            clean.month,
            clean.year,
            clean.notes,
        ],
    )
    .map_err(|err| db_err("Création de la dépense", err))?;

    let id = conn.last_insert_rowid();
    log_audit(conn, "CREATE", id, Some(clean.json().to_string()))?;
    Ok(id)
}

/// Full row of one expense (used by the update diff and the delete snapshot).
fn snapshot(conn: &Connection, id: i64) -> Result<Option<Map<String, Value>>, String> {
    conn.query_row(
        &format!("{SELECT_EXPENSE} WHERE id = ?1"),
        params![id],
        map_row,
    )
    .optional()
    .map_err(|err| db_err("Lecture de la dépense", err))?
    .map(|row| {
        let mut map = Map::new();
        map.insert("label".into(), json!(row.label));
        map.insert("amount_cents".into(), json!(row.amount_cents));
        map.insert("category".into(), json!(row.category));
        map.insert("month".into(), json!(row.month));
        map.insert("year".into(), json!(row.year));
        map.insert("notes".into(), json!(row.notes));
        Ok(map)
    })
    .transpose()
}

/// Update one expense; the audit row only stores what actually changed.
pub fn update_expense(
    conn: &Connection,
    id: i64,
    input: &CreateExpenseInput,
) -> Result<(), String> {
    let clean = CleanInput::from_input(input)?;

    let before = snapshot(conn, id)?.ok_or_else(|| "Dépense introuvable".to_string())?;

    let changed = conn
        .execute(
            "UPDATE monthly_expenses SET
                label = ?1, amount_cents = ?2, category = ?3,
                month = ?4, year = ?5, notes = ?6,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?7",
            params![
                clean.label,
                clean.amount_cents,
                clean.category,
                clean.month,
                clean.year,
                clean.notes,
                id,
            ],
        )
        .map_err(|err| db_err("Mise à jour de la dépense", err))?;
    if changed == 0 {
        return Err("Dépense introuvable".to_string());
    }

    let after = clean.json();
    let mut diff = Map::new();
    if let Value::Object(after_map) = &after {
        for (key, value) in after_map {
            if before.get(key) != Some(value) {
                diff.insert(
                    key.clone(),
                    json!({ "from": before.get(key).cloned().unwrap_or(Value::Null), "to": value }),
                );
            }
        }
    }
    // Nothing changed: no noise in the audit trail.
    if diff.is_empty() {
        return Ok(());
    }
    log_audit(conn, "UPDATE", id, Some(Value::Object(diff).to_string()))
}

/// Delete one expense. Allowed in V1 — this is internal bookkeeping — but the
/// deleted values are kept in the audit details so the row is recoverable.
pub fn delete_expense(conn: &Connection, id: i64) -> Result<(), String> {
    let before = snapshot(conn, id)?.ok_or_else(|| "Dépense introuvable".to_string())?;

    let deleted = conn
        .execute("DELETE FROM monthly_expenses WHERE id = ?1", params![id])
        .map_err(|err| db_err("Suppression de la dépense", err))?;
    if deleted == 0 {
        return Err("Dépense introuvable".to_string());
    }

    log_audit(
        conn,
        "DELETE",
        id,
        Some(json!({ "deleted": before }).to_string()),
    )
}

/// One month of expenses, optionally narrowed to a single category.
///
/// `ORDER BY category, label` puts the same charge together, which is how the
/// director reads the page; `id` closes the order so the output is stable.
pub fn list_expenses(
    conn: &Connection,
    month: i32,
    year: i32,
    category: Option<&str>,
) -> Result<Vec<ExpenseRow>, String> {
    validate_period(month, year)?;

    let category = category.map(str::trim).filter(|value| !value.is_empty());
    let sql = match category {
        Some(_) => format!(
            "{SELECT_EXPENSE} WHERE month = ?1 AND year = ?2 AND category = ?3
             ORDER BY category COLLATE NOCASE ASC, label COLLATE NOCASE ASC, id ASC"
        ),
        None => format!(
            "{SELECT_EXPENSE} WHERE month = ?1 AND year = ?2
             ORDER BY category COLLATE NOCASE ASC, label COLLATE NOCASE ASC, id ASC"
        ),
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| db_err("Préparation des dépenses", err))?;

    let rows = match category {
        Some(value) => stmt.query_map(params![month, year, value], map_row),
        None => stmt.query_map(params![month, year], map_row),
    }
    .map_err(|err| db_err("Lecture des dépenses", err))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture des dépenses", err))
}

/// Month totals: overall and per category, biggest first.
pub fn expenses_summary(
    conn: &Connection,
    month: i32,
    year: i32,
) -> Result<ExpensesSummary, String> {
    validate_period(month, year)?;

    let mut stmt = conn
        .prepare(
            "SELECT category, COALESCE(SUM(amount_cents), 0), COUNT(*)
             FROM monthly_expenses
             WHERE month = ?1 AND year = ?2
             GROUP BY category
             ORDER BY SUM(amount_cents) DESC, category COLLATE NOCASE ASC",
        )
        .map_err(|err| db_err("Préparation du résumé des dépenses", err))?;

    let by_category = stmt
        .query_map(params![month, year], |row| {
            Ok(CategoryTotal {
                category: row.get(0)?,
                total_cents: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|err| db_err("Lecture du résumé des dépenses", err))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| db_err("Lecture du résumé des dépenses", err))?;

    let total_cents = by_category.iter().map(|line| line.total_cents).sum();
    let count = by_category.iter().map(|line| line.count).sum();

    Ok(ExpensesSummary {
        total_cents,
        by_category,
        count,
    })
}

/// Total spent in a month — the number the dashboard subtracts from revenue.
pub fn month_total(conn: &Connection, month: i32, year: i32) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM monthly_expenses
          WHERE month = ?1 AND year = ?2",
        params![month, year],
        |row| row.get(0),
    )
    .map_err(|err| db_err("Lecture du total des dépenses", err))
}

// ---------------------------------------------------------------------------
// Categories (stored as a JSON array in `settings`)
// ---------------------------------------------------------------------------

/// Parse the stored JSON array, falling back to the defaults.
///
/// A corrupted value must never empty the expense form, so anything unparseable
/// yields [`DEFAULT_CATEGORIES`] instead of an error.
pub fn categories_from_json(raw: Option<&str>) -> Vec<String> {
    let parsed: Option<Vec<String>> = raw.and_then(|text| serde_json::from_str(text).ok());
    match parsed {
        Some(list) => {
            let cleaned: Vec<String> = list
                .into_iter()
                .map(|entry| entry.trim().to_string())
                .filter(|entry| !entry.is_empty())
                .collect();
            if cleaned.is_empty() {
                DEFAULT_CATEGORIES.iter().map(|c| c.to_string()).collect()
            } else {
                cleaned
            }
        }
        None => DEFAULT_CATEGORIES.iter().map(|c| c.to_string()).collect(),
    }
}

/// The category list, defaults included when the setting is missing.
pub fn expense_categories(conn: &Connection) -> Result<Vec<String>, String> {
    let raw = get_setting_value(conn, CATEGORIES_KEY)?;
    Ok(categories_from_json(raw.as_deref()))
}

/// Replace the category list (trimmed, de-duplicated, order preserved).
pub fn set_expense_categories(conn: &Connection, categories: &[String]) -> Result<(), String> {
    let mut cleaned: Vec<String> = Vec::new();
    for entry in categories {
        let name = entry.trim().to_string();
        if name.is_empty() {
            return Err("Une catégorie ne peut pas être vide".to_string());
        }
        if name.chars().count() > 60 {
            return Err("Une catégorie ne peut pas dépasser 60 caractères".to_string());
        }
        if !cleaned
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&name))
        {
            cleaned.push(name);
        }
    }
    if cleaned.is_empty() {
        return Err("Au moins une catégorie est obligatoire".to_string());
    }

    let payload = serde_json::to_string(&cleaned)
        .map_err(|err| format!("Sérialisation des catégories impossible : {err}"))?;
    set_setting_value(conn, CATEGORIES_KEY, &payload)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmd_create_expense(db: State<'_, Db>, data: CreateExpenseInput) -> Result<i64, String> {
    let conn = db.conn();
    create_expense(&conn, &data)
}

#[tauri::command]
pub fn cmd_update_expense(
    db: State<'_, Db>,
    id: i64,
    data: UpdateExpenseInput,
) -> Result<(), String> {
    let conn = db.conn();
    update_expense(&conn, id, &data)
}

#[tauri::command]
pub fn cmd_delete_expense(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.conn();
    delete_expense(&conn, id)
}

#[tauri::command]
pub fn cmd_get_expenses(
    db: State<'_, Db>,
    month: i32,
    year: i32,
    category: Option<String>,
) -> Result<Vec<ExpenseRow>, String> {
    let conn = db.conn();
    list_expenses(&conn, month, year, category.as_deref())
}

#[tauri::command]
pub fn cmd_get_expenses_summary(
    db: State<'_, Db>,
    month: i32,
    year: i32,
) -> Result<ExpensesSummary, String> {
    let conn = db.conn();
    expenses_summary(&conn, month, year)
}

#[tauri::command]
pub fn cmd_get_expense_categories(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.conn();
    expense_categories(&conn)
}

#[tauri::command]
pub fn cmd_set_expense_categories(
    db: State<'_, Db>,
    categories: Vec<String>,
) -> Result<(), String> {
    let conn = db.conn();
    set_expense_categories(&conn, &categories)
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

    fn input(label: &str, amount_cents: i64, category: &str) -> CreateExpenseInput {
        CreateExpenseInput {
            label: label.to_string(),
            amount_cents,
            category: category.to_string(),
            month: 11,
            year: 2026,
            notes: None,
        }
    }

    #[test]
    fn create_expense_stores_centimes_and_writes_audit() {
        let conn = test_conn();
        let mut row = input("Loyer local principal", 350_000, "Loyer");
        row.notes = Some("Payé par virement".to_string());

        let id = create_expense(&conn, &row).unwrap();
        let expenses = list_expenses(&conn, 11, 2026, None).unwrap();
        assert_eq!(expenses.len(), 1);
        assert_eq!(expenses[0].id, id);
        assert_eq!(expenses[0].amount_cents, 350_000);
        assert_eq!(expenses[0].category, "Loyer");
        assert_eq!(expenses[0].notes.as_deref(), Some("Payé par virement"));

        let (action, entity, details): (String, String, String) = conn
            .query_row(
                "SELECT action, entity_type, details FROM audit_log
                  WHERE entity_type = 'expense' AND entity_id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(action, "CREATE");
        assert_eq!(entity, "expense");
        assert!(details.contains("Loyer local principal"));
    }

    #[test]
    fn validation_rejects_bad_input() {
        let conn = test_conn();

        let mut empty_label = input("   ", 1000, "Loyer");
        empty_label.notes = None;
        assert!(create_expense(&conn, &empty_label).is_err());

        let zero = input("Loyer", 0, "Loyer");
        assert!(create_expense(&conn, &zero).is_err());

        let negative = input("Loyer", -500, "Loyer");
        assert!(create_expense(&conn, &negative).is_err());

        let no_category = input("Loyer", 1000, "  ");
        assert!(create_expense(&conn, &no_category).is_err());

        let mut bad_month = input("Loyer", 1000, "Loyer");
        bad_month.month = 13;
        assert!(create_expense(&conn, &bad_month).is_err());

        let mut bad_year = input("Loyer", 1000, "Loyer");
        bad_year.year = 1999;
        assert!(create_expense(&conn, &bad_year).is_err());

        assert_eq!(list_expenses(&conn, 11, 2026, None).unwrap().len(), 0);
    }

    #[test]
    fn update_and_delete_are_audited() {
        let conn = test_conn();
        let id = create_expense(&conn, &input("Facture WiFi", 30_000, "WiFi")).unwrap();

        let mut updated = input("Facture WiFi Novembre", 32_000, "WiFi");
        updated.notes = Some("Augmentation".to_string());
        update_expense(&conn, id, &updated).unwrap();

        let rows = list_expenses(&conn, 11, 2026, None).unwrap();
        assert_eq!(rows[0].label, "Facture WiFi Novembre");
        assert_eq!(rows[0].amount_cents, 32_000);

        // The diff names the two changed fields only.
        let details: String = conn
            .query_row(
                "SELECT details FROM audit_log
                  WHERE entity_type = 'expense' AND action = 'UPDATE' AND entity_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(details.contains("amount_cents"));
        assert!(details.contains("label"));
        assert!(!details.contains("category"));

        // Re-saving identical values must not add an audit row.
        let before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity_type = 'expense'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        update_expense(&conn, id, &updated).unwrap();
        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity_type = 'expense'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before, after, "an unchanged update must not be logged");

        delete_expense(&conn, id).unwrap();
        assert_eq!(list_expenses(&conn, 11, 2026, None).unwrap().len(), 0);

        let deleted: String = conn
            .query_row(
                "SELECT details FROM audit_log
                  WHERE entity_type = 'expense' AND action = 'DELETE' AND entity_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted.contains("Facture WiFi Novembre"), "snapshot kept");

        // Deleting twice is an error, not a silent success.
        assert!(delete_expense(&conn, id).is_err());
        assert!(update_expense(&conn, id, &updated).is_err());
    }

    #[test]
    fn list_filters_by_month_and_category() {
        let conn = test_conn();

        create_expense(&conn, &input("Loyer", 350_000, "Loyer")).unwrap();
        create_expense(&conn, &input("Fournitures 1", 12_000, "Fournitures")).unwrap();
        create_expense(&conn, &input("Fournitures 2", 8_000, "Fournitures")).unwrap();
        let mut october = input("Loyer octobre", 350_000, "Loyer");
        october.month = 10;
        create_expense(&conn, &october).unwrap();

        let november = list_expenses(&conn, 11, 2026, None).unwrap();
        assert_eq!(november.len(), 3);
        // Biggest category first is the summary's rule; the list sorts by name.
        assert_eq!(november[0].category, "Fournitures");
        assert_eq!(november[2].category, "Loyer");

        let supplies = list_expenses(&conn, 11, 2026, Some("Fournitures")).unwrap();
        assert_eq!(
            supplies.len(),
            2,
            "two entries in the same category are allowed"
        );
        assert!(supplies.iter().all(|row| row.category == "Fournitures"));

        let unknown = list_expenses(&conn, 11, 2026, Some("Inconnue")).unwrap();
        assert!(unknown.is_empty());
    }

    #[test]
    fn summary_totals_whole_month_and_each_category() {
        let conn = test_conn();

        create_expense(&conn, &input("Loyer", 350_000, "Loyer")).unwrap();
        create_expense(&conn, &input("WiFi", 30_000, "WiFi")).unwrap();
        create_expense(&conn, &input("Cahiers", 12_000, "Fournitures")).unwrap();
        create_expense(&conn, &input("Stylos", 8_000, "Fournitures")).unwrap();
        let mut other_month = input("Loyer septembre", 300_000, "Loyer");
        other_month.month = 9;
        create_expense(&conn, &other_month).unwrap();

        let summary = expenses_summary(&conn, 11, 2026).unwrap();
        assert_eq!(summary.total_cents, 400_000);
        assert_eq!(summary.count, 4);
        assert_eq!(summary.by_category.len(), 3);
        // Sorted by total, descending.
        assert_eq!(summary.by_category[0].category, "Loyer");
        assert_eq!(summary.by_category[0].total_cents, 350_000);
        assert_eq!(summary.by_category[0].count, 1);
        let supplies = summary
            .by_category
            .iter()
            .find(|line| line.category == "Fournitures")
            .unwrap();
        assert_eq!(supplies.total_cents, 20_000);
        assert_eq!(supplies.count, 2);

        // An empty month is a valid, zeroed summary.
        let empty = expenses_summary(&conn, 1, 2026).unwrap();
        assert_eq!(empty.total_cents, 0);
        assert_eq!(empty.count, 0);
        assert!(empty.by_category.is_empty());
        assert_eq!(month_total(&conn, 11, 2026).unwrap(), 400_000);
    }

    #[test]
    fn categories_are_stored_as_json_and_have_defaults() {
        let conn = test_conn();

        // Fresh database: the seven defaults are seeded by `db::seed_defaults`.
        let defaults = expense_categories(&conn).unwrap();
        assert_eq!(defaults.len(), DEFAULT_CATEGORIES.len());
        assert_eq!(defaults[0], "Loyer");
        assert!(defaults.contains(&"Fournitures".to_string()));

        // Duplicates (case-insensitive) are collapsed, order preserved.
        set_expense_categories(
            &conn,
            &[
                "Loyer".to_string(),
                "Taxes".to_string(),
                "taxes".to_string(),
            ],
        )
        .unwrap();
        let stored = expense_categories(&conn).unwrap();
        assert_eq!(stored, vec!["Loyer".to_string(), "Taxes".to_string()]);

        // Empty entries are refused, and so is an empty list.
        assert!(set_expense_categories(&conn, &[]).is_err());
        assert!(set_expense_categories(&conn, &["   ".to_string()]).is_err());
        assert!(set_expense_categories(&conn, &["Loyer".to_string(), "  ".to_string()]).is_err());
        // …and a refused save leaves the stored list untouched.
        assert_eq!(expense_categories(&conn).unwrap().len(), 2);

        // A corrupted setting falls back to the defaults instead of erroring.
        set_setting_value(&conn, CATEGORIES_KEY, "not json").unwrap();
        assert_eq!(
            expense_categories(&conn).unwrap().len(),
            DEFAULT_CATEGORIES.len()
        );
    }

    #[test]
    fn categories_survive_a_restart() {
        // The list lives in `settings`, not in memory: re-reading the same
        // connection after a fresh `run_migrations` keeps the custom value.
        let conn = test_conn();
        set_expense_categories(&conn, &["Loyer".to_string(), "Sécurité".to_string()]).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        assert_eq!(
            expense_categories(&conn).unwrap(),
            vec!["Loyer".to_string(), "Sécurité".to_string()]
        );
    }
}
