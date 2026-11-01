import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type {
  Activity,
  ActivityInput,
  CompensationDetail,
  CompensationMode,
  Settlement,
  Teacher,
  TeacherCompSummary,
  TeacherDetail,
  TeacherInput,
} from '../types';

/**
 * Typed wrappers for the Phase 6 commands (`commands/teachers.rs`,
 * `compensation.rs`, `activities.rs`).
 *
 * Teachers and settlements are never deleted: there is deliberately no
 * `remove` in this API.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

/** Moroccan phone: 10 digits starting 05/06/07, or `+2125…`/`+2126…`/`+2127…`. */
export function isValidTeacherPhone(phone: string): boolean {
  const digits = phone.replace(/[^0-9+]/g, '');
  return /^\+212[5-7]\d{8}$/.test(digits) || /^0[5-7]\d{8}$/.test(digits);
}

export const teachersApi = {
  list: (status: string | null = null) => call<Teacher[]>('cmd_get_teachers', { status }),

  detail: (id: number) => call<TeacherDetail>('cmd_get_teacher_detail', { id }),

  create: (data: TeacherInput) => call<number>('cmd_create_teacher', { data }),

  update: (id: number, data: TeacherInput) => call<void>('cmd_update_teacher', { id, data }),

  setStatus: (id: number, status: 'actif' | 'inactif') =>
    call<void>('cmd_set_teacher_status', { id, status }),
};

export const compensationApi = {
  /** `valueCents` is a percentage × 100 for the `percentage` mode. */
  set: (input: {
    teacherId: number;
    mode: CompensationMode;
    valueCents: number;
    bonusPct: number | null;
  }) =>
    call<void>('cmd_set_compensation', {
      teacherId: input.teacherId,
      mode: input.mode,
      valueCents: input.valueCents,
      bonusPct: input.bonusPct,
    }),

  calculate: (teacherId: number, month: number, year: number) =>
    call<CompensationDetail>('cmd_calculate_compensation', { teacherId, month, year }),

  recordSettlement: (input: {
    teacherId: number;
    month: number;
    year: number;
    amountCents: number;
    method: string;
    notes?: string | null;
  }) =>
    call<number>('cmd_record_settlement', {
      teacherId: input.teacherId,
      month: input.month,
      year: input.year,
      amountCents: input.amountCents,
      method: input.method,
      notes: input.notes ?? null,
    }),

  settlements: (teacherId: number, month: number | null, year: number | null) =>
    call<Settlement[]>('cmd_get_teacher_settlements', { teacherId, month, year }),

  summary: (month: number, year: number) =>
    call<TeacherCompSummary[]>('cmd_get_all_teacher_compensation_summary', { month, year }),
};

export const activitiesApi = {
  list: (teacherId: number, month: number | null, year: number | null) =>
    call<Activity[]>('cmd_get_activities', { teacherId, month, year }),

  record: (input: ActivityInput) =>
    call<number>('cmd_record_activity', {
      teacherId: input.teacher_id,
      activityDate: input.activity_date,
      activityType: input.activity_type,
      hours: input.hours,
      sessions: input.sessions,
      notes: input.notes,
    }),
};

/** Badge tone of a payroll status. */
export function compensationStatusVariant(
  status: string,
): 'success' | 'warning' | 'destructive' | 'muted' {
  switch (status) {
    case 'settled':
      return 'success';
    case 'partial':
      return 'warning';
    case 'pending':
      return 'destructive';
    default:
      return 'muted';
  }
}

/** i18n key of a payroll status label. */
export function compensationStatusKey(status: string): string {
  switch (status) {
    case 'settled':
      return 'teachers.status.settled';
    case 'partial':
      return 'teachers.status.partial';
    case 'pending':
      return 'teachers.status.pending';
    default:
      return 'teachers.status.notConfigured';
  }
}

/** i18n key of a compensation mode label. */
export function modeKey(mode: string | null | undefined): string {
  switch (mode) {
    case 'fixed_monthly':
      return 'teachers.fixed';
    case 'hourly':
      return 'teachers.hourly';
    case 'per_session':
      return 'teachers.perSession';
    case 'percentage':
      return 'teachers.percentage';
    default:
      return 'teachers.notConfigured';
  }
}

export default teachersApi;
