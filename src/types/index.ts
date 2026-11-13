/**
 * Shared TypeScript types.
 *
 * These mirror the Rust structs in `src-tauri/src/models/mod.rs` and the
 * SQLite schema in `src-tauri/src/db/schema.sql`.
 * Every monetary value is expressed in centimes (i64 on the Rust side).
 */

export type Language = 'fr' | 'ar';
export type InvoiceStatus = 'impayé' | 'partiel' | 'payé' | 'annulé';
export type PaymentMethod = 'espèces' | 'virement' | 'chèque' | 'autre';
/** Phase 6: main compensation modes (the recruitment bonus is cumulative). */
export type CompensationMode = 'fixed_monthly' | 'hourly' | 'per_session' | 'percentage';

export interface SchoolYear {
  id: number;
  label: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface Level {
  id: number;
  name: string;
  sort_order: number | null;
  category: string | null;
}

export interface Branch {
  id: number;
  name: string;
  level_id: number | null;
}

export interface Subject {
  id: number;
  name: string;
  is_active: boolean;
}

/** One weekly slot of a group (Phase 13). */
export interface GroupSchedule {
  room?: string | null;
  id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
}

export interface ScheduleConflictInput {
  day: string;
  start_time: string;
  end_time: string;
}

export interface ScheduleConflict {
  conflict_type: 'room' | 'teacher';
  group_name: string;
  day: string;
  start_time: string;
  end_time: string;
  teacher_name: string;
  room: string;
}

/** Joined group labels and computed active-enrollment count. */
export interface Group {
  name?: string | null;
  deleted_at?: string | null;
  id: number;
  subject_id: number | null;
  subject_name: string;
  level_id: number | null;
  level_name: string;
  branch_id: number | null;
  branch_name: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  school_year_id: number | null;
  /** Legacy single slot — kept for older rows, mirrors `schedules[0]`. */
  day_of_week: string;
  start_time: string;
  end_time: string;
  room: string | null;
  /** Monthly fee in centimes. */
  monthly_fee_cents: number;
  capacity: number;
  enrolled_count: number;
  status: string;
  /** Every weekly slot, in school-week order. */
  schedules: GroupSchedule[];
  /** Untranslated summary, e.g. `Lun 16-18, Mer 14-16`. */
  schedule_text: string;
}

/** Payload for `cmd_create_group` / `cmd_update_group`. */
export interface GroupInput {
  name?: string | null;
  subject_id: number;
  level_id: number;
  branch_id: number | null;
  teacher_id: number | null;
  school_year_id: number;
  /** Legacy single slot — the backend mirrors `schedules[0]` into it. */
  day_of_week: string;
  start_time: string;
  end_time: string;
  /** The whole week; wins over the single slot when present. */
  schedules?: GroupSchedule[];
  room: string | null;
  monthly_fee_cents: number;
  capacity: number;
}

export interface EnrolledStudent {
  enrollment_id: number;
  student_id: number;
  student_name: string;
  student_phone: string;
  start_date: string;
  status: string;
}

/** Current-month money picture for a group. */
export interface FinancialSummary {
  month: number;
  year: number;
  active_enrollments: number;
  monthly_fee_cents: number;
  theoretical_total_cents: number;
  collected_total_cents: number;
}

export interface GroupDetail {
  group: Group;
  students: EnrolledStudent[];
  financial_summary: FinancialSummary;
}

/** One enrollment as shown on the student sheet. */
export interface StudentEnrollment {
  enrollment_id: number;
  group_id: number;
  subject_name: string;
  level_name: string;
  branch_name: string | null;
  teacher_name: string | null;
  day_of_week: string;
  start_time: string;
  end_time: string;
  monthly_fee_cents: number;
  start_date: string;
  end_date: string | null;
  status: string;
}

export interface TeacherOption {
  id: number;
  full_name: string;
}

/** Payload for `cmd_enroll_student_batch`. */
export interface EnrollmentInput {
  student_id: number;
  group_id: number;
  start_date: string;
  custom_monthly_fee_cents?: number | null;
}

export interface Receipt {
  id: number;
  payment_id: number;
  receipt_number: string;
  student_name: string | null;
  amount_cents: number | null;
  payment_date: string | null;
  groups_text: string | null;
  center_name: string | null;
  created_at: string | null;
}

/** Database file snapshot shown in Settings → Sauvegarde. */
export interface DbInfo {
  path: string;
  size_bytes: number;
  last_backup: string | null;
}

// ---------------------------------------------------------------------------
// Students (Phase 3)
// ---------------------------------------------------------------------------

/** A student as returned by `cmd_get_students` / `cmd_get_student_detail`. */
export interface Student {
  enrollment_fee_cents?: number;
  deleted_at?: string | null;
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  phone: string;
  guardian_name: string | null;
  cin_tuteur?: string | null;
  nom_pere?: string | null;
  nom_mere?: string | null;
  guardian_phone: string | null;
  guardian_relation: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  school_name: string | null;
  enrollment_date: string;
  level_id: number | null;
  level_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  address: string | null;
  notes: string | null;
  status: 'actif' | 'inactif';
  created_at: string;
  updated_at: string;
}

export interface PaginatedStudents {
  data: Student[];
  total: number;
  page: number;
  limit: number;
}

/** One row of the student history tab. */
export interface AuditEntry {
  id: number;
  action: string;
  entity_type: string;
  details: string | null;
  created_at: string;
}

/** Payload for `cmd_get_student_detail`. */
export interface StudentDetail {
  student: Student;
  /** Active + terminated enrollments (Phase 4). */
  enrollments: StudentEnrollment[];
  /** Filled in Phase 5. */
  invoices: unknown[];
  audit_log: AuditEntry[];
}

/** Payload for `cmd_create_student` / `cmd_update_student`. */
export interface StudentInput {
  enrollment_fee_cents?: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  phone: string;
  guardian_name: string | null;
  cin_tuteur?: string | null;
  nom_pere?: string | null;
  nom_mere?: string | null;
  guardian_phone: string | null;
  guardian_relation: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  school_name: string | null;
  enrollment_date: string;
  level_id: number | null;
  branch_id: number | null;
  address: string | null;
  notes: string | null;
  status: 'actif' | 'inactif';
}

// ---------------------------------------------------------------------------
// Invoicing & payments (Phase 5)
// ---------------------------------------------------------------------------

/** One invoice of a student, with the joined group labels. */
export interface StudentInvoice {
  id: number;
  enrollment_id: number | null;
  kind: 'invoice' | 'enrollment_fee';
  school_year_label: string | null;
  group_subject: string;
  group_name: string | null;
  group_level: string;
  group_branch: string | null;
  period_month: number;
  period_year: number;
  amount_cents: number;
  paid_amount_cents: number;
  remaining_cents: number;
  status: InvoiceStatus;
  due_date: string;
}

/** One student's balance for a month, as shown on the Payments dashboard. */
export interface InvoiceAlert {
  guardian_name: string | null;
  guardian_phone: string | null;
  student_id: number;
  student_name: string;
  student_phone: string;
  /** Comma-separated group labels. */
  groups: string;
  total_due_cents: number;
  total_paid_cents: number;
  due_date: string;
  /** Positive = days overdue, negative = days remaining, 0 = settled. */
  days_late: number;
  last_payment_date: string | null;
  last_payment_method: string | null;
}

export interface PaymentAlerts {
  late: InvoiceAlert[];
  upcoming: InvoiceAlert[];
  current: InvoiceAlert[];
}

/** One row of the payments history. */
export interface PaymentRow {
  period_month: number | null;
  period_year: number | null;
  group_name: string | null;
  invoice_kind: 'invoice' | 'enrollment_fee' | 'advance';
  school_year_label: string | null;
  id: number;
  student_id: number;
  student_name: string;
  invoice_id: number | null;
  amount_cents: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

export interface PaginatedPayments {
  data: PaymentRow[];
  total: number;
  page: number;
  limit: number;
}

export interface ReceiptPeriod {
  month: number;
  year: number;
}

export interface ReceiptItem {
  subject: string;
  group_name: string;
  month: string;
  amount: number;
  kind: 'invoice' | 'enrollment_fee' | 'advance' | 'unavailable';
}

export interface CentreInfo { name: string; logo: string | null }

/** Everything printed on a receipt (frozen data + centre identity). */
export interface ReceiptData {
  receipt_number: string;
  centre_name: string;
  centre_logo: string | null;
  date: string;
  total: number;
  center_name: string;
  center_address: string | null;
  center_phone: string | null;
  center_logo: string | null;
  student_name: string;
  student_level: string;
  items: ReceiptItem[];
  amount_cents: number;
  payment_date: string;
  payment_method: string;
  groups_text: string;
  /** Canonical French label, e.g. "Octobre 2025" — localised by `periods`. */
  period_text: string;
  periods: ReceiptPeriod[];
}

/** Payment methods offered by the payment modal (values stored in SQLite). */
export const PAYMENT_METHODS = ['espèces', 'virement', 'chèque', 'autre'] as const;

// ---------------------------------------------------------------------------
// Teachers & compensation (Phase 6)
// ---------------------------------------------------------------------------

/** A teacher as returned by `cmd_get_teachers` / `cmd_get_teacher_detail`. */
export interface Teacher {
  deleted_at?: string | null;
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: 'actif' | 'inactif';
  /** Comma-separated subject names. */
  subjects: string;
  /** Active groups taught by this teacher. */
  group_count: number;
  compensation_mode: CompensationMode | null;
  compensation_value_cents: number | null;
  bonus_pct: number | null;
  created_at: string;
  updated_at: string;
}

/** One active group of a teacher (tab 2 of the teacher sheet). */
export interface TeacherGroup {
  group_id: number;
  subject_name: string;
  level_name: string;
  branch_name: string | null;
  day_of_week: string;
  start_time: string;
  end_time: string;
  monthly_fee_cents: number;
  enrolled_count: number;
}

/** Payroll configuration; `value_cents` is a percentage × 100 for `percentage`. */
export interface CompensationConfig {
  mode: CompensationMode;
  value_cents: number;
  bonus_pct: number | null;
}

export interface TeacherDetail {
  teacher: Teacher;
  subject_ids: number[];
  groups: TeacherGroup[];
  compensation_config: CompensationConfig | null;
}

export interface TeacherPayment {
  id: number;
  amount_cents: number;
  payment_date: string;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

/** Payload for `cmd_create_teacher` / `cmd_update_teacher`. */
export interface TeacherInput {
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  subject_ids: number[];
}

/** Main compensation modes, in the order the select shows them. */
export const COMPENSATION_MODES = [
  'fixed_monthly',
  'hourly',
  'per_session',
  'percentage',
] as const;

// ---------------------------------------------------------------------------
// Dashboard (Phase 7)
// ---------------------------------------------------------------------------

/** Headline numbers of the home page for one month. */
export interface DashboardKPIs {
  total_active_students: number;
  /** Money actually collected during the month (`payments.created_at`). */
  monthly_revenue_cents: number;
  /** What the month's invoices ask for. */
  theoretical_revenue_cents: number;
  /** `monthly_revenue / theoretical × 100`, `0` when nothing was invoiced. */
  collection_rate: number;
  active_groups: number;
  active_teachers: number;
  /** Revenue of the month before, for the trend arrow. */
  prev_month_revenue_cents: number;
  /** Students holding an active enrollment during the previous month. */
  prev_month_students: number;
  /** Charges of the month (`monthly_expenses`), Phase 11. */
  total_expenses_cents: number;
  /** Payroll of the month: the sum of every configured teacher's total. */
  total_compensation_cents: number;
  /** `revenue - expenses - compensation` — the real profit of the month. */
  net_income_cents: number;
  /** Same arithmetic one month earlier, for the net-income trend. */
  prev_month_net_income_cents: number;
}

// ---------------------------------------------------------------------------
// Monthly expenses (Phase 11)
// ---------------------------------------------------------------------------

/** One charge of a month: rent, WiFi, electricity, supplies… */
export interface Expense {
  deleted_at?: string | null;
  id: number;
  label: string;
  amount_cents: number;
  category: string;
  month: number;
  year: number;
  notes: string | null;
  created_at: string;
}

/** Payload of `cmd_create_expense` / `cmd_update_expense`. */
export interface ExpenseInput {
  label: string;
  amount_cents: number;
  category: string;
  month: number;
  year: number;
  notes: string | null;
}

/** Totals of one category for a month. */
export interface CategoryTotal {
  category: string;
  total_cents: number;
  count: number;
}

/** Month summary returned by `cmd_get_expenses_summary`. */
export interface ExpensesSummary {
  total_cents: number;
  by_category: CategoryTotal[];
  count: number;
}

/** One invoice due in the ±7 day window of the dashboard. */
export interface AlertItem {
  student_id: number;
  student_name: string;
  group_name: string;
  /** What is still owed on that invoice. */
  amount_cents: number;
  due_date: string;
  /** Whole days between the due date and today (`-3` = three days late). */
  days_remaining: number;
  severity: 'late' | 'upcoming' | 'ok';
}

/** One row of the “derniers paiements” list. */
export interface RecentPayment {
  id: number;
  student_name: string;
  amount_cents: number;
  payment_method: string;
  created_at: string;
}

/** One block of the weekly timetable (Phase 13). */
export interface TimetableEntry {
  name?: string | null;
  group_id: number;
  subject_name: string;
  level_name: string;
  branch_name: string | null;
  teacher_name: string | null;
  room: string | null;
  day_of_week: string;
  start_time: string;
  end_time: string;
  enrolled_count: number;
  capacity: number;
  monthly_fee_cents: number;
}

/** Server-side filters for `cmd_get_timetable`; `null` means "all". */
export interface TimetableFilters {
  level_id: number | null;
  subject_id: number | null;
  teacher_id: number | null;
  room: string | null;
}

export type TrashEntityType = 'student' | 'teacher' | 'group' | 'expense';
export interface TrashItem {
  entity_type: TrashEntityType;
  entity_id: number;
  name: string;
  guardian_phone: string | null;
  deleted_at: string;
  expires_at: string;
  days_remaining: number;
  permanent: boolean;
  has_financial_history: boolean;
}

export interface CheckDuplicateInput {
  id: number | null;
  first_name: string;
  last_name: string;
  phone: string | null;
}
export interface DuplicateMatch {
  entity_id: number;
  full_name: string;
  phone: string;
  match_type: 'name' | 'phone' | 'both';
}
