import type {
  AuditEntry,
  Branch,
  DbInfo,
  EnrolledStudent,
  EnrollmentInput,
  FinancialSummary,
  Group,
  GroupDetail,
  GroupInput,
  GroupSchedule,
  InvoiceAlert,
  Level,
  PaginatedPayments,
  PaginatedStudents,
  PaymentAlerts,
  PaymentRow,
  ReceiptData,
  SchoolYear,
  Student,
  StudentDetail,
  StudentEnrollment,
  StudentInvoice,
  Subject,
  TimetableEntry,
  Activity,
  CompensationDetail,
  CompensationMode,
  Settlement,
  Teacher,
  TeacherCompSummary,
  TeacherDetail,
  TeacherGroup,
  AlertItem,
  DashboardKPIs,
  RecentPayment,
  CategoryTotal,
  Expense,
  ExpenseInput,
  ExpensesSummary,
  TrashItem, TrashEntityType, DuplicateMatch, ScheduleConflict,
} from '../types';

/**
 * Development-only stand-in for the Rust settings/reference-data commands.
 *
 * `npm run dev` runs the UI in a plain browser where Tauri IPC does not exist.
 * This module keeps a small mirror of the reference data in `localStorage` so
 * the Settings page can be explored (and UI-tested) without the desktop shell.
 *
 * It is only reachable through `settingsApi` when
 * `import.meta.env.DEV && !isTauri()`; inside the Tauri app every call goes to
 * Rust. Error messages intentionally match the Rust ones so the UI behaves
 * identically in both environments.
 */

type Args = Record<string, unknown> | undefined;

const STORE_KEY = 'centremanager.dev.settings_store_v1';
const AUTH_CENTER_NAME_KEY = 'centremanager.dev.mock_center_name';

const PROTECTED_KEY = 'admin_password_hash';

const SEED_LEVELS: Array<[string, string]> = [
  ['1ère année', 'primaire'],
  ['2ème année', 'primaire'],
  ['3ème année', 'primaire'],
  ['4ème année', 'primaire'],
  ['5ème année', 'primaire'],
  ['6ème année', 'primaire'],
  ['1ère année', 'college'],
  ['2ème année', 'college'],
  ['3ème année', 'college'],
  ['Tronc Commun', 'lycee'],
  ['1ère Bac', 'lycee'],
  ['2ème Bac', 'lycee'],
];

const SEED_BRANCHES = [
  'Sciences Maths',
  'Sciences Expérimentales',
  'Sciences Économiques',
  'Lettres et Sciences Humaines',
  'Autre',
];

const SEED_SUBJECTS = [
  'Mathématiques',
  'Physique-Chimie',
  'SVT',
  'Français',
  'Arabe',
  'Anglais',
  'Philosophie',
  'Histoire-Géographie',
  'Économie',
  'Informatique',
];

interface DevStore {
  settings: Record<string, string>;
  levels: Level[];
  branches: Branch[];
  subjects: Subject[];
  schoolYears: SchoolYear[];
  nextLevelId: number;
  nextBranchId: number;
  nextSubjectId: number;
  nextYearId: number;
  students: Student[];
  groups: Group[];
  enrollments: DevEnrollment[];
  invoices: DevInvoice[];
  payments: DevPayment[];
  receipts: DevReceipt[];
  teachers: DevTeacher[];
  teacherActivities: DevActivity[];
  teacherSettlements: DevSettlement[];
  /** Phase 11 — monthly charges (internal bookkeeping, deletable). */
  expenses: DevExpense[];
  /** Dev-only: keeps `entity_id` so the history tab can filter per student. */
  auditLog: Array<AuditEntry & { entity_id: number }>;
  nextStudentId: number;
  nextGroupId: number;
  nextScheduleId: number;
  nextEnrollmentId: number;
  nextInvoiceId: number;
  nextPaymentId: number;
  nextReceiptId: number;
  nextTeacherId: number;
  nextActivityId: number;
  nextSettlementId: number;
  nextExpenseId: number;
  nextAuditId: number;
}

/** An expense row as stored (mirrors `monthly_expenses`). */
type DevExpense = Expense;

/** Teachers are stored raw (compensation config on the row), like the SQL table. */
interface DevTeacher {
  deleted_at?: string | null;
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  subject_ids: number[];
  compensation_mode: string | null;
  compensation_value_cents: number | null;
  bonus_pct: number | null;
  created_at: string;
  updated_at: string;
}

interface DevActivity {
  id: number;
  teacher_id: number;
  activity_date: string;
  activity_type: string;
  hours: number | null;
  sessions: number | null;
  notes: string | null;
}

interface DevSettlement {
  id: number;
  teacher_id: number;
  amount_cents: number;
  payment_method: string;
  notes: string | null;
  month: number;
  year: number;
  created_at: string;
}

/** Enrollments are stored raw, like the SQL table. */
interface DevEnrollment {
  id: number;
  student_id: number;
  group_id: number;
  start_date: string;
  end_date: string | null;
  status: string;
}

interface DevInvoice {
  id: number;
  enrollment_id: number;
  period_month: number;
  period_year: number;
  amount_cents: number;
  paid_amount_cents: number;
  status: string;
  due_date: string;
  created_at: string;
}

interface DevPayment {
  id: number;
  student_id: number;
  invoice_id: number | null;
  amount_cents: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

interface DevReceipt {
  id: number;
  payment_id: number;
  receipt_number: string;
  student_name: string;
  amount_cents: number;
  payment_date: string;
  groups_text: string;
  center_name: string;
  created_at: string;
}

/** Dev mirror of `expenses::CleanInput::from_input`. */
function validateExpenseInput(raw: unknown): ExpenseInput {
  const input = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const label = text(input.label);
  if (!label) throw new Error('Le libellé de la dépense est obligatoire');
  if (label.length > 120) throw new Error('Le libellé ne peut pas dépasser 120 caractères');

  const amount = typeof input.amount_cents === 'number' ? Math.round(input.amount_cents) : 0;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Le montant doit être supérieur à zéro');
  }

  const category = text(input.category);
  if (!category) throw new Error('La catégorie est obligatoire');

  const month = typeof input.month === 'number' ? input.month : 0;
  const year = typeof input.year === 'number' ? input.year : 0;
  validatePeriod(month, year);

  const notes = text(input.notes);

  return {
    label,
    amount_cents: amount,
    category,
    month,
    year,
    notes: notes ? notes : null,
  };
}

/** Categories shipped with a new database (same list as `expenses.rs`). */
const DEFAULT_EXPENSE_CATEGORIES = [
  'Loyer',
  'WiFi',
  'Électricité',
  'Eau',
  'Assistance',
  'Fournitures',
  'Autre',
];

/** A few charges so the Frais page and the net card are not empty on day one. */
function seedExpenses(): DevExpense[] {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const previous = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;

  const row = (
    id: number,
    label: string,
    dirhams: number,
    category: string,
    periodMonth: number,
    periodYear: number,
    notes: string | null = null,
  ): DevExpense => ({
    id,
    label,
    amount_cents: dirhams * 100,
    category,
    month: periodMonth,
    year: periodYear,
    notes,
    created_at: now.toISOString().slice(0, 19).replace('T', ' '),
  });

  return [
    row(1, 'Loyer local principal', 1200, 'Loyer', month, year),
    row(2, 'Abonnement fibre', 250, 'WiFi', month, year),
    row(3, 'Facture électricité', 380, 'Électricité', month, year),
    row(4, 'Salaire assistante', 800, 'Assistance', month, year),
    row(5, 'Facture eau', 150, 'Eau', month, year),
    row(6, 'Fournitures pédagogiques', 220, 'Fournitures', month, year),
    row(7, 'Loyer local principal', 1200, 'Loyer', previous, previousYear, 'Mois précédent'),
  ];
}

function seed(): DevStore {
  const levels: Level[] = SEED_LEVELS.map(([name, category], index) => ({
    id: index + 1,
    name,
    sort_order: index + 1,
    category,
  }));

  const lyceeLevels = levels.filter((level) => level.category === 'lycee');
  let branchId = 1;
  const branches: Branch[] = lyceeLevels.flatMap((level) =>
    SEED_BRANCHES.map((name) => ({ id: branchId++, name, level_id: level.id })),
  );

  const subjects: Subject[] = SEED_SUBJECTS.map((name, index) => ({
    id: index + 1,
    name,
    is_active: true,
  }));

  return {
    settings: {
      center_name: localStorage.getItem(AUTH_CENTER_NAME_KEY) ?? 'Centre Excellence',
      currency: 'DH',
      language: localStorage.getItem('centremanager.language') ?? 'fr',
      lock_timeout_minutes: '15',
      receipt_format: 'a4',
      // Phase 11 — the editable category list, as JSON like the Rust side.
      expense_categories: JSON.stringify(DEFAULT_EXPENSE_CATEGORIES),
    },
    levels,
    branches,
    subjects,
    schoolYears: [
      { id: 1, label: '2024-2025', start_date: '2024-09-01', end_date: '2025-06-30', is_active: true },
    ],
    nextLevelId: levels.length + 1,
    nextBranchId: branches.length + 1,
    nextSubjectId: subjects.length + 1,
    nextYearId: 2,
    students: seedStudents(levels, branches),
    ...seedGroups(levels, branches),
    ...seedTeachers(),
    expenses: seedExpenses(),
    auditLog: [],
    nextStudentId: 5,
    nextExpenseId: 8,
    nextAuditId: 1,
  };
}

/** Three groups plus one enrollment + invoice so every screen has content. */
function seedGroups(
  levels: Level[],
  branches: Branch[],
): Pick<
  DevStore,
  | 'groups'
  | 'enrollments'
  | 'invoices'
  | 'payments'
  | 'receipts'
  | 'nextGroupId'
  | 'nextScheduleId'
  | 'nextEnrollmentId'
  | 'nextInvoiceId'
  | 'nextPaymentId'
  | 'nextReceiptId'
> {
  const levelId = (name: string) => levels.find((level) => level.name === name)?.id ?? null;
  const branchId = (name: string) =>
    branches.find((branch) => branch.name === name)?.id ?? null;

  const group = (
    id: number,
    subject_id: number,
    subject_name: string,
    level: string,
    branch: string | null,
    day_of_week: string,
    start_time: string,
    end_time: string,
    room: string,
    monthly_fee_cents: number,
    capacity: number,
  ): Group => ({
    id,
    subject_id,
    subject_name,
    level_id: levelId(level),
    level_name: level,
    branch_id: branch ? branchId(branch) : null,
    branch_name: branch,
    teacher_id: null,
    teacher_name: null,
    school_year_id: 1,
    day_of_week,
    start_time,
    end_time,
    room,
    monthly_fee_cents,
    capacity,
    enrolled_count: 0,
    status: 'actif',
    // Phase 13: a seeded group meets once a week.
    schedules: [{ id: id * 10, day_of_week, start_time, end_time }],
    schedule_text: '',
  });

  const groups: Group[] = [
    group(1, 1, 'Mathématiques', 'Tronc Commun', null, 'Lundi', '16:00', '18:00', 'Salle 3', 30000, 10),
    group(2, 2, 'Physique-Chimie', '2ème Bac', 'Sciences Maths', 'Mardi', '17:30', '19:30', 'Salle 1', 35000, 20),
    group(3, 4, 'Français', '6ème année', null, 'Samedi', '10:00', '12:00', 'Salle 2', 25000, 8),
  ];

  // Phase 6: group 1 & 2 belong to teacher 1, group 3 to teacher 2.
  groups[0].teacher_id = 1;
  groups[1].teacher_id = 1;
  groups[2].teacher_id = 2;

  // ---------------------------------------------------------------------
  // Phase 7 — a current month and a previous month, relative to “today”, so
  // the dashboard always shows real KPIs, trends and échéances in the browser.
  // ---------------------------------------------------------------------
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prev =
    curMonth === 1 ? { month: 12, year: curYear - 1 } : { month: curMonth - 1, year: curYear };
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const isoOf = (year: number, month: number, day: number) =>
    `${year}-${pad2(month)}-${pad2(day)}`;
  /** `YYYY-MM-DD` of today shifted by `offset` days. */
  const isoFromToday = (offset: number) => {
    const shifted = new Date(now.getTime() + offset * 86_400_000);
    const local = new Date(shifted.getTime() - shifted.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  };
  const curStamp = `${curYear}-${pad2(curMonth)}`;

  const enrollments: DevEnrollment[] = [
    { id: 1, student_id: 1, group_id: 2, start_date: '2025-09-12', end_date: null, status: 'actif' },
    { id: 2, student_id: 2, group_id: 3, start_date: '2025-09-14', end_date: null, status: 'actif' },
    // Phase 7: two more students so the Matières group (and the dashboard) has
    // a realistic student count and a “nothing left to pay” balance.
    { id: 3, student_id: 3, group_id: 1, start_date: isoOf(curYear, curMonth, 1), end_date: null, status: 'actif' },
    { id: 4, student_id: 4, group_id: 1, start_date: isoOf(curYear, curMonth, 2), end_date: null, status: 'actif' },
  ];

  const invoices: DevInvoice[] = [
    {
      id: 1,
      enrollment_id: 1,
      period_month: 9,
      period_year: 2025,
      amount_cents: 35000,
      paid_amount_cents: 20000,
      status: 'partiel',
      due_date: '2025-09-12',
      created_at: '2025-09-12 09:20:00',
    },
    {
      id: 2,
      enrollment_id: 2,
      period_month: 9,
      period_year: 2025,
      amount_cents: 25000,
      paid_amount_cents: 25000,
      status: 'payé',
      due_date: '2025-09-14',
      created_at: '2025-09-14 11:45:00',
    },
  ];

  const curInvoice = (
    id: number,
    enrollment_id: number,
    amount_cents: number,
    paid_amount_cents: number,
    due_date: string,
  ): DevInvoice => ({
    id,
    enrollment_id,
    period_month: curMonth,
    period_year: curYear,
    amount_cents,
    paid_amount_cents,
    status: invoiceStatus(paid_amount_cents, amount_cents),
    due_date,
    created_at: `${curStamp}-01 08:00:00`,
  });

  const prevInvoice = (
    id: number,
    enrollment_id: number,
    amount_cents: number,
    paid_amount_cents: number,
    day: number,
  ): DevInvoice => ({
    id,
    enrollment_id,
    period_month: prev.month,
    period_year: prev.year,
    amount_cents,
    paid_amount_cents,
    status: invoiceStatus(paid_amount_cents, amount_cents),
    due_date: isoOf(prev.year, prev.month, day),
    created_at: `${isoOf(prev.year, prev.month, 1)} 08:00:00`,
  });

  invoices.push(
    // Current month: 1 200 DH invoiced, 1 000 DH collected → 83.33 %.
    curInvoice(3, 1, 35000, 35000, isoFromToday(0)),
    curInvoice(4, 2, 25000, 25000, isoFromToday(0)),
    curInvoice(5, 3, 30000, 15000, isoFromToday(1)), // due tomorrow → upcoming
    curInvoice(6, 4, 30000, 25000, isoFromToday(5)), // in five days → ok
    // Previous month: one invoice still unpaid and already three days late.
    prevInvoice(7, 1, 35000, 0, 1),
    prevInvoice(8, 2, 25000, 25000, 14),
    prevInvoice(9, 3, 30000, 30000, 14),
  );
  // The late one is due relative to today, whatever the month boundary is.
  const lateInvoice = invoices.find((invoice) => invoice.id === 7);
  if (lateInvoice) lateInvoice.due_date = isoFromToday(-3);

  // Four payments this month (1 000 DH) and two last month (550 DH).
  const payments: DevPayment[] = [
    {
      id: 1,
      student_id: 2,
      invoice_id: 2,
      amount_cents: 25000,
      payment_method: 'espèces',
      notes: null,
      created_at: '2025-09-14 11:45:00',
    },
    {
      id: 2,
      student_id: 1,
      invoice_id: 1,
      amount_cents: 20000,
      payment_method: 'virement',
      notes: 'Acompte',
      created_at: '2025-09-15 16:10:00',
    },
    {
      id: 3,
      student_id: 1,
      invoice_id: 3,
      amount_cents: 35000,
      payment_method: 'espèces',
      notes: null,
      created_at: `${isoFromToday(0)} 08:15:00`,
    },
    {
      id: 4,
      student_id: 2,
      invoice_id: 4,
      amount_cents: 25000,
      payment_method: 'virement',
      notes: null,
      created_at: `${isoFromToday(0)} 08:40:00`,
    },
    {
      id: 5,
      student_id: 3,
      invoice_id: 5,
      amount_cents: 15000,
      payment_method: 'chèque',
      notes: 'Premier versement',
      created_at: `${isoFromToday(0)} 09:05:00`,
    },
    {
      id: 6,
      student_id: 4,
      invoice_id: 6,
      amount_cents: 25000,
      payment_method: 'espèces',
      notes: null,
      created_at: `${isoFromToday(0)} 11:20:00`,
    },
    {
      id: 7,
      student_id: 2,
      invoice_id: 8,
      amount_cents: 25000,
      payment_method: 'espèces',
      notes: null,
      created_at: `${isoOf(prev.year, prev.month, 14)} 10:00:00`,
    },
    {
      id: 8,
      student_id: 3,
      invoice_id: 9,
      amount_cents: 30000,
      payment_method: 'virement',
      notes: null,
      created_at: `${isoOf(prev.year, prev.month, 20)} 15:30:00`,
    },
  ];

  return {
    groups,
    enrollments,
    invoices,
    payments,
    receipts: [],
    nextGroupId: groups.length + 1,
    nextScheduleId: groups.length * 10 + 1,
    nextEnrollmentId: enrollments.length + 1,
    nextInvoiceId: invoices.length + 1,
    nextPaymentId: payments.length + 1,
    nextReceiptId: 1,
  };
}

/**
 * Two teachers with different payroll configurations, plus a couple of
 * activities and one settlement so every Phase 6 screen has content:
 *
 * * teacher 1 — `percentage` 40 % + 5 % recruitment bonus
 * * teacher 2 — `hourly` 80 DH, no bonus, 3 h already logged this month
 */
function seedTeachers(): Pick<
  DevStore,
  'teachers' | 'teacherActivities' | 'teacherSettlements' | 'nextTeacherId' | 'nextActivityId' | 'nextSettlementId'
> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const day = (value: number) => `${year}-${String(month).padStart(2, '0')}-${String(value).padStart(2, '0')}`;
  const stamp = nowTimestamp();

  const teachers: DevTeacher[] = [
    {
      id: 1,
      full_name: 'Karim Idrissi',
      phone: '0661234567',
      email: 'karim.idrissi@centre.ma',
      notes: 'Maths & physique, 2ème Bac.',
      status: 'actif',
      subject_ids: [1, 2],
      compensation_mode: 'percentage',
      compensation_value_cents: 4000,
      bonus_pct: 5,
      created_at: stamp,
      updated_at: stamp,
    },
    {
      id: 2,
      full_name: 'Zineb Alami',
      phone: '0712345678',
      email: null,
      notes: null,
      status: 'actif',
      subject_ids: [4],
      compensation_mode: 'hourly',
      compensation_value_cents: 8000,
      bonus_pct: null,
      created_at: stamp,
      updated_at: stamp,
    },
  ];

  const teacherActivities: DevActivity[] = [
    {
      id: 1,
      teacher_id: 2,
      activity_date: day(3),
      activity_type: 'cours',
      hours: 2,
      sessions: 1,
      notes: 'Salle 2',
    },
    {
      id: 2,
      teacher_id: 2,
      activity_date: day(10),
      activity_type: 'rattrapage',
      hours: 1,
      sessions: null,
      notes: null,
    },
  ];

  const teacherSettlements: DevSettlement[] = [
    {
      id: 1,
      teacher_id: 2,
      amount_cents: 10000,
      payment_method: 'espèces',
      notes: 'Acompte',
      month,
      year,
      created_at: stamp,
    },
  ];

  return {
    teachers,
    teacherActivities,
    teacherSettlements,
    nextTeacherId: teachers.length + 1,
    nextActivityId: teacherActivities.length + 1,
    nextSettlementId: teacherSettlements.length + 1,
  };
}

/** A few students so the list, filters and pagination are explorable. */
function seedStudents(levels: Level[], branches: Branch[]): Student[] {
  const twoBac = levels.find((level) => level.name === '2ème Bac')?.id ?? null;
  const sixieme = levels.find((level) => level.name === '6ème année' && level.category === 'primaire')?.id ?? null;
  const branchSciences = branches.find((branch) => branch.name === 'Sciences Maths')?.id ?? null;

  const row = (
    id: number,
    full_name: string,
    phone: string,
    secondary_contact_phone: string | null,
    level_id: number | null,
    branch_id: number | null,
    address: string | null,
    notes: string | null,
    status: 'actif' | 'inactif',
    created_at: string,
    birth_date: string | null,
    guardian_name: string | null = null,
  ): Student => ({
    id,
    full_name,
    first_name: full_name.split(' ')[0],
    last_name: full_name.split(' ').slice(1).join(' '),
    birth_date,
    phone,
    guardian_phone: phone,
    guardian_relation: null,
    secondary_contact_name: null,
    school_name: null,
    enrollment_date: created_at.slice(0, 10),
    secondary_contact_phone,
    guardian_name,
    level_id,
    level_name: levels.find((level) => level.id === level_id)?.name ?? null,
    branch_id,
    branch_name: branches.find((branch) => branch.id === branch_id)?.name ?? null,
    address,
    notes,
    status,
    created_at,
    updated_at: created_at,
  });

  return [
    row(1, 'Yassine El Amrani', '0612345678', '0661112233', twoBac, branchSciences, '12 rue des Écoles, Casablanca', 'Inscrit en septembre', 'actif', '2025-09-12 09:15:00', '2007-04-18', 'Rachid El Amrani'),
    row(2, 'Salma Benjelloun', '0723456789', '0611223344', sixieme, null, '45 bd Zerktouni, Casablanca', null, 'actif', '2025-09-14 11:40:00', '2013-11-02', 'Mustapha Benjelloun'),
    row(3, 'Omar Tazi', '0698765432', null, sixieme, null, null, null, 'actif', '2025-09-20 16:05:00', '2013-02-25', null),
    row(4, 'Nadia Chraibi', '0655443322', '0677889900', twoBac, branchSciences, '8 rue Ibn Sina, Rabat', 'A quitté le centre', 'inactif', '2025-09-02 10:00:00', '2007-09-30', 'Driss Chraibi'),
  ];
}

/** Dev-mode equivalent of the Rust `audit_log` insert. */
function logAudit(
  store: DevStore,
  action: string,
  entityId: number,
  details: string | null,
  entityType: 'student' | 'group' | 'enrollment' | 'teacher' | 'expense' = 'student',
): void {
  store.auditLog.push({
    id: store.nextAuditId++,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    created_at: new Date().toISOString(),
  });
  if (store.auditLog.length > 500) store.auditLog.shift();
}

const PHONE_PATTERN = /^0[67]\d{8}$/;

/** Dev mirror of `students::normalise_phone` (spaces and dashes are cosmetic). */
function normaliseDevPhone(value: string): string {
  return value.replace(/[\s\u00A0\u202F.()-]/g, '');
}

function validateStudentInput(store: DevStore, input: Record<string, unknown>): import('../types').StudentInput {
  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
  const nullable = (value: unknown): string | null => text(value) || null;
  const full_name = `${text(input.first_name)} ${text(input.last_name)}`.trim();
  if (full_name.length < 2) throw new Error("Le nom de l'élève doit contenir au moins 2 caractères");
  if (!text(input.first_name) || !text(input.last_name)) throw new Error('Prénom et nom obligatoires');
  if (!text(input.guardian_name)) throw new Error('Nom du tuteur obligatoire');
  if (typeof input.level_id !== 'number') throw new Error('Niveau obligatoire');
  for (const value of [input.birth_date, input.enrollment_date]) {
    if (text(value)) { const d = text(value); const parsed = new Date(`${d}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== d) throw new Error('Date invalide'); }
  }
  const phone = normaliseDevPhone(text(input.guardian_phone ?? input.phone));
  if (!PHONE_PATTERN.test(phone)) throw new Error('Format de téléphone du tuteur invalide (06XXXXXXXX ou 07XXXXXXXX)');
  const secondary_contact_phone = normaliseDevPhone(text(input.secondary_contact_phone)) || null;
  if (secondary_contact_phone && !PHONE_PATTERN.test(secondary_contact_phone)) throw new Error('Format de téléphone invalide');
  const level_id = typeof input.level_id === 'number' ? input.level_id : null;
  const branch_id = typeof input.branch_id === 'number' ? input.branch_id : null;
  if (level_id !== null && !store.levels.some((level) => level.id === level_id)) throw new Error('Niveau introuvable');
  if (branch_id !== null && !store.branches.some((branch) => branch.id === branch_id)) throw new Error('Branche introuvable');
  const status = text(input.status) || 'actif';
  if (status !== 'actif' && status !== 'inactif') throw new Error('Statut invalide');
  return { full_name, first_name: nullable(input.first_name), last_name: nullable(input.last_name),
    birth_date: nullable(input.birth_date), phone, guardian_phone: phone,
    guardian_name: nullable(input.guardian_name), guardian_relation: nullable(input.guardian_relation),
    secondary_contact_name: nullable(input.secondary_contact_name), secondary_contact_phone,
    school_name: nullable(input.school_name), enrollment_date: text(input.enrollment_date) || new Date().toISOString().slice(0, 10),
    level_id, branch_id, address: nullable(input.address), notes: nullable(input.notes), status };
}

function load(): DevStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DevStore;
      parsed.students = (parsed.students ?? []).map((student) => {
        const old = student as unknown as Record<string, unknown>;
        const names = student.full_name.trim().split(/\s+/);
        const migrated = { ...student, first_name: student.first_name ?? names[0] ?? '',
          last_name: student.last_name ?? names.slice(1).join(' '),
          birth_date: student.birth_date ?? (old['date_of_birth'] as string | null) ?? null,
          guardian_name: student.guardian_name ?? (old['father_name'] as string | null) ?? null,
          guardian_phone: student.guardian_phone ?? student.phone,
          guardian_relation: student.guardian_relation ?? null,
          secondary_contact_name: student.secondary_contact_name ?? null,
          secondary_contact_phone: student.secondary_contact_phone ?? (old['parent_phone'] as string | null) ?? null,
          school_name: student.school_name ?? null,
          enrollment_date: student.enrollment_date ?? student.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          address: student.address ?? (old['home_address'] as string | null) ?? (old['email'] as string | null) ?? null };
        const cleaned = migrated as unknown as Record<string, unknown>;
        for (const key of ['father_name', 'home_address', 'email', 'date_of_birth', 'parent_phone']) delete cleaned[key];
        return migrated;
      });
      // Stores written before Phase 5 have no payments/receipts.
      parsed.payments ??= [];
      parsed.receipts ??= [];
      parsed.nextPaymentId ??= parsed.payments.length + 1;
      parsed.nextReceiptId ??= parsed.receipts.length + 1;
      // Stores written before Phase 6 have no teachers/payroll data.
      parsed.teachers ??= [];
      parsed.teacherActivities ??= [];
      parsed.teacherSettlements ??= [];
      parsed.nextTeacherId ??= parsed.teachers.length + 1;
      parsed.nextActivityId ??= parsed.teacherActivities.length + 1;
      parsed.nextSettlementId ??= parsed.teacherSettlements.length + 1;
      // Stores written before Phase 11 have no expenses and no category list.
      parsed.expenses ??= [];
      parsed.nextExpenseId ??= parsed.expenses.length + 1;
      parsed.settings.expense_categories ??= JSON.stringify(DEFAULT_EXPENSE_CATEGORIES);
      // Stores written before Phase 13 keep one slot in the legacy columns.
      const maxScheduleId = parsed.groups.reduce(
        (max, group) => Math.max(max, ...(group.schedules ?? []).map((slot) => slot.id ?? 0)),
        0,
      );
      parsed.nextScheduleId ??= maxScheduleId + 1;
      parsed.groups = parsed.groups.map((group) => {
        const schedules = Array.isArray(group.schedules) ? group.schedules : [];
        if (schedules.length > 0) return group;
        if (!group.day_of_week || !group.start_time || !group.end_time) {
          return { ...group, schedules: [], schedule_text: '' };
        }
        return {
          ...group,
          schedules: [
            {
              id: parsed.nextScheduleId++,
              day_of_week: group.day_of_week,
              start_time: group.start_time,
              end_time: group.end_time,
            },
          ],
          schedule_text: '',
        };
      });
      return parsed;
    }
  } catch {
    /* corrupted store -> reseed */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(store: DevStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full/unavailable */
  }
}

const delay = (ms = 80) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function asString(args: Args, key: string): string {
  const value = args?.[key];
  return typeof value === 'string' ? value : '';
}

function asNumber(args: Args, key: string): number {
  const value = args?.[key];
  return typeof value === 'number' ? value : Number(value);
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start)) throw new Error('Date de début invalide (format attendu AAAA-MM-JJ)');
  if (Number.isNaN(end)) throw new Error('Date de fin invalide (format attendu AAAA-MM-JJ)');
  if (end <= start) {
    throw new Error('La date de fin doit être postérieure à la date de début');
  }
}


// ---------------------------------------------------------------------------
// Phase 4 helpers — groups & enrollments (mirror of the Rust rules)
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

/** Same day next month, clamped to the end of the month. */
export function adjustDueDate(year: number, month: number, day: number): string {
  const dueDay = Math.min(day, lastDayOfMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}

function enrolledCount(store: DevStore, groupId: number): number {
  return store.enrollments.filter(
    (enrollment) => enrollment.group_id === groupId && enrollment.status === 'actif' && store.students.some(s => s.id === enrollment.student_id && !s.deleted_at),
  ).length;
}

/** Slots of a group, Monday first (mirrors `group_schedules` ordering). */
function sortSchedules(schedules: GroupSchedule[] | undefined): GroupSchedule[] {
  return [...(schedules ?? [])].sort(
    (a, b) =>
      DAY_NAMES.indexOf(a.day_of_week) - DAY_NAMES.indexOf(b.day_of_week) ||
      a.start_time.localeCompare(b.start_time),
  );
}

/** `"Lun 16-18, Mer 14-16"` — same text as the Rust `schedule_text`. */
function scheduleText(schedules: GroupSchedule[]): string {
  const shortDay = (day: string) => day.slice(0, 3);
  const shortTime = (value: string) => (value.endsWith(':00') ? value.slice(0, -3) : value);
  return schedules
    .map((slot) => `${shortDay(slot.day_of_week)} ${shortTime(slot.start_time)}-${shortTime(slot.end_time)}`)
    .join(', ');
}

/** Recompute the joined shape the Rust `SELECT_GROUP` returns. */
function groupRow(store: DevStore, group: Group): Group {
  const schedules = sortSchedules(group.schedules);
  return {
    ...group,
    schedules,
    schedule_text: scheduleText(schedules),
    subject_name: store.subjects.find((subject) => subject.id === group.subject_id)?.name ?? '—',
    teacher_name: store.teachers?.find((entry) => entry.id === group.teacher_id)?.full_name ?? null,
    level_name: store.levels.find((level) => level.id === group.level_id)?.name ?? '—',
    branch_name: store.branches.find((branch) => branch.id === group.branch_id)?.name ?? null,
    enrolled_count: enrolledCount(store, group.id),
  };
}

function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => {
    const dayDiff = DAY_NAMES.indexOf(a.day_of_week) - DAY_NAMES.indexOf(b.day_of_week);
    if (dayDiff !== 0) return dayDiff;
    return a.start_time.localeCompare(b.start_time) || a.id - b.id;
  });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validate a week of slots (mirror of `clean_schedules` in `schedules.rs`):
 * at least one day, known weekday, `end > start`, no duplicate day. The result
 * is sorted Monday-first, which is what the backend stores.
 */
function cleanSchedules(raw: Array<Record<string, unknown>>): GroupSchedule[] {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  if (raw.length === 0) throw new Error('Au moins un jour de cours est requis');

  const cleaned: GroupSchedule[] = [];
  raw.forEach((entry) => {
    const wanted = text(entry.day_of_week).toLowerCase();
    const day = DAY_NAMES.find((name) => name.toLowerCase() === wanted);
    if (!day) throw new Error(`Jour de la semaine invalide : ${text(entry.day_of_week)}`);
    const start_time = text(entry.start_time);
    const end_time = text(entry.end_time);
    if (!TIME_PATTERN.test(start_time)) {
      throw new Error('Heure de début invalide (format attendu HH:MM)');
    }
    if (!TIME_PATTERN.test(end_time)) {
      throw new Error('Heure de fin invalide (format attendu HH:MM)');
    }
    if (end_time <= start_time) {
      throw new Error(`L'heure de fin doit être après l'heure de début (${day})`);
    }
    const duplicate = cleaned.find((slot) => slot.day_of_week === day);
    if (duplicate) {
      throw new Error(
        `Le jour ${day} est déjà programmé (${duplicate.start_time}–${duplicate.end_time})`,
      );
    }
    cleaned.push({ id: 0, day_of_week: day, start_time, end_time });
  });

  return cleaned.sort(
    (a, b) => DAY_NAMES.indexOf(a.day_of_week) - DAY_NAMES.indexOf(b.day_of_week),
  );
}

function validateGroupInput(store: DevStore, input: Record<string, unknown>): GroupInput {
  const number = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const subject_id = number(input.subject_id);
  if (!store.subjects.some((subject) => subject.id === subject_id)) {
    throw new Error('Matière introuvable');
  }
  const level_id = number(input.level_id);
  if (!store.levels.some((level) => level.id === level_id)) {
    throw new Error('Niveau introuvable');
  }

  const branch_id = input.branch_id === null || input.branch_id === undefined
    ? null
    : number(input.branch_id);
  if (branch_id !== null) {
    const branch = store.branches.find((entry) => entry.id === branch_id);
    if (!branch) throw new Error('Branche introuvable');
    if (branch.level_id !== level_id) {
      throw new Error('La branche ne correspond pas au niveau sélectionné');
    }
  }

  const school_year_id = number(input.school_year_id);
  if (!store.schoolYears.some((year) => year.id === school_year_id)) {
    throw new Error('Année scolaire introuvable');
  }

  // Phase 13: the form sends the whole week, older callers send one slot.
  const rawSchedules = Array.isArray(input.schedules) && input.schedules.length > 0
    ? (input.schedules as Array<Record<string, unknown>>)
    : [
        {
          day_of_week: input.day_of_week,
          start_time: input.start_time,
          end_time: input.end_time,
        },
      ];
  const schedules = cleanSchedules(rawSchedules);
  const first = schedules[0];
  const day_of_week = first.day_of_week;
  const start_time = first.start_time;
  const end_time = first.end_time;

  const monthly_fee_cents = number(input.monthly_fee_cents);
  if (!Number.isFinite(monthly_fee_cents) || monthly_fee_cents <= 0) {
    throw new Error('Le tarif doit être supérieur à 0');
  }
  const capacity = number(input.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('La capacité doit être au moins 1');
  }

  return {
    subject_id,
    level_id,
    branch_id,
    teacher_id: input.teacher_id === null || input.teacher_id === undefined
      ? null
      : number(input.teacher_id),
    school_year_id,
    day_of_week,
    start_time,
    end_time,
    schedules,
    room: text(input.room) || null,
    monthly_fee_cents,
    capacity,
  };
}

/** Enroll one student; the invoice is created for the month of `startDate`. */
function enrollOne(
  store: DevStore,
  studentId: number,
  groupId: number,
  startDate: string,
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("Date d'inscription invalide (format attendu AAAA-MM-JJ)");
  }
  const student = store.students.find((entry) => entry.id === studentId);
  if (!student) throw new Error('Élève introuvable');
  if (student.status !== 'actif') {
    throw new Error("Cet élève est inactif : impossible de l'inscrire");
  }
  const raw = store.groups.find((entry) => entry.id === groupId);
  if (!raw) throw new Error('Groupe introuvable');
  if (raw.status !== 'actif') {
    throw new Error("Ce groupe est inactif : impossible d'y inscrire un élève");
  }

  const existing = store.enrollments.find(
    (entry) => entry.student_id === studentId && entry.group_id === groupId,
  );
  if (existing && existing.status === 'actif') throw new Error('Déjà inscrit dans ce groupe');

  if (enrolledCount(store, groupId) >= raw.capacity) throw new Error('Groupe complet');

  let enrollment: DevEnrollment;
  if (existing) {
    existing.start_date = startDate;
    existing.end_date = null;
    existing.status = 'actif';
    enrollment = existing;
  } else {
    enrollment = {
      id: store.nextEnrollmentId++,
      student_id: studentId,
      group_id: groupId,
      start_date: startDate,
      end_date: null,
      status: 'actif',
    };
    store.enrollments.push(enrollment);
  }

  const [year, month, day] = startDate.split('-').map(Number);
  const alreadyInvoiced = store.invoices.find(
    (invoice) =>
      invoice.enrollment_id === enrollment.id &&
      invoice.period_month === month &&
      invoice.period_year === year,
  );
  if (!alreadyInvoiced) {
    const invoice: DevInvoice = {
      id: store.nextInvoiceId++,
      enrollment_id: enrollment.id,
      period_month: month,
      period_year: year,
      amount_cents: raw.monthly_fee_cents,
      paid_amount_cents: 0,
      status: 'impayé',
      due_date: adjustDueDate(year, month, day),
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    store.invoices.push(invoice);
  }

  logAudit(
    store,
    'ENROLL',
    enrollment.id,
    JSON.stringify({
      student_id: studentId,
      group_id: groupId,
      start_date: startDate,
      monthly_fee_cents: raw.monthly_fee_cents,
    }),
    'enrollment',
  );

  return enrollment.id;
}


// ---------------------------------------------------------------------------
// Phase 5 helpers — invoicing & payments (mirror of the Rust rules)
// ---------------------------------------------------------------------------

const MONTH_NAMES_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function nowTimestamp(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

/** Whole days between two `YYYY-MM-DD` dates (`to - from`). */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function invoiceStatus(paid: number, amount: number): string {
  if (paid >= amount) return 'payé';
  if (paid > 0) return 'partiel';
  return 'impayé';
}

function devGroupLabel(store: DevStore, invoice: DevInvoice): string {
  const enrollment = store.enrollments.find((entry) => entry.id === invoice.enrollment_id);
  const group = store.groups.find((entry) => entry.id === enrollment?.group_id);
  if (!group) return '—';
  return `${group.subject_name} ${group.level_name}`.trim();
}

/** Joined, newest-first invoice list of one student. */
function devInvoiceRows(store: DevStore, studentId: number): StudentInvoice[] {
  const enrollmentIds = new Set(
    store.enrollments.filter((entry) => entry.student_id === studentId).map((entry) => entry.id),
  );
  return store.invoices
    .filter((invoice) => enrollmentIds.has(invoice.enrollment_id))
    .map((invoice) => {
      const enrollment = store.enrollments.find((entry) => entry.id === invoice.enrollment_id);
      const group = store.groups.find((entry) => entry.id === enrollment?.group_id);
      return {
        id: invoice.id,
        enrollment_id: invoice.enrollment_id,
        group_subject: group?.subject_name ?? '—',
        group_level: group?.level_name ?? '—',
        group_branch: group?.branch_name ?? null,
        period_month: invoice.period_month,
        period_year: invoice.period_year,
        amount_cents: invoice.amount_cents,
        paid_amount_cents: invoice.paid_amount_cents,
        remaining_cents: Math.max(0, invoice.amount_cents - invoice.paid_amount_cents),
        status: invoice.status as StudentInvoice['status'],
        due_date: invoice.due_date,
      };
    })
    .sort(
      (a, b) =>
        b.period_year - a.period_year ||
        b.period_month - a.period_month ||
        b.id - a.id,
    );
}

/** Late / upcoming / settled buckets for a month. */
function devAlerts(store: DevStore, month: number, year: number): PaymentAlerts {
  const today = todayIsoDate();
  const byStudent = new Map<number, InvoiceAlert & { unpaidDue: string | null }>();

  for (const invoice of store.invoices) {
    if (invoice.period_month !== month || invoice.period_year !== year) continue;
    const enrollment = store.enrollments.find((entry) => entry.id === invoice.enrollment_id);
    const student = store.students.find((entry) => entry.id === enrollment?.student_id);
    const group = store.groups.find(entry => entry.id === enrollment?.group_id);
    if (!student || student.deleted_at || !group || group.deleted_at) continue;

    const label = devGroupLabel(store, invoice);
    const current = byStudent.get(student.id) ?? {
      student_id: student.id,
      student_name: student.full_name,
      student_phone: student.phone,
      groups: '',
      total_due_cents: 0,
      total_paid_cents: 0,
      due_date: invoice.due_date,
      days_late: 0,
      last_payment_date: null,
      last_payment_method: null,
      unpaidDue: null,
    };

    if (label && !current.groups.split(', ').includes(label)) {
      current.groups = current.groups ? `${current.groups}, ${label}` : label;
    }
    current.total_paid_cents += invoice.paid_amount_cents;
    current.total_due_cents += Math.max(0, invoice.amount_cents - invoice.paid_amount_cents);
    if (invoice.paid_amount_cents < invoice.amount_cents && invoice.status !== 'payé') {
      current.unpaidDue =
        current.unpaidDue === null || invoice.due_date < current.unpaidDue
          ? invoice.due_date
          : current.unpaidDue;
    }

    byStudent.set(student.id, current);
  }

  const late: InvoiceAlert[] = [];
  const upcoming: InvoiceAlert[] = [];
  const current: InvoiceAlert[] = [];

  for (const entry of byStudent.values()) {
    const lastPayment = store.payments
      .filter((payment) => {
        if (payment.student_id !== entry.student_id || payment.invoice_id === null) return false;
        const invoice = store.invoices.find((row) => row.id === payment.invoice_id);
        return invoice?.period_month === month && invoice?.period_year === year;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];

    const { unpaidDue, ...alert } = entry;
    alert.last_payment_date = lastPayment?.created_at ?? null;
    alert.last_payment_method = lastPayment?.payment_method ?? null;
    alert.total_due_cents = Math.max(0, alert.total_due_cents);

    if (alert.total_due_cents <= 0) {
      alert.days_late = 0;
      current.push(alert);
      continue;
    }

    if (unpaidDue) {
      alert.due_date = unpaidDue;
      alert.days_late = daysBetween(unpaidDue, today);
    }
    if (alert.days_late > 0) late.push(alert);
    else if (alert.days_late >= -3) upcoming.push(alert);
  }

  late.sort((a, b) => b.days_late - a.days_late || a.student_name.localeCompare(b.student_name));
  upcoming.sort((a, b) => a.days_late - b.days_late || a.student_name.localeCompare(b.student_name));
  current.sort((a, b) => a.student_name.localeCompare(b.student_name));

  return { late, upcoming, current };
}

/** Allocate a payment oldest-first; returns the first payment id. */
function devRecordPayment(
  store: DevStore,
  studentId: number,
  invoiceIds: number[],
  amountCents: number,
  method: string,
  notes: string | null,
): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Le montant doit être supérieur à 0');
  }
  if (!invoiceIds.length) throw new Error('Aucune facture sélectionnée');
  const student = store.students.find((entry) => entry.id === studentId);
  if (!student) throw new Error('Élève introuvable');

  const invoices = invoiceIds.map((invoiceId) => {
    const invoice = store.invoices.find((entry) => entry.id === invoiceId);
    const enrollment = invoice
      ? store.enrollments.find((entry) => entry.id === invoice.enrollment_id)
      : undefined;
    if (!invoice || enrollment?.student_id !== studentId) {
      throw new Error(`La facture #${invoiceId} n'appartient pas à cet élève`);
    }
    return invoice;
  });

  invoices.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);

  const createdAt = nowTimestamp();
  const normalizedMethod = method.trim() || 'espèces';
  let leftover = amountCents;
  let firstId: number | null = null;
  const allocations: Array<{ invoice_id: number; amount_cents: number }> = [];

  for (const invoice of invoices) {
    if (leftover <= 0) break;
    const remaining = Math.max(0, invoice.amount_cents - invoice.paid_amount_cents);
    if (remaining <= 0) continue;
    const allocate = Math.min(remaining, leftover);

    const payment: DevPayment = {
      id: store.nextPaymentId++,
      student_id: studentId,
      invoice_id: invoice.id,
      amount_cents: allocate,
      payment_method: normalizedMethod,
      notes,
      created_at: createdAt,
    };
    store.payments.push(payment);
    firstId ??= payment.id;
    allocations.push({ invoice_id: invoice.id, amount_cents: allocate });

    invoice.paid_amount_cents += allocate;
    invoice.status = invoiceStatus(invoice.paid_amount_cents, invoice.amount_cents);
    leftover -= allocate;
  }

  let advance = 0;
  if (leftover > 0) {
    const payment: DevPayment = {
      id: store.nextPaymentId++,
      student_id: studentId,
      invoice_id: null,
      amount_cents: leftover,
      payment_method: normalizedMethod,
      notes,
      created_at: createdAt,
    };
    store.payments.push(payment);
    firstId ??= payment.id;
    advance = leftover;
  }

  logAudit(
    store,
    'PAYMENT',
    firstId ?? 0,
    JSON.stringify({
      student_id: studentId,
      amount_cents: amountCents,
      method: normalizedMethod,
      invoice_ids: invoiceIds,
      allocations,
      advance_cents: advance,
      created_at: createdAt,
    }),
    'payment' as 'student',
  );

  return firstId ?? 0;
}

function devPaymentsHistory(
  store: DevStore,
  studentId: number | null,
  month: number | null,
  year: number | null,
  page: number,
  limit: number,
): PaginatedPayments {
  const filtered = store.payments
    .filter((payment) => (studentId === null ? true : payment.student_id === studentId))
    .filter((payment) => {
      if (month === null || year === null) return true;
      if (payment.invoice_id === null) return false;
      const invoice = store.invoices.find((entry) => entry.id === payment.invoice_id);
      return invoice?.period_month === month && invoice?.period_year === year;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const start = (Math.max(page, 1) - 1) * safeLimit;

  const data: PaymentRow[] = filtered.slice(start, start + safeLimit).map((payment) => ({
    id: payment.id,
    student_id: payment.student_id,
    student_name: store.students.find((entry) => entry.id === payment.student_id)?.full_name ?? '—',
    invoice_id: payment.invoice_id,
    amount_cents: payment.amount_cents,
    payment_method: payment.payment_method,
    notes: payment.notes,
    created_at: payment.created_at,
  }));

  return { data, total: filtered.length, page: Math.max(page, 1), limit: safeLimit };
}

/** Payment rows sharing the same student + timestamp = one receipt. */
function devReceiptSession(store: DevStore, studentId: number, createdAt: string): DevPayment[] {
  return store.payments.filter(
    (payment) => payment.student_id === studentId && payment.created_at === createdAt,
  );
}

function devCreateReceipt(store: DevStore, paymentId: number): number {
  const payment = store.payments.find((entry) => entry.id === paymentId);
  if (!payment) throw new Error('Paiement introuvable');

  const existing = store.receipts.find((receipt) => receipt.payment_id === paymentId);
  if (existing) return existing.id;

  const student = store.students.find((entry) => entry.id === payment.student_id);
  const session = devReceiptSession(store, payment.student_id, payment.created_at);
  const amount = session.reduce((total, entry) => total + entry.amount_cents, 0);
  const labels: string[] = [];
  for (const entry of session) {
    if (entry.invoice_id === null) continue;
    const invoice = store.invoices.find((row) => row.id === entry.invoice_id);
    if (!invoice) continue;
    const label = devGroupLabel(store, invoice);
    if (label && label !== '—' && !labels.includes(label)) labels.push(label);
  }

  const dayStamp = payment.created_at.slice(0, 10).replace(/-/g, '');
  const used = store.receipts.filter((receipt) => receipt.receipt_number.startsWith(`REC-${dayStamp}-`))
    .length;

  const receipt: DevReceipt = {
    id: store.nextReceiptId++,
    payment_id: paymentId,
    receipt_number: `REC-${dayStamp}-${String(used + 1).padStart(4, '0')}`,
    student_name: student?.full_name ?? '—',
    amount_cents: amount,
    payment_date: payment.created_at,
    groups_text: labels.join(', '),
    center_name: store.settings.center_name?.trim() || 'Centre',
    created_at: nowTimestamp(),
  };
  store.receipts.push(receipt);

  logAudit(
    store,
    'RECEIPT',
    receipt.id,
    JSON.stringify({
      payment_id: paymentId,
      receipt_number: receipt.receipt_number,
      student_id: payment.student_id,
      amount_cents: amount,
    }),
    'student',
  );

  return receipt.id;
}

function devReceiptData(store: DevStore, receiptId: number): ReceiptData {
  const receipt = store.receipts.find((entry) => entry.id === receiptId);
  if (!receipt) throw new Error('Reçu introuvable');
  const payment = store.payments.find((entry) => entry.id === receipt.payment_id);

  const periods: Array<{ month: number; year: number }> = [];
  if (payment) {
    for (const entry of devReceiptSession(store, payment.student_id, payment.created_at)) {
      if (entry.invoice_id === null) continue;
      const invoice = store.invoices.find((row) => row.id === entry.invoice_id);
      if (!invoice) continue;
      if (!periods.some((p) => p.month === invoice.period_month && p.year === invoice.period_year)) {
        periods.push({ month: invoice.period_month, year: invoice.period_year });
      }
    }
  }
  periods.sort((a, b) => a.year - b.year || a.month - b.month);

  return {
    receipt_number: receipt.receipt_number,
    center_name: receipt.center_name,
    center_address: store.settings.center_address ?? null,
    center_phone: store.settings.center_phone ?? null,
    center_logo: store.settings.center_logo ?? null,
    student_name: receipt.student_name,
    amount_cents: receipt.amount_cents,
    payment_date: receipt.payment_date,
    payment_method: payment?.payment_method ?? '',
    groups_text: receipt.groups_text,
    period_text: periods.map((p) => `${MONTH_NAMES_FR[p.month - 1]} ${p.year}`).join(', '),
    periods,
  };
}


// ---------------------------------------------------------------------------
// Phase 6 — teachers, activities & compensation
// ---------------------------------------------------------------------------

const TEACHER_MODES = ['fixed_monthly', 'hourly', 'per_session', 'percentage'] as const;

const money = (cents: number) => `${(cents / 100).toFixed(2)} DH`;
const num = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};
const pct = (value: number) => num(value / 100);

function teacherRow(store: DevStore, teacher: DevTeacher): Teacher {
  const subjects = teacher.subject_ids
    .map((id) => store.subjects.find((subject) => subject.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    id: teacher.id,
    full_name: teacher.full_name,
    phone: teacher.phone,
    email: teacher.email,
    notes: teacher.notes,
    status: teacher.status as Teacher['status'],
    subjects: subjects.join(', '),
    group_count: store.groups.filter(
      (group) => group.teacher_id === teacher.id && group.status === 'actif',
    ).length,
    compensation_mode: (teacher.compensation_mode as CompensationMode | null) ?? null,
    compensation_value_cents: teacher.compensation_value_cents,
    bonus_pct: teacher.bonus_pct,
    created_at: teacher.created_at,
    updated_at: teacher.updated_at,
  };
}

function findTeacher(store: DevStore, id: number): DevTeacher {
  const teacher = store.teachers.find((entry) => entry.id === id);
  if (!teacher) throw new Error('Enseignant introuvable');
  return teacher;
}

function compensationConfig(teacher: DevTeacher) {
  if (!teacher.compensation_mode || teacher.compensation_value_cents === null) return null;
  return {
    mode: teacher.compensation_mode as CompensationMode,
    value_cents: teacher.compensation_value_cents,
    bonus_pct: teacher.bonus_pct,
  };
}

function teacherGroups(store: DevStore, teacherId: number): TeacherGroup[] {
  return store.groups
    .filter((group) => group.teacher_id === teacherId && group.status === 'actif')
    .map((group) => ({
      group_id: group.id,
      subject_name: store.subjects.find((s) => s.id === group.subject_id)?.name ?? '—',
      level_name: store.levels.find((l) => l.id === group.level_id)?.name ?? '—',
      branch_name: store.branches.find((b) => b.id === group.branch_id)?.name ?? null,
      day_of_week: group.day_of_week ?? '',
      start_time: group.start_time ?? '',
      end_time: group.end_time ?? '',
      monthly_fee_cents: group.monthly_fee_cents,
      enrolled_count: enrolledCount(store, group.id),
    }))
    .sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'fr') || a.group_id - b.group_id);
}

function teacherDetail(store: DevStore, id: number): TeacherDetail {
  const teacher = findTeacher(store, id);
  return {
    teacher: teacherRow(store, teacher),
    subject_ids: [...teacher.subject_ids].sort((a, b) => a - b),
    groups: teacherGroups(store, id),
    compensation_config: compensationConfig(teacher),
  };
}

function normalizeTeacherInput(store: DevStore, data: unknown): {
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  subject_ids: number[];
} {
  const input = (data ?? {}) as Record<string, unknown>;
  const fullName = typeof input.full_name === 'string' ? input.full_name.trim() : '';
  if (!fullName) throw new Error('Le nom complet est obligatoire');
  if (fullName.length < 2) throw new Error('Le nom complet est trop court');

  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  const phone = text(input.phone);
  if (phone) {
    const digits = phone.replace(/[^0-9+]/g, '');
    const valid = /^\+212[5-7]\d{8}$/.test(digits) || /^0[5-7]\d{8}$/.test(digits);
    if (!valid) {
      throw new Error('Format de téléphone invalide (06XXXXXXXX, 07XXXXXXXX ou +212…)');
    }
  }

  const email = text(input.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Format d'email invalide");
  }

  const subjectIds = Array.isArray(input.subject_ids)
    ? [...new Set(input.subject_ids.map((value) => Number(value)))]
    : [];
  for (const subjectId of subjectIds) {
    if (!store.subjects.some((subject) => subject.id === subjectId)) {
      throw new Error(`Matière introuvable (#${subjectId})`);
    }
  }

  return { full_name: fullName, phone, email, notes: text(input.notes), subject_ids: subjectIds };
}

function validatePeriod(month: number, year: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mois invalide (1 à 12)');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Année invalide');
}

const periodPrefix = (month: number, year: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;

function settledTotal(store: DevStore, teacherId: number, month: number, year: number): number {
  return store.teacherSettlements
    .filter((row) => row.teacher_id === teacherId && row.month === month && row.year === year)
    .reduce((sum, row) => sum + row.amount_cents, 0);
}

function compensationStatus(total: number, settled: number): string {
  if (total > 0 && settled >= total) return 'settled';
  if (settled > 0) return 'partial';
  return 'pending';
}

/** Mirrors `commands::compensation::calculate_compensation`. */
function calculateCompensation(
  store: DevStore,
  teacherId: number,
  month: number,
  year: number,
): CompensationDetail {
  validatePeriod(month, year);
  const teacher = findTeacher(store, teacherId);
  const config = compensationConfig(teacher);
  if (!config) throw new Error('Compensation non configurée');

  const groups = teacherGroups(store, teacherId);
  const theoretical = groups.reduce(
    (sum, group) => sum + group.monthly_fee_cents * group.enrolled_count,
    0,
  );

  const monthActivities = store.teacherActivities.filter(
    (activity) =>
      activity.teacher_id === teacherId &&
      activity.activity_date.startsWith(periodPrefix(month, year)),
  );
  const hours = monthActivities.reduce((sum, activity) => sum + (activity.hours ?? 0), 0);
  const sessions = monthActivities.reduce((sum, activity) => sum + (activity.sessions ?? 0), 0);

  const detailLines: string[] = [];
  let base = 0;
  let reportedHours: number | null = null;
  let reportedSessions: number | null = null;

  switch (config.mode) {
    case 'fixed_monthly': {
      base = config.value_cents;
      detailLines.push(`Montant fixe : ${money(base)}`);
      break;
    }
    case 'hourly': {
      base = Math.round(hours * config.value_cents);
      reportedHours = hours;
      detailLines.push(`${num(hours)} heures × ${money(config.value_cents)} / heure = ${money(base)}`);
      break;
    }
    case 'per_session': {
      base = config.value_cents * sessions;
      reportedSessions = sessions;
      detailLines.push(`${sessions} séances × ${money(config.value_cents)} / séance = ${money(base)}`);
      break;
    }
    case 'percentage': {
      for (const group of groups) {
        const total = group.monthly_fee_cents * group.enrolled_count;
        detailLines.push(
          `${group.subject_name} — ${group.level_name}${group.branch_name ? ` · ${group.branch_name}` : ''} : ` +
            `${group.enrolled_count} élèves × ${money(group.monthly_fee_cents)} = ${money(total)}`,
        );
      }
      detailLines.push(`Total théorique : ${money(theoretical)}`);
      base = Math.round((theoretical * (config.value_cents / 100)) / 100);
      detailLines.push(`Montant principal (${pct(config.value_cents)}%) : ${money(base)}`);
      break;
    }
    default:
      throw new Error('Mode de compensation invalide');
  }

  let bonus = 0;
  if (config.bonus_pct && config.bonus_pct > 0) {
    bonus = Math.round((theoretical * config.bonus_pct) / 100);
    detailLines.push(
      `Bonus recrutement : ${money(theoretical)} × ${num(config.bonus_pct)}% = ${money(bonus)}`,
    );
  }

  const total = base + bonus;
  const alreadySettled = settledTotal(store, teacherId, month, year);

  return {
    teacher_name: teacher.full_name,
    mode: config.mode,
    base_amount_cents: base,
    bonus_amount_cents: bonus,
    total_cents: total,
    detail_lines: detailLines,
    already_settled_cents: alreadySettled,
    remaining_cents: total - alreadySettled,
    groups: groups.map((group) => ({
      group_id: group.group_id,
      subject_name: group.subject_name,
      level_name: group.level_name,
      branch_name: group.branch_name,
      enrolled_count: group.enrolled_count,
      monthly_fee_cents: group.monthly_fee_cents,
      total_cents: group.monthly_fee_cents * group.enrolled_count,
    })),
    theoretical_cents: theoretical,
    value_cents: config.value_cents,
    bonus_pct: config.bonus_pct,
    hours: reportedHours,
    sessions: reportedSessions,
  };
}

/** Execute a command against the local development store. */
/**
 * Phase 7 — the browser stand-in for `commands/dashboard.rs`.
 *
 * Same definitions as the Rust side: revenue follows `payments.created_at`,
 * theoretical revenue follows the invoice period, and the alert window is
 * ±7 days around today.
 */
function devStudentsDuring(store: DevStore, month: number, year: number): number {
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const firstDay = `${year}-${pad2(month)}-01`;
  const lastDay = `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;
  const ids = new Set(
    store.enrollments
      .filter(
        (entry) =>
          entry.start_date <= lastDay && (!entry.end_date || entry.end_date >= firstDay),
      )
      .map((entry) => entry.student_id),
  );
  return ids.size;
}

function devCollectionRate(revenue: number, theoretical: number): number {
  if (theoretical <= 0) return 0;
  return Math.round((revenue / theoretical) * 10_000) / 100;
}

function devDashboardKpis(store: DevStore, month: number, year: number): DashboardKPIs {
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const monthPrefix = `${year}-${pad2(month)}`;
  const revenue = store.payments
    .filter((payment) => payment.created_at.startsWith(monthPrefix))
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const theoretical = store.invoices
    .filter((invoice) => invoice.period_month === month && invoice.period_year === year)
    .reduce((sum, invoice) => sum + invoice.amount_cents, 0);

  const prev = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
  const prevRevenue = store.payments
    .filter((payment) => payment.created_at.startsWith(`${prev.year}-${pad2(prev.month)}`))
    .reduce((sum, payment) => sum + payment.amount_cents, 0);

  const expenses = devExpensesTotal(store, month, year);
  const compensation = devPayrollTotal(store, month, year);
  const prevExpenses = devExpensesTotal(store, prev.month, prev.year);
  const prevCompensation = devPayrollTotal(store, prev.month, prev.year);

  return {
    total_active_students: store.students.filter(
      (student) => !student.deleted_at && (student.status ?? 'actif') === 'actif',
    ).length,
    monthly_revenue_cents: revenue,
    theoretical_revenue_cents: theoretical,
    collection_rate: devCollectionRate(revenue, theoretical),
    active_groups: store.groups.filter((group) => !group.deleted_at && (group.status ?? 'actif') === 'actif').length,
    active_teachers: store.teachers.filter((teacher) => !teacher.deleted_at && teacher.status === 'actif').length,
    prev_month_revenue_cents: prevRevenue,
    prev_month_students: devStudentsDuring(store, prev.month, prev.year),
    // Phase 11 — same arithmetic as `dashboard::net_income_of`.
    total_expenses_cents: expenses,
    total_compensation_cents: compensation,
    net_income_cents: revenue - expenses - compensation,
    prev_month_net_income_cents: prevRevenue - prevExpenses - prevCompensation,
  };
}

/** Charges of one month (dev mirror of `expenses::month_total`). */
function devExpensesTotal(store: DevStore, month: number, year: number): number {
  return (store.expenses ?? [])
    .filter((row) => !row.deleted_at && row.month === month && row.year === year)
    .reduce((sum, row) => sum + row.amount_cents, 0);
}

/** Payroll of one month: every active teacher with a configuration. */
function devPayrollTotal(store: DevStore, month: number, year: number): number {
  return store.teachers
    .filter((teacher) => teacher.status === 'actif' && compensationConfig(teacher))
    .reduce((sum, teacher) => sum + calculateCompensation(store, teacher.id, month, year).total_cents, 0);
}

/** Dev mirror of `expenses::categories_from_json` (defaults when unusable). */
function devExpenseCategories(store: DevStore): string[] {
  const raw = store.settings.expense_categories;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (cleaned.length > 0) return cleaned;
      }
    } catch {
      /* corrupted value → defaults */
    }
  }
  return [...DEFAULT_EXPENSE_CATEGORIES];
}

function devExpenseRow(store: DevStore, row: DevExpense): Expense {
  void store;
  return { ...row };
}

const ALERT_WINDOW_DAYS = 7;
const MAX_ALERTS = 15;

function devDashboardAlerts(store: DevStore): AlertItem[] {
  const today = todayIsoDate();
  const shift = (offset: number) => {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() + offset);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  };
  const from = shift(-ALERT_WINDOW_DAYS);
  const to = shift(ALERT_WINDOW_DAYS);

  return store.invoices
    .filter(
      (invoice) =>
        invoice.status !== 'payé' &&
        invoice.paid_amount_cents < invoice.amount_cents &&
        Boolean(invoice.due_date) &&
        invoice.due_date >= from &&
        invoice.due_date <= to,
    )
    .map((invoice) => {
      const enrollment = store.enrollments.find((entry) => entry.id === invoice.enrollment_id);
      const student = store.students.find((entry) => entry.id === enrollment?.student_id);
      const group = store.groups.find((entry) => entry.id === enrollment?.group_id);
      const daysRemaining = daysBetween(today, invoice.due_date);
      return {
        student_id: student?.id ?? 0,
        student_name: student?.full_name ?? '—',
        group_name: group ? `${group.subject_name} ${group.level_name}`.trim() : '',
        amount_cents: Math.max(invoice.amount_cents - invoice.paid_amount_cents, 0),
        due_date: invoice.due_date,
        days_remaining: daysRemaining,
        severity:
          daysRemaining < 0 ? 'late' : daysRemaining <= 3 ? 'upcoming' : 'ok',
      } satisfies AlertItem;
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.student_id - b.student_id)
    .slice(0, MAX_ALERTS);
}

function devRecentPayments(store: DevStore, limit: number): RecentPayment[] {
  if (limit <= 0) throw new Error('Limite invalide');
  return [...store.payments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, Math.min(limit, 50))
    .map((payment) => {
      const student = store.students.find((entry) => entry.id === payment.student_id);
      return {
        id: payment.id,
        student_name: student?.full_name ?? '—',
        amount_cents: payment.amount_cents,
        payment_method: payment.payment_method,
        created_at: payment.created_at,
      } satisfies RecentPayment;
    });
}


// ---------------------------------------------------------------------------
// Phase 9 — demo data (browser mirror of `commands/demo.rs`)
// ---------------------------------------------------------------------------

/** Demo students: (name, level id, phone). */
const DEMO_STUDENT_ROWS: Array<[string, number, string]> = [
  ['Youssef El Amrani', 10, '0612345678'],
  ['Fatima Zahra Bennis', 12, '0709876543'],
  ['Amine Tazi', 11, '0611223344'],
  ['Salma Idrissi', 9, '0705566778'],
  ['Hamza Berrada', 7, '0698765432'],
  ['Nadia Chraibi', 6, '0701234567'],
  ['Mehdi Skalli', 8, '0612349876'],
  ['Imane Fassi', 12, '0703456789'],
  ['Omar Benjelloun', 5, '0655443322'],
  ['Kenza Alaoui', 11, '0709871234'],
  ['Rachid Chraibi', 10, '0666778899'],
  ['Hajar Sabri', 4, '0702345678'],
  ['Anas Ouazzani', 3, '0614567890'],
  ['Layla Bennani', 2, '0708901234'],
  ['Soufiane Cherkaoui', 1, '0612340987'],
];

/** Demo teachers: (name, subject, phone). */
const DEMO_TEACHER_ROWS: Array<[string, string, string]> = [
  ['Mohamed Alaoui', 'Mathématiques', '0661112233'],
  ['Khadija Fassi', 'Physique-Chimie', '0708887766'],
  ['Hassan Berrada', 'SVT', '0662223344'],
  ['Nadia Cherkaoui', 'Français', '0709998887'],
  ['Omar Skalli', 'Anglais', '0663334455'],
];

/** (mode, value, bonus %) — `percentage` is stored as percentage × 100. */
const DEMO_COMPENSATION_ROWS: Array<[string, number, number | null]> = [
  ['percentage', 4000, 5],
  ['hourly', 15000, null],
  ['per_session', 20000, null],
  ['fixed_monthly', 300000, null],
  ['percentage', 3500, null],
];

/** (subject, level id, teacher index, fee, capacity, day, start time). */
const DEMO_GROUP_ROWS: Array<[string, number, number, number, number, string, string]> = [
  ['Mathématiques', 11, 0, 45000, 20, 'Lundi', '16:00'],
  ['Mathématiques', 10, 0, 30000, 18, 'Mercredi', '17:00'],
  ['Physique-Chimie', 12, 1, 50000, 16, 'Mardi', '18:00'],
  ['SVT', 11, 2, 35000, 12, 'Jeudi', '16:00'],
  ['Français', 9, 3, 25000, 20, 'Samedi', '09:00'],
  ['Français', 12, 3, 40000, 10, 'Vendredi', '10:00'],
  ['Anglais', 8, 4, 20000, 20, 'Samedi', '11:00'],
  ['Anglais', 10, 4, 30000, 14, 'Dimanche', '16:00'],
];

/** Which demo students join which demo groups (1–3 groups each). */
const DEMO_ENROLLMENT_ROWS: number[][] = [
  [0, 1],
  [2],
  [0, 1, 7],
  [4, 6],
  [4],
  [5, 6],
  [6, 7],
  [2],
  [4, 5],
  [0, 7],
  [1],
  [3, 4],
  [6],
  [4],
  [5, 0],
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Invoice for `(month, year)` if the enrollment does not have one yet. */
function ensureDemoInvoice(
  store: DevStore,
  enrollment: DevEnrollment,
  month: number,
  year: number,
): void {
  const exists = store.invoices.some(
    (invoice) =>
      invoice.enrollment_id === enrollment.id &&
      invoice.period_month === month &&
      invoice.period_year === year,
  );
  if (exists) return;
  const group = store.groups.find((entry) => entry.id === enrollment.group_id);
  const day = Number(enrollment.start_date.slice(8, 10)) || 1;
  store.invoices.push({
    id: store.nextInvoiceId++,
    enrollment_id: enrollment.id,
    period_month: month,
    period_year: year,
    amount_cents: group?.monthly_fee_cents ?? 0,
    paid_amount_cents: 0,
    status: 'impayé',
    due_date: adjustDueDate(year, month, day),
    created_at: nowTimestamp(),
  });
}

/**
 * Build the demo centre used by `cmd_seed_demo_data`.
 *
 * The browser stub is a throwaway mirror, so — unlike the Rust command, which
 * refuses to touch a database that already holds students — it simply replaces
 * the store (keeping the settings) to give the same catalogue as the desktop
 * build. The Settings button is shown in both cases and the real guard lives in
 * `commands/demo.rs`.
 */
function buildDemoStore(previous: DevStore): DevStore {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousStart = `${previousYear}-${pad2(previousMonth)}-05`;
  const currentStart = `${year}-${pad2(month)}-01`;

  const base = seed();
  const store: DevStore = {
    ...base,
    settings: { ...base.settings, ...previous.settings },
    students: [],
    groups: [],
    enrollments: [],
    invoices: [],
    payments: [],
    receipts: [],
    teachers: [],
    teacherActivities: [],
    teacherSettlements: [],
    expenses: [],
    auditLog: [],
    nextStudentId: 1,
    nextGroupId: 1,
    nextEnrollmentId: 1,
    nextInvoiceId: 1,
    nextPaymentId: 1,
    nextReceiptId: 1,
    nextTeacherId: 1,
    nextActivityId: 1,
    nextSettlementId: 1,
    nextExpenseId: 1,
    nextAuditId: 1,
  };

  // -- monthly charges (Phase 11) -------------------------------------------
  // Same shape as `demo.rs`: the seven charges of the month plus the previous
  // month's (without the supplies run) so the net card has a trend.
  const charges: Array<[string, number, string]> = [
    ['Loyer local principal', 1200, 'Loyer'],
    ['Abonnement fibre', 250, 'WiFi'],
    ['Facture électricité', 380, 'Électricité'],
    ['Facture eau', 150, 'Eau'],
    ['Salaire assistante', 800, 'Assistance'],
    ['Fournitures pédagogiques', 220, 'Fournitures'],
    ['Photocopies', 90, 'Fournitures'],
  ];
  charges.forEach(([label, dirhams, category], index) => {
    const periods: Array<[number, number]> = [
      [month, year],
      [previousMonth, previousYear],
    ];
    for (const [periodMonth, periodYear] of periods) {
      if (periodMonth !== month && index >= 5) continue;
      const amount = periodMonth !== month && category === 'Électricité' ? dirhams + 40 : dirhams;
      store.expenses.push({
        id: store.nextExpenseId++,
        label,
        amount_cents: amount * 100,
        category,
        month: periodMonth,
        year: periodYear,
        notes: null,
        created_at: nowTimestamp(),
      });
    }
  });

  // -- teachers -------------------------------------------------------------
  const teacherIds = DEMO_TEACHER_ROWS.map(([name, subject, phone], index) => {
    const subjectId = store.subjects.find((entry) => entry.name === subject)?.id ?? null;
    const [mode, value, bonus] = DEMO_COMPENSATION_ROWS[index];
    const teacher: DevTeacher = {
      id: store.nextTeacherId++,
      full_name: name,
      phone,
      email: `${name.toLowerCase().replace(' ', '.')}@centre-demo.ma`,
      notes: 'Enseignant de démonstration',
      status: 'actif',
      subject_ids: subjectId ? [subjectId] : [],
      compensation_mode: mode,
      compensation_value_cents: value,
      bonus_pct: bonus,
      created_at: nowTimestamp(),
      updated_at: nowTimestamp(),
    };
    store.teachers.push(teacher);
    return teacher.id;
  });

  // -- groups ---------------------------------------------------------------
  const groupIds = DEMO_GROUP_ROWS.map(([subject, levelId, teacher, fee, capacity, day, time], index) => {
    const subjectId = store.subjects.find((entry) => entry.name === subject)?.id ?? null;
    const level = store.levels.find((entry) => entry.id === levelId);
    const teacherId = teacherIds[teacher];
    const startHour = Number(time.slice(0, 2)) + 2;
    const group: Group = {
      id: store.nextGroupId++,
      subject_id: subjectId,
      subject_name: subject,
      level_id: levelId,
      level_name: level?.name ?? '—',
      branch_id: null,
      branch_name: null,
      teacher_id: teacherId,
      teacher_name: store.teachers.find((entry) => entry.id === teacherId)?.full_name ?? null,
      school_year_id: 1,
      day_of_week: day,
      start_time: time,
      end_time: `${pad2(startHour)}:${time.slice(3, 5)}`,
      room: `Salle ${index + 1}`,
      monthly_fee_cents: fee,
      capacity,
      enrolled_count: 0,
      status: 'actif',
      schedules: [
        {
          id: store.nextScheduleId++,
          day_of_week: day,
          start_time: time,
          end_time: `${pad2(startHour)}:${time.slice(3, 5)}`,
        },
      ],
      schedule_text: '',
    };
    store.groups.push(group);
    return group.id;
  });

  // -- students -------------------------------------------------------------
  const studentIds = DEMO_STUDENT_ROWS.map(([name, levelId, phone], index) => {
    const level = store.levels.find((entry) => entry.id === levelId);
    const student: Student = {
      id: store.nextStudentId++,
      full_name: name,
      first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '),
      guardian_phone: phone, guardian_relation: null, secondary_contact_name: null,
      school_name: null, enrollment_date: new Date().toISOString().slice(0, 10),
      birth_date: `20${pad2(5 + (index % 12))}-${pad2(1 + (index % 12))}-${pad2(1 + (index % 27))}`,
      phone,
      secondary_contact_phone: `071${String(10000000 + index * 1111).slice(1)}`,
      level_id: levelId,
      level_name: level?.name ?? null,
      branch_id: null,
      branch_name: null,
      guardian_name: `Abdelkader ${name.split(' ').slice(-1)[0]}`,
      address: `${12 + index} rue Atlas, Casablanca`,
      notes: null,
      status: 'actif',
      created_at: nowTimestamp(),
      updated_at: nowTimestamp(),
    };
    store.students.push(student);
    return student.id;
  });

  // -- enrollments (half last month, half this month) -----------------------
  DEMO_ENROLLMENT_ROWS.forEach((groups, studentIndex) => {
    groups.forEach((groupIndex, position) => {
      const start = (studentIndex + position) % 2 === 0 ? previousStart : currentStart;
      enrollOne(store, studentIds[studentIndex], groupIds[groupIndex], start);
    });
  });

  // -- invoices: previous + current month ----------------------------------
  const active = store.enrollments.filter((enrollment) => enrollment.status === 'actif');
  for (const enrollment of active) {
    ensureDemoInvoice(store, enrollment, previousMonth, previousYear);
    ensureDemoInvoice(store, enrollment, month, year);
  }

  // -- payments: ~60 % of the current month, previous month left unpaid -----
  const methods = ['espèces', 'virement', 'chèque'];
  const currentInvoices = store.invoices
    .filter((invoice) => invoice.period_month === month && invoice.period_year === year)
    .sort((a, b) => a.id - b.id);
  currentInvoices.forEach((invoice, index) => {
    const enrollment = store.enrollments.find((entry) => entry.id === invoice.enrollment_id);
    if (!enrollment) return;
    const method = methods[index % methods.length];
    const pattern = index % 10;
    if (pattern < 4) {
      devRecordPayment(store, enrollment.student_id, [invoice.id], invoice.amount_cents, method, null);
    } else if (pattern === 4 || pattern === 5) {
      // Half the invoice, in two instalments (the multi-payment case).
      const half = Math.floor(invoice.amount_cents / 2);
      const first = Math.floor(half / 2);
      devRecordPayment(store, enrollment.student_id, [invoice.id], first, method, '1ère tranche');
      devRecordPayment(
        store,
        enrollment.student_id,
        [invoice.id],
        half - first,
        method,
        '2ème tranche',
      );
    }
  });

  // -- activities ----------------------------------------------------------
  const types = ['cours', 'cours', 'rattrapage', 'examen', 'autre'];
  teacherIds.forEach((teacherId, index) => {
    const mode = DEMO_COMPENSATION_ROWS[index][0];
    const entries = 6 + (index % 4);
    for (let entry = 0; entry < entries; entry += 1) {
      const day = 1 + ((entry * 2 + index) % 26);
      store.teacherActivities.push({
        id: store.nextActivityId++,
        teacher_id: teacherId,
        activity_date: `${year}-${pad2(month)}-${pad2(day)}`,
        activity_type: types[(entry + index) % types.length],
        hours: mode === 'per_session' ? null : 1.5,
        sessions: mode === 'per_session' ? 1 : null,
        notes: 'Séance de démonstration',
      });
    }
  });

  // -- settlements: the first teacher paid in full, the second halfway ------
  teacherIds.slice(0, 2).forEach((teacherId, index) => {
    const detail = calculateCompensation(store, teacherId, month, year);
    if (detail.remaining_cents <= 0) return;
    const amount = index === 0 ? detail.remaining_cents : Math.floor(detail.remaining_cents / 2);
    if (amount <= 0) return;
    store.teacherSettlements.push({
      id: store.nextSettlementId++,
      teacher_id: teacherId,
      amount_cents: amount,
      payment_method: 'virement',
      notes: null,
      month,
      year,
      created_at: nowTimestamp(),
    });
  });

  return store;
}

type DevTrashable = { id: number; deleted_at?: string | null };
function trashRows(store: DevStore, type: TrashEntityType): DevTrashable[] {
  switch (type) { case 'student': return store.students; case 'teacher': return store.teachers; case 'group': return store.groups; case 'expense': return store.expenses; default: throw new Error('Type de corbeille invalide'); }
}
function trashHasHistory(store: DevStore, type: TrashEntityType, id: number): boolean {
  const enrolled = store.enrollments.filter(e => type === 'student' ? e.student_id === id : type === 'group' ? e.group_id === id : type === 'teacher' && store.groups.some(g => g.id === e.group_id && g.teacher_id === id));
  if (type === 'student' && store.payments.some(p => p.student_id === id)) return true;
  if (type === 'teacher' && store.teacherSettlements.some(s => s.teacher_id === id)) return true;
  if ((type === 'student' || type === 'group') && store.groups.some(g =>
      (type === 'group' ? g.id === id : enrolled.some(e => e.group_id === g.id)) &&
      store.teacherSettlements.some(s => s.teacher_id === g.teacher_id))) return true;
  if ((type === 'group' || type === 'teacher') && enrolled.some(e => store.payments.some(p => p.student_id === e.student_id))) return true;
  return store.invoices.some(i => enrolled.some(e => e.id === i.enrollment_id));
}
function devTrashList(store: DevStore): TrashItem[] {
  return (['student', 'teacher', 'group', 'expense'] as TrashEntityType[]).flatMap(type => trashRows(store, type).filter(row => row.deleted_at).map(row => {
    const record = row as DevTrashable & { full_name?: string; label?: string; subject_name?: string; level_name?: string };
    const deadline = new Date(`${row.deleted_at!.replace(' ', 'T')}${row.deleted_at!.includes('Z') ? '' : 'Z'}`).getTime() + 30 * 86400000;
    const days = Math.max(0, Math.ceil((deadline - Date.now()) / 86400000));
    const financial = trashHasHistory(store, type, row.id);
    return { entity_type: type, entity_id: row.id, name: record.full_name ?? record.label ?? `${record.subject_name ?? 'Groupe'} — ${record.level_name ?? ''}`, deleted_at: row.deleted_at!, expires_at: new Date(deadline).toISOString(), days_remaining: days, permanent: days === 0 && financial, has_financial_history: financial };
  })).sort((a,b) => b.deleted_at.localeCompare(a.deleted_at));
}
function devRemovePermanent(store: DevStore, type: TrashEntityType, id: number): boolean {
  const rows = trashRows(store, type); const index = rows.findIndex(row => row.id === id && row.deleted_at);
  if (index < 0) throw new Error('Élément introuvable dans la corbeille');
  if (trashHasHistory(store, type, id)) return false;
  if (type === 'student') store.enrollments = store.enrollments.filter(e => e.student_id !== id);
  if (type === 'group') store.enrollments = store.enrollments.filter(e => e.group_id !== id);
  if (type === 'teacher') {
    store.teacherActivities = store.teacherActivities.filter(a => a.teacher_id !== id);
    store.groups.forEach(group => { if (group.teacher_id === id) { group.teacher_id = null; group.teacher_name = null; } });
  }
  rows.splice(index, 1); logAudit(store, 'PURGE', id, null, type); return true;
}

export async function devInvoke(cmd: string, args?: Args): Promise<unknown> {
  await delay();
  const store = load();

  switch (cmd) {
    case 'cmd_check_duplicates': {
      const type = asString(args, 'entityType');
      if (type !== 'student' && type !== 'teacher') throw new Error("Type d'entité invalide");
      const data = (args?.data ?? {}) as Record<string, unknown>;
      const normalizeName = (value: unknown) => typeof value === 'string' ? value.trim().split(/\s+/).join(' ').toLowerCase() : '';
      const normalizePhone = (value: unknown) => {
        const digits = typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
        return digits.length >= 10 ? digits.slice(-10) : null;
      };
      const first = normalizeName(data.first_name), last = normalizeName(data.last_name), phone = normalizePhone(data.phone);
      if ((!first || !last) && !phone) return [];
      const rows: Array<{ id: number; full_name: string; deleted_at?: string | null; phone: string | null; first_name?: string | null; last_name?: string | null; guardian_phone?: string | null }> = type === 'student' ? store.students : store.teachers;
      const result: DuplicateMatch[] = [];
      for (const row of rows) {
        if (row.deleted_at || row.id === data.id) continue;
        const [fallbackFirst = '', ...fallbackLast] = row.full_name.trim().split(/\s+/);
        const nameMatch = Boolean(first && last && normalizeName(row.first_name?.trim() || fallbackFirst) === first && normalizeName(row.last_name?.trim() || fallbackLast.join(' ')) === last);
        const storedPhone = type === 'student' ? row.guardian_phone || row.phone || '' : row.phone || '';
        const phoneMatch = phone !== null && normalizePhone(storedPhone) === phone;
        if (nameMatch || phoneMatch) result.push({ entity_id: row.id, full_name: row.full_name, phone: storedPhone, match_type: nameMatch && phoneMatch ? 'both' : nameMatch ? 'name' : 'phone' });
      }
      const rank = { both: 0, name: 1, phone: 2 };
      return result.sort((a, b) => rank[a.match_type] - rank[b.match_type] || a.entity_id - b.entity_id);
    }
    case 'cmd_delete_to_trash':
    case 'cmd_delete_expense': {
      const type = (cmd === 'cmd_delete_expense' ? 'expense' : asString(args, 'entityType')) as TrashEntityType;
      const id = cmd === 'cmd_delete_expense' ? asNumber(args, 'id') : asNumber(args, 'entityId');
      const row = trashRows(store, type).find(item => item.id === id && !item.deleted_at);
      if (!row) throw new Error('Élément introuvable ou déjà supprimé');
      row.deleted_at = new Date().toISOString(); logAudit(store, 'TRASH', id, null, type); save(store); return undefined;
    }
    case 'cmd_list_trash': return clone(devTrashList(store));
    case 'cmd_restore_from_trash': {
      const type = asString(args, 'entityType') as TrashEntityType, id = asNumber(args, 'entityId');
      const row = trashRows(store, type).find(item => item.id === id && item.deleted_at);
      if (!row) throw new Error('Élément introuvable dans la corbeille');
      row.deleted_at = null; logAudit(store, 'RESTORE', id, null, type); save(store); return undefined;
    }
    case 'cmd_delete_permanently': {
      if (!devRemovePermanent(store, asString(args, 'entityType') as TrashEntityType, asNumber(args, 'entityId'))) throw new Error('Conservé pour historique financier');
      save(store); return undefined;
    }
    case 'cmd_purge_trash':
    case 'cmd_empty_trash': {
      let count = 0;
      for (const item of devTrashList(store)) if ((cmd === 'cmd_empty_trash' || item.days_remaining === 0) && devRemovePermanent(store, item.entity_type, item.entity_id)) count++;
      save(store); return count;
    }
    // -- Settings ---------------------------------------------------------
    case 'cmd_get_all_settings': {
      const { [PROTECTED_KEY]: _hidden, ...visible } = store.settings;
      return clone(visible);
    }

    case 'cmd_get_setting': {
      const key = asString(args, 'key');
      if (key === PROTECTED_KEY) return null;
      return store.settings[key] ?? null;
    }

    case 'cmd_set_setting': {
      const key = asString(args, 'key').trim();
      const value = asString(args, 'value');
      if (!key) throw new Error('Clé de paramètre invalide');
      if (key === PROTECTED_KEY) {
        throw new Error(
          'Le mot de passe ne peut pas être modifié depuis les paramètres généraux',
        );
      }
      store.settings[key] = value;
      if (key === 'center_name') localStorage.setItem(AUTH_CENTER_NAME_KEY, value);
      save(store);
      return undefined;
    }

    // -- School years -----------------------------------------------------
    case 'cmd_get_school_years':
      return clone(
        [...store.schoolYears].sort((a, b) =>
          (b.start_date ?? '').localeCompare(a.start_date ?? ''),
        ),
      );

    case 'cmd_create_school_year': {
      const label = asString(args, 'label').trim();
      const startDate = asString(args, 'startDate');
      const endDate = asString(args, 'endDate');
      if (!label) throw new Error("Le libellé de l'année scolaire est obligatoire");
      validateDateRange(startDate, endDate);
      if (store.schoolYears.some((year) => year.label === label)) {
        throw new Error('Cette année scolaire existe déjà');
      }
      const year: SchoolYear = {
        id: store.nextYearId++,
        label,
        start_date: startDate,
        end_date: endDate,
        is_active: false,
      };
      store.schoolYears.push(year);
      save(store);
      return year.id;
    }

    case 'cmd_set_active_year': {
      const id = asNumber(args, 'id');
      if (!store.schoolYears.some((year) => year.id === id)) {
        throw new Error('Année scolaire introuvable');
      }
      store.schoolYears = store.schoolYears.map((year) => ({
        ...year,
        is_active: year.id === id,
      }));
      save(store);
      return undefined;
    }

    // -- Levels & branches ------------------------------------------------
    case 'cmd_get_levels':
      return clone(
        [...store.levels].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
        ),
      );

    case 'cmd_create_level': {
      const name = asString(args, 'name').trim();
      const category = asString(args, 'category');
      if (!name) throw new Error('Le nom du niveau est obligatoire');
      if (!['primaire', 'college', 'lycee'].includes(category)) {
        throw new Error(`Catégorie invalide : ${category} (attendu : primaire, college, lycee)`);
      }
      const level: Level = {
        id: store.nextLevelId++,
        name,
        sort_order: asNumber(args, 'sortOrder') || 0,
        category,
      };
      store.levels.push(level);
      save(store);
      return level.id;
    }

    case 'cmd_update_level': {
      const id = asNumber(args, 'id');
      const name = asString(args, 'name').trim();
      if (!name) throw new Error('Le nom du niveau est obligatoire');
      const level = store.levels.find((entry) => entry.id === id);
      if (!level) throw new Error('Niveau introuvable');
      level.name = name;
      level.sort_order = asNumber(args, 'sortOrder');
      save(store);
      return undefined;
    }

    case 'cmd_delete_level': {
      const id = asNumber(args, 'id');
      if (!store.levels.some((entry) => entry.id === id)) throw new Error('Niveau introuvable');
      store.levels = store.levels.filter((entry) => entry.id !== id);
      store.branches = store.branches.filter((branch) => branch.level_id !== id);
      save(store);
      return undefined;
    }

    case 'cmd_get_branches': {
      const levelId = args?.levelId;
      const filtered =
        typeof levelId === 'number'
          ? store.branches.filter((branch) => branch.level_id === levelId)
          : store.branches;
      return clone(
        [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
      );
    }

    case 'cmd_create_branch': {
      const name = asString(args, 'name').trim();
      const levelId = asNumber(args, 'levelId');
      if (!name) throw new Error('Le nom de la branche est obligatoire');
      if (!store.levels.some((level) => level.id === levelId)) {
        throw new Error('Niveau introuvable');
      }
      const branch: Branch = { id: store.nextBranchId++, name, level_id: levelId };
      store.branches.push(branch);
      save(store);
      return branch.id;
    }

    case 'cmd_delete_branch': {
      const id = asNumber(args, 'id');
      const before = store.branches.length;
      store.branches = store.branches.filter((branch) => branch.id !== id);
      if (store.branches.length === before) throw new Error('Branche introuvable');
      save(store);
      return undefined;
    }

    // -- Subjects ---------------------------------------------------------
    case 'cmd_get_subjects':
      return clone(
        [...store.subjects].sort((a, b) =>
          a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
        ),
      );

    case 'cmd_create_subject': {
      const name = asString(args, 'name').trim();
      if (!name) throw new Error('Le nom de la matière est obligatoire');
      if (store.subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('Cette matière existe déjà');
      }
      const subject: Subject = { id: store.nextSubjectId++, name, is_active: true };
      store.subjects.push(subject);
      save(store);
      return subject.id;
    }

    case 'cmd_update_subject': {
      const id = asNumber(args, 'id');
      const name = asString(args, 'name').trim();
      const isActive = Boolean(args?.isActive);
      if (!name) throw new Error('Le nom de la matière est obligatoire');
      if (
        store.subjects.some(
          (subject) =>
            subject.id !== id && subject.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error('Cette matière existe déjà');
      }
      const subject = store.subjects.find((entry) => entry.id === id);
      if (!subject) throw new Error('Matière introuvable');
      subject.name = name;
      subject.is_active = isActive;
      save(store);
      return undefined;
    }

    // -- Students ---------------------------------------------------------
    case 'cmd_get_students': {
      const search = asString(args, 'search').trim().toLowerCase();
      const levelId = typeof args?.levelId === 'number' ? args.levelId : null;
      const status = asString(args, 'status').trim();
      const page = Math.max(1, typeof args?.page === 'number' ? args.page : 1);
      const rawLimit = typeof args?.limit === 'number' ? args.limit : 20;
      const limit = rawLimit <= 0 ? 20 : Math.min(rawLimit, 100);

      let rows = store.students.filter(student => !student.deleted_at);
      if (search) {
        rows = rows.filter(
          (student) =>
            student.full_name.toLowerCase().includes(search) ||
            (student.first_name ?? '').toLowerCase().includes(search) ||
            (student.last_name ?? '').toLowerCase().includes(search) ||
            (student.guardian_name ?? '').toLowerCase().includes(search) ||
            (student.guardian_phone ?? student.phone ?? '').includes(normaliseDevPhone(search)) ||
            (student.secondary_contact_phone ?? '').includes(normaliseDevPhone(search)),
        );
      }
      if (levelId !== null) rows = rows.filter((student) => student.level_id === levelId);
      if (status) rows = rows.filter((student) => student.status === status);

      rows.sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
      );

      const total = rows.length;
      const start = (page - 1) * limit;
      const result: PaginatedStudents = {
        data: clone(rows.slice(start, start + limit)),
        total,
        page,
        limit,
      };
      return result;
    }

    case 'cmd_get_student_detail': {
      const id = asNumber(args, 'id');
      const student = store.students.find((entry) => entry.id === id && !entry.deleted_at);
      if (!student) throw new Error('Élève introuvable');
      const history = store.auditLog
        .filter((entry) => entry.entity_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        .slice(0, 50)
        .map(({ id: entryId, action, entity_type, details, created_at }) => ({
          id: entryId,
          action,
          entity_type,
          details,
          created_at,
        }));
      const detail: StudentDetail = {
        student: clone(student),
        enrollments: [],
        invoices: [],
        audit_log: history,
      };
      return detail;
    }

    case 'cmd_create_student': {
      const input = (args?.data ?? {}) as Record<string, unknown>;
      const clean = validateStudentInput(store, input);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const id = store.nextStudentId++;
      store.students.push({
        id,
        ...clean,
        level_name: store.levels.find((level) => level.id === clean.level_id)?.name ?? null,
        branch_name: store.branches.find((branch) => branch.id === clean.branch_id)?.name ?? null,
        created_at: now,
        updated_at: now,
      });
      logAudit(store, 'CREATE', id, JSON.stringify(clean));
      save(store);
      return id;
    }

    case 'cmd_update_student': {
      const id = asNumber(args, 'id');
      const student = store.students.find((entry) => entry.id === id && !entry.deleted_at);
      if (!student) throw new Error('Élève introuvable');
      const input = (args?.data ?? {}) as Record<string, unknown>;
      const clean = validateStudentInput(store, input);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      (Object.keys(clean) as Array<keyof typeof clean>).forEach((key) => {
        const before = (student as unknown as Record<string, unknown>)[key] ?? null;
        const after = clean[key] ?? null;
        if (before !== after) changes[key] = { from: before, to: after };
      });

      Object.assign(student, clean, {
        level_name: store.levels.find((level) => level.id === clean.level_id)?.name ?? null,
        branch_name: store.branches.find((branch) => branch.id === clean.branch_id)?.name ?? null,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });

      if (Object.keys(changes).length > 0) {
        logAudit(store, 'UPDATE', id, JSON.stringify(changes));
      }
      save(store);
      return undefined;
    }

    case 'cmd_set_student_status': {
      const id = asNumber(args, 'id');
      const status = asString(args, 'status').trim();
      if (status !== 'actif' && status !== 'inactif') {
        throw new Error(`Statut invalide : ${status} (attendu : actif, inactif)`);
      }
      const student = store.students.find((entry) => entry.id === id && !entry.deleted_at);
      if (!student) throw new Error('Élève introuvable');
      if (student.status === status) return undefined;
      const from = student.status;
      student.status = status;
      student.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      logAudit(store, 'STATUS_CHANGE', id, JSON.stringify({ from, to: status }));
      save(store);
      return undefined;
    }

    // -- Groups (Phase 4) -------------------------------------------------
    case 'cmd_check_schedule_conflicts': {
      const groupId = args?.groupId == null ? null : asNumber(args, 'groupId');
      const teacherId = args?.teacherId == null ? null : asNumber(args, 'teacherId');
      const yearId = asNumber(args, 'schoolYearId');
      const room = asString(args, 'room').trim().toLowerCase();
      const schedules = Array.isArray(args?.schedules) ? args.schedules as Array<Record<string, unknown>> : [];
      const minutes = (value: unknown): number | null => {
        if (typeof value !== 'string') return null;
        const match = value.trim().match(/^(\d+):(\d+)$/);
        if (!match) return null;
        const h = Number(match[1]), m = Number(match[2]);
        return h <= 23 && m <= 59 ? h * 60 + m : null;
      };
      const conflicts: ScheduleConflict[] = [];
      for (const raw of [...store.groups].sort((a, b) => a.id - b.id)) {
        if (raw.deleted_at || (raw.status ?? 'actif') !== 'actif' || raw.id === groupId || raw.school_year_id !== yearId) continue;
        const group = groupRow(store, raw);
        const slots = group.schedules.length ? group.schedules : (raw.day_of_week && raw.start_time && raw.end_time ? [raw] : []);
        const roomMatch = Boolean(room && room === (raw.room ?? '').trim().toLowerCase());
        const teacherMatch = teacherId !== null && teacherId === raw.teacher_id;
        if (!roomMatch && !teacherMatch) continue;
        const groupName = [group.subject_name, group.level_name].filter(v => v && v !== '—').join(' — ');
        for (const slot of [...slots].sort((a, b) => a.day_of_week.localeCompare(b.day_of_week) || a.start_time.localeCompare(b.start_time))) {
          const start = minutes(slot.start_time), end = minutes(slot.end_time);
          if (start === null || end === null || start >= end) continue;
          for (const input of schedules) {
            const day = typeof input.day === 'string' ? input.day : typeof input.day_of_week === 'string' ? input.day_of_week : '';
            const inputStart = minutes(input.start_time), inputEnd = minutes(input.end_time);
            if (inputStart === null || inputEnd === null || inputStart >= inputEnd || day.trim().toLowerCase() !== slot.day_of_week.trim().toLowerCase() || inputStart >= end || start >= inputEnd) continue;
            for (const type of ['room', 'teacher'] as const) {
              if ((type === 'room' && roomMatch) || (type === 'teacher' && teacherMatch)) {
                conflicts.push({ conflict_type: type, group_name: groupName, day: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time, teacher_name: group.teacher_name ?? '', room: raw.room ?? '' });
              }
            }
          }
        }
      }
      return conflicts;
    }

    case 'cmd_get_groups': {
      const schoolYearId = args?.schoolYearId === null || args?.schoolYearId === undefined
        ? null
        : asNumber(args, 'schoolYearId');
      const status = args?.status === null || args?.status === undefined
        ? null
        : asString(args, 'status').trim();

      const groups = store.groups
        .filter((group) => !group.deleted_at && (schoolYearId === null ? true : group.school_year_id === schoolYearId))
        .filter((group) => (status ? group.status === status : true))
        .map((group) => groupRow(store, group));
      return clone(sortGroups(groups));
    }

    case 'cmd_get_group_detail': {
      const id = asNumber(args, 'id');
      const raw = store.groups.find((group) => group.id === id && !group.deleted_at);
      if (!raw) throw new Error('Groupe introuvable');

      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const students: EnrolledStudent[] = store.enrollments
        .filter((enrollment) => enrollment.group_id === id && enrollment.status === 'actif')
        .map((enrollment) => {
          const student = store.students.find((entry) => entry.id === enrollment.student_id);
          return {
            enrollment_id: enrollment.id,
            student_id: enrollment.student_id,
            student_name: student?.full_name ?? '—',
            student_phone: student?.phone ?? '',
            start_date: enrollment.start_date,
            status: enrollment.status,
          };
        })
        .sort((a, b) => a.student_name.localeCompare(b.student_name));

      const activeEnrollments = students.length;
      const theoretical = activeEnrollments * raw.monthly_fee_cents;
      const activeIds = new Set(students.map((student) => student.enrollment_id));
      const collected = store.invoices
        .filter(
          (invoice) =>
            activeIds.has(invoice.enrollment_id) &&
            invoice.period_month === month &&
            invoice.period_year === year,
        )
        .reduce((sum, invoice) => sum + invoice.paid_amount_cents, 0);

      const financial_summary: FinancialSummary = {
        month,
        year,
        active_enrollments: activeEnrollments,
        monthly_fee_cents: raw.monthly_fee_cents,
        theoretical_total_cents: theoretical,
        collected_total_cents: collected,
      };

      const detail: GroupDetail = {
        group: groupRow(store, raw),
        students,
        financial_summary,
      };
      return clone(detail);
    }

    case 'cmd_create_group': {
      const clean = validateGroupInput(store, (args?.data ?? {}) as Record<string, unknown>);
      const schedules = (clean.schedules ?? []).map((slot) => ({
        ...slot,
        id: store.nextScheduleId++,
      }));
      const group: Group = {
        id: store.nextGroupId++,
        ...clean,
        schedules,
        schedule_text: scheduleText(schedules),
        subject_name: '',
        level_name: '',
        branch_name: null,
        teacher_id: clean.teacher_id ?? null,
        teacher_name: null,
        enrolled_count: 0,
        status: 'actif',
      };
      store.groups.push(group);
      logAudit(store, 'CREATE', group.id, JSON.stringify(clean), 'group');
      save(store);
      return group.id;
    }

    case 'cmd_update_group': {
      const id = asNumber(args, 'id');
      const raw = store.groups.find((group) => group.id === id && !group.deleted_at);
      if (!raw) throw new Error('Groupe introuvable');
      const clean = validateGroupInput(store, (args?.data ?? {}) as Record<string, unknown>);

      const enrolled = enrolledCount(store, id);
      if (clean.capacity < enrolled) {
        throw new Error(
          `La capacité ne peut pas être inférieure au nombre d'élèves déjà inscrits (${enrolled})`,
        );
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      (Object.keys(clean) as Array<keyof GroupInput>).forEach((key) => {
        if (raw[key] !== clean[key]) changes[key] = { from: raw[key], to: clean[key] };
      });

      const schedules = (clean.schedules ?? []).map((slot) => ({
        ...slot,
        id: store.nextScheduleId++,
      }));
      Object.assign(raw, clean, { schedules, schedule_text: scheduleText(schedules) });
      if (Object.keys(changes).length > 0) {
        logAudit(store, 'UPDATE', id, JSON.stringify(changes), 'group');
      }
      save(store);
      return undefined;
    }

    // -- Weekly timetable (Phase 13) ---------------------------------------
    case 'cmd_get_group_schedules': {
      const groupId = asNumber(args, 'groupId');
      const group = store.groups.find((entry) => entry.id === groupId);
      return clone(sortSchedules(group?.schedules));
    }

    case 'cmd_set_group_schedules': {
      const groupId = asNumber(args, 'groupId');
      const raw = store.groups.find((entry) => entry.id === groupId);
      if (!raw) throw new Error('Groupe introuvable');

      const payload = Array.isArray(args?.schedules)
        ? (args?.schedules as Array<Record<string, unknown>>)
        : [];
      const schedules = cleanSchedules(payload).map((slot) => ({
        ...slot,
        id: store.nextScheduleId++,
      }));

      // The legacy columns follow the first slot, exactly like `sync_legacy_columns`.
      raw.schedules = schedules;
      raw.schedule_text = scheduleText(schedules);
      raw.day_of_week = schedules[0].day_of_week;
      raw.start_time = schedules[0].start_time;
      raw.end_time = schedules[0].end_time;
      save(store);
      return clone(schedules);
    }

    case 'cmd_get_timetable': {
      const filters = (args?.filters ?? {}) as Record<string, unknown>;
      const optionalNumber = (key: string): number | null => {
        const value = filters[key];
        return value === null || value === undefined || value === '' ? null : Number(value);
      };
      const levelId = optionalNumber('level_id');
      const subjectId = optionalNumber('subject_id');
      const teacherId = optionalNumber('teacher_id');
      const room = typeof filters.room === 'string' && filters.room.trim() ? filters.room.trim() : null;

      const entries: TimetableEntry[] = [];
      store.groups
        .filter((group) => !group.deleted_at && (group.status ?? 'actif') === 'actif')
        .filter((group) => (levelId === null ? true : group.level_id === levelId))
        .filter((group) => (subjectId === null ? true : group.subject_id === subjectId))
        .filter((group) => (teacherId === null ? true : group.teacher_id === teacherId))
        .filter((group) => (room === null ? true : group.room === room))
        .forEach((group) => {
          const row = groupRow(store, group);
          row.schedules.forEach((slot) => {
            entries.push({
              group_id: row.id,
              subject_name: row.subject_name,
              level_name: row.level_name,
              branch_name: row.branch_name,
              teacher_name: row.teacher_name,
              room: row.room,
              day_of_week: slot.day_of_week,
              start_time: slot.start_time,
              end_time: slot.end_time,
              enrolled_count: row.enrolled_count,
              capacity: row.capacity,
              monthly_fee_cents: row.monthly_fee_cents,
            });
          });
        });

      entries.sort(
        (a, b) =>
          DAY_NAMES.indexOf(a.day_of_week) - DAY_NAMES.indexOf(b.day_of_week) ||
          a.start_time.localeCompare(b.start_time) ||
          a.group_id - b.group_id,
      );
      return clone(entries);
    }

    case 'cmd_get_timetable_rooms': {
      const rooms = Array.from(
        new Set(
          store.groups
            .filter((group) => !group.deleted_at && (group.status ?? 'actif') === 'actif')
            .map((group) => (group.room ?? '').trim())
            .filter(Boolean),
        ),
      );
      rooms.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
      return clone(rooms);
    }

    case 'cmd_get_teacher_options':
      return clone(
        [...store.teachers]
          .filter((teacher) => !teacher.deleted_at && teacher.status === 'actif')
          .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'))
          .map((teacher) => ({ id: teacher.id, full_name: teacher.full_name })),
      );

    // -- Teachers (Phase 6) ------------------------------------------------
    case 'cmd_get_teachers': {
      const status = args?.status === null || args?.status === undefined
        ? null
        : asString(args, 'status').trim();
      if (status && status !== 'actif' && status !== 'inactif') {
        throw new Error('Statut invalide (actif ou inactif)');
      }
      return clone(
        store.teachers
          .filter((teacher) => !teacher.deleted_at && (status ? teacher.status === status : true))
          .map((teacher) => teacherRow(store, teacher))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr')),
      );
    }

    case 'cmd_create_teacher': {
      const clean = normalizeTeacherInput(store, args?.data);
      const stamp = nowTimestamp();
      const id = store.nextTeacherId++;
      store.teachers.push({
        id,
        ...clean,
        status: 'actif',
        compensation_mode: null,
        compensation_value_cents: null,
        bonus_pct: null,
        created_at: stamp,
        updated_at: stamp,
      });
      logAudit(
        store,
        'CREATE',
        id,
        JSON.stringify({
          full_name: clean.full_name,
          phone: clean.phone,
          email: clean.email,
          notes: clean.notes,
          subject_ids: clean.subject_ids,
        }),
        'teacher',
      );
      save(store);
      return id;
    }

    case 'cmd_update_teacher': {
      const id = asNumber(args, 'id');
      const teacher = findTeacher(store, id);
      const clean = normalizeTeacherInput(store, args?.data);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const diff = (field: string, from: unknown, to: unknown) => {
        if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
      };
      diff('full_name', teacher.full_name, clean.full_name);
      diff('phone', teacher.phone, clean.phone);
      diff('email', teacher.email, clean.email);
      diff('notes', teacher.notes, clean.notes);
      diff('subject_ids', [...teacher.subject_ids].sort((a, b) => a - b), clean.subject_ids);

      Object.assign(teacher, clean, { updated_at: nowTimestamp() });
      if (Object.keys(changes).length > 0) {
        logAudit(store, 'UPDATE', id, JSON.stringify(changes), 'teacher');
      }
      save(store);
      return undefined;
    }

    case 'cmd_get_teacher_detail':
      return clone(teacherDetail(store, asNumber(args, 'id')));

    case 'cmd_set_teacher_status': {
      const id = asNumber(args, 'id');
      const status = asString(args, 'status').trim();
      if (status !== 'actif' && status !== 'inactif') {
        throw new Error('Statut invalide (actif ou inactif)');
      }
      const teacher = findTeacher(store, id);
      if (teacher.status !== status) {
        logAudit(
          store,
          'STATUS_CHANGE',
          id,
          JSON.stringify({ from: teacher.status, to: status }),
          'teacher',
        );
        teacher.status = status;
        teacher.updated_at = nowTimestamp();
      }
      save(store);
      return undefined;
    }

    // -- Compensation & settlements (Phase 6) ------------------------------
    case 'cmd_set_compensation': {
      const teacherId = asNumber(args, 'teacherId');
      const mode = asString(args, 'mode').trim();
      const valueCents = asNumber(args, 'valueCents');
      const rawBonus = args?.bonusPct;
      const bonusPct = typeof rawBonus === 'number' ? rawBonus : null;

      if (!TEACHER_MODES.includes(mode as (typeof TEACHER_MODES)[number])) {
        throw new Error(
          'Mode de compensation invalide (fixed_monthly, hourly, per_session, percentage)',
        );
      }
      if (!(valueCents > 0)) {
        throw new Error('La valeur de la compensation doit être supérieure à 0');
      }
      if (mode === 'percentage' && valueCents > 10_000) {
        throw new Error('Le pourcentage doit être compris entre 0 et 100');
      }
      if (bonusPct !== null && (Number.isNaN(bonusPct) || bonusPct < 0 || bonusPct > 100)) {
        throw new Error('Le pourcentage de bonus doit être compris entre 0 et 100');
      }

      const teacher = findTeacher(store, teacherId);
      const previous = {
        mode: teacher.compensation_mode,
        value_cents: teacher.compensation_value_cents,
        bonus_pct: teacher.bonus_pct,
      };
      const bonus = bonusPct !== null && bonusPct > 0 ? bonusPct : null;

      teacher.compensation_mode = mode;
      teacher.compensation_value_cents = valueCents;
      teacher.bonus_pct = bonus;
      teacher.updated_at = nowTimestamp();

      logAudit(
        store,
        'SET_COMPENSATION',
        teacherId,
        JSON.stringify({
          from: previous,
          to: { mode, value_cents: valueCents, bonus_pct: bonus },
        }),
        'teacher',
      );
      save(store);
      return undefined;
    }

    case 'cmd_calculate_compensation':
      return clone(
        calculateCompensation(store, asNumber(args, 'teacherId'), asNumber(args, 'month'), asNumber(args, 'year')),
      );

    case 'cmd_record_settlement': {
      const teacherId = asNumber(args, 'teacherId');
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      const amountCents = asNumber(args, 'amountCents');
      const method = asString(args, 'method').trim();
      const notes = typeof args?.notes === 'string' && args.notes.trim() ? args.notes.trim() : null;

      validatePeriod(month, year);
      if (!(amountCents > 0)) throw new Error('Le montant doit être supérieur à 0');
      if (!method) throw new Error('Le mode de paiement est obligatoire');

      const detail = calculateCompensation(store, teacherId, month, year);
      const id = store.nextSettlementId++;
      store.teacherSettlements.push({
        id,
        teacher_id: teacherId,
        amount_cents: amountCents,
        payment_method: method,
        notes,
        month,
        year,
        created_at: nowTimestamp(),
      });

      const settled = settledTotal(store, teacherId, month, year);
      logAudit(
        store,
        'SETTLEMENT',
        teacherId,
        JSON.stringify({
          settlement_id: id,
          month,
          year,
          amount_cents: amountCents,
          method,
          total_cents: detail.total_cents,
          settled_cents: settled,
          status: compensationStatus(detail.total_cents, settled),
        }),
        'teacher',
      );
      save(store);
      return id;
    }

    case 'cmd_get_teacher_settlements': {
      const teacherId = asNumber(args, 'teacherId');
      const month = args?.month === null || args?.month === undefined ? null : asNumber(args, 'month');
      const year = args?.year === null || args?.year === undefined ? null : asNumber(args, 'year');
      findTeacher(store, teacherId);
      return clone(
        store.teacherSettlements
          .filter(
            (row) =>
              row.teacher_id === teacherId &&
              (month === null || row.month === month) &&
              (year === null || row.year === year),
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
          .map<Settlement>((row) => ({
            id: row.id,
            amount_cents: row.amount_cents,
            payment_method: row.payment_method,
            notes: row.notes,
            created_at: row.created_at,
          })),
      );
    }

    case 'cmd_get_all_teacher_compensation_summary': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      validatePeriod(month, year);

      const summaries: TeacherCompSummary[] = store.teachers
        .filter((teacher) => !teacher.deleted_at && teacher.status === 'actif')
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'))
        .map((teacher) => {
          if (!compensationConfig(teacher)) {
            return {
              teacher_id: teacher.id,
              teacher_name: teacher.full_name,
              mode: '',
              total_due_cents: 0,
              total_settled_cents: 0,
              remaining_cents: 0,
              status: 'not_configured' as TeacherCompSummary['status'],
            };
          }
          const detail = calculateCompensation(store, teacher.id, month, year);
          const settled = settledTotal(store, teacher.id, month, year);
          return {
            teacher_id: teacher.id,
            teacher_name: teacher.full_name,
            mode: detail.mode,
            total_due_cents: detail.total_cents,
            total_settled_cents: settled,
            remaining_cents: detail.total_cents - settled,
            status: compensationStatus(detail.total_cents, settled) as TeacherCompSummary['status'],
          };
        });
      return clone(summaries);
    }

    // -- Activities (Phase 6) ---------------------------------------------
    case 'cmd_record_activity': {
      const teacherId = asNumber(args, 'teacherId');
      const activityDate = asString(args, 'activityDate').trim();
      const activityType = asString(args, 'activityType').trim();
      const rawHours = args?.hours;
      const rawSessions = args?.sessions;
      const hours = typeof rawHours === 'number' && rawHours > 0 ? rawHours : null;
      const sessions = typeof rawSessions === 'number' && rawSessions > 0 ? rawSessions : null;
      const notes = typeof args?.notes === 'string' && args.notes.trim() ? args.notes.trim() : null;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
        throw new Error('Date invalide (format attendu AAAA-MM-JJ)');
      }
      if (!['cours', 'rattrapage', 'examen', 'autre'].includes(activityType)) {
        throw new Error("Type d'activité invalide (cours, rattrapage, examen, autre)");
      }
      if (hours === null && sessions === null) {
        throw new Error('Indiquez au moins des heures ou des séances');
      }
      findTeacher(store, teacherId);

      const id = store.nextActivityId++;
      store.teacherActivities.push({
        id,
        teacher_id: teacherId,
        activity_date: activityDate,
        activity_type: activityType,
        hours,
        sessions,
        notes,
      });
      logAudit(
        store,
        'ACTIVITY',
        teacherId,
        JSON.stringify({
          activity_id: id,
          activity_date: activityDate,
          activity_type: activityType,
          hours,
          sessions,
        }),
        'teacher',
      );
      save(store);
      return id;
    }

    case 'cmd_get_activities': {
      const teacherId = asNumber(args, 'teacherId');
      const month = args?.month === null || args?.month === undefined ? null : asNumber(args, 'month');
      const year = args?.year === null || args?.year === undefined ? null : asNumber(args, 'year');
      if (month !== null || year !== null) validatePeriod(month ?? 1, year ?? 2000);
      const prefix = month !== null && year !== null ? periodPrefix(month, year) : null;
      return clone(
        store.teacherActivities
          .filter(
            (row) =>
              row.teacher_id === teacherId &&
              (prefix === null || row.activity_date.startsWith(prefix)),
          )
          .sort((a, b) => b.activity_date.localeCompare(a.activity_date) || b.id - a.id)
          .map<Activity>((row) => ({
            id: row.id,
            activity_date: row.activity_date,
            activity_type: row.activity_type as Activity['activity_type'],
            hours: row.hours,
            sessions: row.sessions,
            notes: row.notes,
          })),
      );
    }

    // -- Enrollments (Phase 4) --------------------------------------------
    case 'cmd_enroll_student': {
      const studentId = asNumber(args, 'studentId');
      const groupId = asNumber(args, 'groupId');
      const startDate = asString(args, 'startDate');
      const id = enrollOne(store, studentId, groupId, startDate);
      save(store);
      return id;
    }

    case 'cmd_enroll_student_batch': {
      const items = (args?.enrollments ?? []) as EnrollmentInput[];
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Aucune inscription sélectionnée');
      }
      // Atomic: restore the store snapshot if any item fails.
      const snapshot = JSON.stringify(store);
      try {
        return items.map((item) => enrollOne(store, item.student_id, item.group_id, item.start_date));
      } catch (error) {
        Object.assign(store, JSON.parse(snapshot) as DevStore);
        throw error;
      } finally {
        save(store);
      }
    }

    case 'cmd_end_enrollment': {
      const enrollmentId = asNumber(args, 'enrollmentId');
      const enrollment = store.enrollments.find((entry) => entry.id === enrollmentId);
      if (!enrollment) throw new Error('Inscription introuvable');
      if (enrollment.status !== 'actif') throw new Error('Cette inscription est déjà terminée');
      enrollment.status = 'terminé';
      enrollment.end_date = new Date().toISOString().slice(0, 10);
      logAudit(
        store,
        'END_ENROLLMENT',
        enrollmentId,
        JSON.stringify({
          start_date: enrollment.start_date,
          end_date: enrollment.end_date,
          current_month_kept: true,
        }),
        'enrollment',
      );
      save(store);
      return undefined;
    }

    case 'cmd_get_student_enrollments': {
      const studentId = asNumber(args, 'studentId');
      const rows: StudentEnrollment[] = store.enrollments
        .filter((enrollment) => enrollment.student_id === studentId)
        .map((enrollment) => {
          const raw = store.groups.find((group) => group.id === enrollment.group_id);
          return {
            enrollment_id: enrollment.id,
            group_id: enrollment.group_id,
            subject_name: raw?.subject_name ?? '—',
            level_name: raw?.level_name ?? '—',
            branch_name: raw?.branch_name ?? null,
            teacher_name: raw?.teacher_name ?? null,
            day_of_week: raw?.day_of_week ?? '',
            start_time: raw?.start_time ?? '',
            end_time: raw?.end_time ?? '',
            monthly_fee_cents: raw?.monthly_fee_cents ?? 0,
            start_date: enrollment.start_date,
            end_date: enrollment.end_date,
            status: enrollment.status,
          };
        })
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.enrollment_id - a.enrollment_id);
      return clone(rows);
    }

    case 'cmd_get_available_groups_for_student': {
      const studentId = asNumber(args, 'studentId');
      const levelId = args?.levelId === null || args?.levelId === undefined
        ? null
        : asNumber(args, 'levelId');
      const activeGroupIds = new Set(
        store.enrollments
          .filter((enrollment) => enrollment.student_id === studentId && enrollment.status === 'actif')
          .map((enrollment) => enrollment.group_id),
      );
      const groups = store.groups
        .filter((group) => !group.deleted_at && group.status === 'actif' && !activeGroupIds.has(group.id))
        .filter((group) => (levelId === null ? true : group.level_id === levelId))
        .map((group) => groupRow(store, group));
      return clone(sortGroups(groups));
    }

    // -- Invoicing (Phase 5) ----------------------------------------------
    case 'cmd_generate_monthly_invoices': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mois invalide');
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Année invalide');

      let created = 0;
      for (const enrollment of store.enrollments.filter((entry) => entry.status === 'actif' && store.students.some(s => s.id === entry.student_id && !s.deleted_at) && store.groups.some(g => g.id === entry.group_id && !g.deleted_at))) {
        const exists = store.invoices.some(
          (invoice) =>
            invoice.enrollment_id === enrollment.id &&
            invoice.period_month === month &&
            invoice.period_year === year,
        );
        if (exists) continue;
        const group = store.groups.find((entry) => entry.id === enrollment.group_id);
        if (!group) continue;
        const day = Number(enrollment.start_date.split('-')[2]) || 1;
        store.invoices.push({
          id: store.nextInvoiceId++,
          enrollment_id: enrollment.id,
          period_month: month,
          period_year: year,
          amount_cents: group.monthly_fee_cents,
          paid_amount_cents: 0,
          status: 'impayé',
          due_date: adjustDueDate(year, month, day),
          created_at: nowTimestamp(),
        });
        created += 1;
      }

      logAudit(
        store,
        'GENERATE_INVOICES',
        0,
        JSON.stringify({ month, year, count: created }),
        'enrollment',
      );
      save(store);
      return created;
    }

    case 'cmd_get_student_invoices': {
      const studentId = asNumber(args, 'studentId');
      return clone(devInvoiceRows(store, studentId));
    }

    case 'cmd_get_late_payment_count': {
      const today = new Date().toISOString().slice(0, 10);
      return store.invoices.filter(
        (invoice) =>
          store.enrollments.some(e => e.id === invoice.enrollment_id && store.students.some(s => s.id === e.student_id && !s.deleted_at) && store.groups.some(g => g.id === e.group_id && !g.deleted_at)) &&
          invoice.status !== 'payé' &&
          invoice.paid_amount_cents < invoice.amount_cents &&
          Boolean(invoice.due_date) &&
          invoice.due_date < today,
      ).length;
    }

    case 'cmd_get_payment_alerts': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      return clone(devAlerts(store, month, year));
    }

    // -- Payments & receipts (Phase 5) -------------------------------------
    case 'cmd_record_payment': {
      const studentId = asNumber(args, 'studentId');
      const invoiceIds = (args?.invoiceIds ?? []) as number[];
      const amountCents = asNumber(args, 'amountCents');
      const method = asString(args, 'method');
      const notes = typeof args?.notes === 'string' ? args.notes : null;
      const snapshot = JSON.stringify(store);
      try {
        return devRecordPayment(store, studentId, invoiceIds, amountCents, method, notes);
      } catch (error) {
        Object.assign(store, JSON.parse(snapshot) as DevStore);
        throw error;
      } finally {
        save(store);
      }
    }

    case 'cmd_get_payments_history': {
      const studentId = args?.studentId === null || args?.studentId === undefined
        ? null
        : asNumber(args, 'studentId');
      const month = args?.month === null || args?.month === undefined ? null : asNumber(args, 'month');
      const year = args?.year === null || args?.year === undefined ? null : asNumber(args, 'year');
      const page = args?.page === undefined ? 1 : asNumber(args, 'page');
      const limit = args?.limit === undefined ? 20 : asNumber(args, 'limit');
      return clone(devPaymentsHistory(store, studentId, month, year, page, limit));
    }

    case 'cmd_create_receipt': {
      const paymentId = asNumber(args, 'paymentId');
      const id = devCreateReceipt(store, paymentId);
      save(store);
      return id;
    }

    case 'cmd_get_receipt_data': {
      const receiptId = asNumber(args, 'receiptId');
      return clone(devReceiptData(store, receiptId));
    }

    // -- Dashboard (Phase 7) ------------------------------------------------
    case 'cmd_get_dashboard_kpis': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      if (!(month >= 1 && month <= 12)) throw new Error('Mois invalide (1 à 12)');
      return clone(devDashboardKpis(store, month, year));
    }

    case 'cmd_get_dashboard_alerts':
      return clone(devDashboardAlerts(store));

    case 'cmd_get_recent_payments': {
      const limit = args?.limit === undefined ? 10 : asNumber(args, 'limit');
      return clone(devRecentPayments(store, limit));
    }

    // -- Monthly expenses (Phase 11) --------------------------------------
    case 'cmd_get_expenses': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      validatePeriod(month, year);
      const rawCategory = args?.category;
      const category =
        typeof rawCategory === 'string' && rawCategory.trim() ? rawCategory.trim() : null;

      const rows = (store.expenses ?? [])
        .filter((row) => !row.deleted_at && row.month === month && row.year === year)
        .filter((row) => (category ? row.category === category : true))
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category, 'fr', { sensitivity: 'base' }) ||
            a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }) ||
            a.id - b.id,
        )
        .map((row) => devExpenseRow(store, row));
      return clone(rows);
    }

    case 'cmd_get_expenses_summary': {
      const month = asNumber(args, 'month');
      const year = asNumber(args, 'year');
      validatePeriod(month, year);

      const rows = (store.expenses ?? []).filter(
        (row) => !row.deleted_at && row.month === month && row.year === year,
      );
      const totalsByCategory = new Map<string, CategoryTotal>();
      for (const row of rows) {
        const line = totalsByCategory.get(row.category) ?? {
          category: row.category,
          total_cents: 0,
          count: 0,
        };
        line.total_cents += row.amount_cents;
        line.count += 1;
        totalsByCategory.set(row.category, line);
      }
      const by_category = [...totalsByCategory.values()].sort(
        (a, b) =>
          b.total_cents - a.total_cents ||
          a.category.localeCompare(b.category, 'fr', { sensitivity: 'base' }),
      );
      const summary: ExpensesSummary = {
        total_cents: by_category.reduce((sum, line) => sum + line.total_cents, 0),
        by_category,
        count: by_category.reduce((sum, line) => sum + line.count, 0),
      };
      return clone(summary);
    }

    case 'cmd_create_expense': {
      const input = validateExpenseInput(args?.data);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const id = store.nextExpenseId++;
      store.expenses ??= [];
      store.expenses.push({
        id,
        ...input,
        created_at: now,
      });
      logAudit(store, 'CREATE', id, JSON.stringify(input), 'expense');
      save(store);
      return id;
    }

    case 'cmd_update_expense': {
      const id = asNumber(args, 'id');
      const input = validateExpenseInput(args?.data);
      const row = (store.expenses ?? []).find((entry) => entry.id === id);
      if (!row) throw new Error('Dépense introuvable');

      const before = {
        label: row.label,
        amount_cents: row.amount_cents,
        category: row.category,
        month: row.month,
        year: row.year,
        notes: row.notes,
      };
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      (Object.keys(input) as Array<keyof typeof input>).forEach((key) => {
        if (before[key] !== input[key]) diff[key] = { from: before[key], to: input[key] };
      });
      Object.assign(row, input);
      if (Object.keys(diff).length > 0) {
        logAudit(store, 'UPDATE', id, JSON.stringify(diff), 'expense');
      }
      save(store);
      return undefined;
    }

    case 'cmd_get_expense_categories':
      return clone(devExpenseCategories(store));

    case 'cmd_set_expense_categories': {
      const raw = args?.categories;
      if (!Array.isArray(raw)) throw new Error('Liste de catégories invalide');
      const cleaned: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string') throw new Error('Une catégorie ne peut pas être vide');
        const name = entry.trim();
        if (!name) throw new Error('Une catégorie ne peut pas être vide');
        if (!cleaned.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
          cleaned.push(name);
        }
      }
      if (cleaned.length === 0) throw new Error('Au moins une catégorie est obligatoire');
      store.settings.expense_categories = JSON.stringify(cleaned);
      save(store);
      return undefined;
    }

    // -- Backup -----------------------------------------------------------
    case 'cmd_backup_db': {
      const dest = asString(args, 'destPath').trim();
      if (!dest) throw new Error('Chemin de destination invalide');
      return undefined;
    }

    case 'cmd_seed_demo_data': {
      const demo = buildDemoStore(store);
      save(demo);
      const invoiceCount = demo.invoices.length;
      const paymentCount = demo.payments.length;
      // Same template as the Rust command (see demo.rs): the specification's
      // exact English sentence; the toast prefix is localised by the UI.
      return `Demo data: ${demo.students.length} students, ${
        demo.teachers.length
      } teachers, ${demo.groups.length} groups, ${invoiceCount} invoices, ${paymentCount} payments`;
    }

    case 'cmd_get_db_info': {
      const info: DbInfo = {
        path: 'C:\\Users\\demo\\AppData\\Roaming\\com.centremanager.app\\centremanager.db',
        size_bytes: 2411724,
        last_backup: store.settings.last_backup_date ?? null,
      };
      return info;
    }

    default:
      throw new Error(`Commande inconnue (mode navigateur) : ${cmd}`);
  }
}

/** True when the development store should be used instead of Tauri IPC. */
export function isDevSettingsBackend(): boolean {
  return import.meta.env.DEV;
}

export default devInvoke;
