//! Data models mirroring `db/schema.sql`.
//!
//! Field names are snake_case in both Rust and JSON so structs can be sent
//! straight to the React frontend (`src/types/index.ts` mirrors them 1:1).
//! Every monetary field is an `i64` number of centimes (1 DH = 100).

// The structs are the public data contract for the commands added in the next
// milestones, so they are intentionally unused for now.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: Option<String>,
}

// ---------------------------------------------------------------------------
// 2. School years
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchoolYear {
    pub id: i64,
    pub label: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default)]
    pub is_active: bool,
}

// ---------------------------------------------------------------------------
// 3-5. Levels, branches, subjects
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level {
    pub id: i64,
    pub name: Option<String>,
    pub sort_order: Option<i64>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Branch {
    pub id: i64,
    pub name: Option<String>,
    pub level_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subject {
    pub id: i64,
    pub name: Option<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// 6. Students
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Student {
    pub id: i64,
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub phone: Option<String>,
    pub parent_phone: Option<String>,
    pub level_id: Option<i64>,
    pub branch_id: Option<i64>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 7-8. Teachers + teacher <-> subject link
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Teacher {
    pub id: i64,
    pub full_name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub photo: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherSubject {
    pub teacher_id: i64,
    pub subject_id: i64,
}

// ---------------------------------------------------------------------------
// 9. Groups
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub subject_id: Option<i64>,
    pub level_id: Option<i64>,
    pub branch_id: Option<i64>,
    pub teacher_id: Option<i64>,
    pub school_year_id: Option<i64>,
    pub day_of_week: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub room: Option<String>,
    /// Monthly fee in centimes.
    pub monthly_fee_cents: i64,
    pub capacity: i64,
    pub status: Option<String>,
}

// ---------------------------------------------------------------------------
// 10. Enrollments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Enrollment {
    pub id: i64,
    pub student_id: i64,
    pub group_id: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

// ---------------------------------------------------------------------------
// 11. Invoices
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: i64,
    pub enrollment_id: Option<i64>,
    pub period_month: Option<i64>,
    pub period_year: Option<i64>,
    /// Amount due, in centimes.
    pub amount_cents: i64,
    /// Amount already collected, in centimes.
    pub paid_amount_cents: i64,
    pub status: Option<String>,
    pub due_date: Option<String>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 12. Payments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: i64,
    pub student_id: i64,
    pub invoice_id: Option<i64>,
    /// Amount paid, in centimes.
    pub amount_cents: i64,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 13. Receipts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub id: i64,
    pub payment_id: i64,
    pub receipt_number: Option<String>,
    pub student_name: Option<String>,
    pub amount_cents: Option<i64>,
    pub payment_date: Option<String>,
    pub groups_text: Option<String>,
    pub center_name: Option<String>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 14. Teacher activities
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherActivity {
    pub id: i64,
    pub teacher_id: i64,
    pub activity_date: Option<String>,
    pub activity_type: Option<String>,
    /// Hours worked (fractional, e.g. 1.5).
    pub hours: Option<f64>,
    pub sessions: Option<i64>,
    pub notes: Option<String>,
}

// ---------------------------------------------------------------------------
// 15-16. Teacher compensation + settlements
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherCompensation {
    pub id: i64,
    pub teacher_id: i64,
    pub month: Option<i64>,
    pub year: Option<i64>,
    pub mode: Option<String>,
    pub base_amount_cents: Option<i64>,
    #[serde(default)]
    pub bonus_amount_cents: i64,
    pub total_amount_cents: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherSettlement {
    pub id: i64,
    pub teacher_id: i64,
    pub compensation_id: Option<i64>,
    pub amount_cents: Option<i64>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// 17. Audit log
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: i64,
    pub action: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<i64>,
    pub details: Option<String>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Command DTOs
// ---------------------------------------------------------------------------

/// Snapshot of the active database file (settings → Sauvegarde).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbInfo {
    /// Absolute path of `centremanager.db`.
    pub path: String,
    /// Size of the database file in bytes.
    pub size_bytes: u64,
    /// ISO timestamp of the last successful backup (`settings.last_backup_date`).
    pub last_backup: Option<String>,
}

// ---------------------------------------------------------------------------
// Students (Phase 3)
// ---------------------------------------------------------------------------

/// A student row enriched with its level and branch names.
///
/// The Phase 0 [`Student`] mirrors the raw table; this one is the shape the
/// students list/detail commands return (joined names, non-optional phone).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentRow {
    pub id: i64,
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub phone: String,
    pub parent_phone: Option<String>,
    pub level_id: Option<i64>,
    pub level_name: Option<String>,
    pub branch_id: Option<i64>,
    pub branch_name: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One page of students plus the total number of matching rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedStudents {
    pub data: Vec<StudentRow>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

/// A single `audit_log` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: i64,
    pub action: String,
    pub entity_type: String,
    pub details: Option<String>,
    pub created_at: String,
}

/// Everything the student detail page needs in one round-trip.
///
/// `enrollments` and `invoices` stay empty until Phases 4 and 5 fill them in;
/// the shape is already in place so the UI does not have to change later.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentDetail {
    pub student: StudentRow,
    pub enrollments: Vec<serde_json::Value>,
    pub invoices: Vec<serde_json::Value>,
    pub audit_log: Vec<AuditEntry>,
}

// ---------------------------------------------------------------------------
// Phase 4 — groups & enrollments
// ---------------------------------------------------------------------------

/// A group row enriched with every joined label the UI needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRow {
    pub id: i64,
    pub subject_id: Option<i64>,
    pub subject_name: String,
    pub level_id: Option<i64>,
    pub level_name: String,
    pub branch_id: Option<i64>,
    pub branch_name: Option<String>,
    pub teacher_id: Option<i64>,
    pub teacher_name: Option<String>,
    pub school_year_id: Option<i64>,
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    /// Monthly fee in centimes.
    pub monthly_fee_cents: i64,
    pub capacity: i64,
    /// Active enrollments in this group.
    pub enrolled_count: i64,
    pub status: String,
}

/// A student enrolled in a group, as listed in the group sheet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrolledStudent {
    pub enrollment_id: i64,
    pub student_id: i64,
    pub student_name: String,
    pub student_phone: String,
    pub start_date: String,
    pub status: String,
}

/// Current-month money picture for one group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialSummary {
    pub month: i32,
    pub year: i32,
    pub active_enrollments: i32,
    pub monthly_fee_cents: i64,
    /// `active_enrollments × monthly_fee_cents`.
    pub theoretical_total_cents: i64,
    /// Sum of `paid_amount_cents` on this month's invoices.
    pub collected_total_cents: i64,
}

/// Everything the group detail modal needs in one round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDetail {
    pub group: GroupRow,
    pub students: Vec<EnrolledStudent>,
    pub financial_summary: FinancialSummary,
}

/// One enrollment as shown on the student sheet (joined labels).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentEnrollment {
    pub enrollment_id: i64,
    pub group_id: i64,
    pub subject_name: String,
    pub level_name: String,
    pub branch_name: Option<String>,
    pub teacher_name: Option<String>,
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
    pub monthly_fee_cents: i64,
    pub start_date: String,
    pub end_date: Option<String>,
    pub status: String,
}

/// Lightweight teacher option for the group form (Phase 6 fills the table).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherOption {
    pub id: i64,
    pub full_name: String,
}

// ---------------------------------------------------------------------------
// Phase 5 — invoicing & payments
// ---------------------------------------------------------------------------

/// One invoice of a student, with the joined group labels the UI displays.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentInvoice {
    pub id: i64,
    pub enrollment_id: i64,
    pub group_subject: String,
    pub group_level: String,
    pub group_branch: Option<String>,
    pub period_month: i32,
    pub period_year: i32,
    pub amount_cents: i64,
    pub paid_amount_cents: i64,
    /// `amount_cents - paid_amount_cents`, never negative.
    pub remaining_cents: i64,
    pub status: String,
    pub due_date: String,
}

/// One student's outstanding (or settled) balance for a given month.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceAlert {
    pub student_id: i64,
    pub student_name: String,
    pub student_phone: String,
    /// Comma-separated group labels, e.g. "Mathématiques 2ème Bac, Arabe 1ère Bac".
    pub groups: String,
    /// Sum of the remaining amount of this month's unpaid invoices.
    pub total_due_cents: i64,
    /// Sum of `paid_amount_cents` over this month's invoices.
    pub total_paid_cents: i64,
    /// Earliest due date among the unpaid invoices (or the earliest overall).
    pub due_date: String,
    /// Positive = days overdue, negative = days remaining, 0 = settled.
    pub days_late: i32,
    /// Latest payment recorded for this month (shown in the "À jour" table).
    pub last_payment_date: Option<String>,
    pub last_payment_method: Option<String>,
}

/// The three buckets of the collections dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentAlerts {
    pub late: Vec<InvoiceAlert>,
    pub upcoming: Vec<InvoiceAlert>,
    pub current: Vec<InvoiceAlert>,
}

/// One row of the payments history (`cmd_get_payments_history`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRow {
    pub id: i64,
    pub student_id: i64,
    pub student_name: String,
    pub invoice_id: Option<i64>,
    pub amount_cents: i64,
    pub payment_method: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedPayments {
    pub data: Vec<PaymentRow>,
    pub total: i32,
    pub page: i32,
    pub limit: i32,
}

/// Everything printed on a receipt. Read from the **frozen** `receipts` row,
/// plus the (immutable) periods of the invoices it covers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptData {
    pub receipt_number: String,
    pub center_name: String,
    pub center_address: Option<String>,
    pub center_phone: Option<String>,
    /// Base64 data URL, when a logo is configured in the settings.
    pub center_logo: Option<String>,
    pub student_name: String,
    pub amount_cents: i64,
    pub payment_date: String,
    pub payment_method: String,
    pub groups_text: String,
    /// Canonical French label, e.g. "Octobre 2025".
    pub period_text: String,
    /// The same periods as `(month, year)` so the UI can localise them.
    pub periods: Vec<ReceiptPeriod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptPeriod {
    pub month: i32,
    pub year: i32,
}

// ---------------------------------------------------------------------------
// Phase 6 — teachers, activities & compensation
// ---------------------------------------------------------------------------

/// A teacher as listed by `cmd_get_teachers` / `cmd_get_teacher_detail`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherRow {
    pub id: i64,
    pub full_name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    /// Comma-separated subject names, e.g. `"Mathématiques, Physique-Chimie"`.
    pub subjects: String,
    /// Active groups (any school year) taught by this teacher.
    pub group_count: i32,
    pub compensation_mode: Option<String>,
    /// Configured amount (or percentage × 100) for the card badge.
    pub compensation_value_cents: Option<i64>,
    pub bonus_pct: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

/// One active group of a teacher (tab 2 of the teacher sheet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherGroup {
    pub group_id: i64,
    pub subject_name: String,
    pub level_name: String,
    pub branch_name: Option<String>,
    pub day_of_week: String,
    pub start_time: String,
    pub end_time: String,
    pub monthly_fee_cents: i64,
    pub enrolled_count: i32,
}

/// Payroll configuration stored on the `teachers` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompensationConfig {
    /// `fixed_monthly` | `hourly` | `per_session` | `percentage`.
    pub mode: String,
    /// Amount in centimes, or the percentage × 100 for `percentage`.
    pub value_cents: i64,
    pub bonus_pct: Option<f64>,
}

/// Payload for `cmd_get_teacher_detail`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherDetail {
    pub teacher: TeacherRow,
    pub subject_ids: Vec<i64>,
    pub groups: Vec<TeacherGroup>,
    pub compensation_config: Option<CompensationConfig>,
}

/// One line of the theoretical-revenue breakdown (kept structured so the UI can
/// localise it; `CompensationDetail::detail_lines` carries the French wording).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompensationGroupLine {
    pub group_id: i64,
    pub subject_name: String,
    pub level_name: String,
    pub branch_name: Option<String>,
    pub enrolled_count: i32,
    pub monthly_fee_cents: i64,
    pub total_cents: i64,
}

/// Result of `cmd_calculate_compensation`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompensationDetail {
    pub teacher_name: String,
    pub mode: String,
    pub base_amount_cents: i64,
    pub bonus_amount_cents: i64,
    pub total_cents: i64,
    /// Human-readable French breakdown.
    pub detail_lines: Vec<String>,
    pub already_settled_cents: i64,
    /// `total_cents - already_settled_cents` (may be negative when overpaid).
    pub remaining_cents: i64,
    // Structured inputs, so the UI can rebuild the same lines in Arabic.
    pub groups: Vec<CompensationGroupLine>,
    pub theoretical_cents: i64,
    pub value_cents: i64,
    pub bonus_pct: Option<f64>,
    /// Hours summed from the activities (only for `hourly`).
    pub hours: Option<f64>,
    /// Sessions summed from the activities (only for `per_session`).
    pub sessions: Option<i64>,
}

/// One settlement, as shown in the payroll history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settlement {
    pub id: i64,
    pub amount_cents: i64,
    pub payment_method: String,
    pub notes: Option<String>,
    pub created_at: String,
}

/// One activity of the activities log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: i64,
    pub activity_date: String,
    pub activity_type: String,
    pub hours: Option<f64>,
    pub sessions: Option<i64>,
    pub notes: Option<String>,
}

/// One row of `cmd_get_all_teacher_compensation_summary`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherCompSummary {
    pub teacher_id: i64,
    pub teacher_name: String,
    /// Empty string when no compensation is configured.
    pub mode: String,
    pub total_due_cents: i64,
    pub total_settled_cents: i64,
    pub remaining_cents: i64,
    /// `pending` | `partial` | `settled` | `not_configured`.
    pub status: String,
}

// ---------------------------------------------------------------------------
// Dashboard (Phase 7)
// ---------------------------------------------------------------------------

/// Headline numbers of the home page for one month.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardKPIs {
    pub total_active_students: i32,
    /// Money actually collected during the month (`payments.created_at`).
    pub monthly_revenue_cents: i64,
    /// What the month's invoices ask for (`invoices.period_month/year`).
    pub theoretical_revenue_cents: i64,
    /// `monthly_revenue / theoretical × 100`, `0.0` when nothing was invoiced.
    pub collection_rate: f64,
    pub active_groups: i32,
    pub active_teachers: i32,
    /// Same revenue one month earlier, for the trend arrow.
    pub prev_month_revenue_cents: i64,
    /// Students holding an active enrollment during the previous month.
    pub prev_month_students: i32,
}

/// One invoice due in the ±7 day window of the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertItem {
    pub student_id: i64,
    pub student_name: String,
    /// Subject + level of the group the invoice comes from.
    pub group_name: String,
    /// What is still owed on that invoice.
    pub amount_cents: i64,
    pub due_date: String,
    /// Whole days between the due date and today — negative when overdue.
    pub days_remaining: i32,
    /// `late` (overdue) | `upcoming` (0–3 days) | `ok` (4–7 days).
    pub severity: String,
}

/// One row of the “derniers paiements” list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentPayment {
    pub id: i64,
    pub student_name: String,
    pub amount_cents: i64,
    pub payment_method: String,
    pub created_at: String,
}
