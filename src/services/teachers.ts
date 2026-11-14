import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type {
  Teacher,
  TeacherDetail,
  TeacherInput,
  TeacherPayment,
} from '../types';

/**
 * Typed wrappers for the Phase 6 commands (`commands/teachers.rs`,
 * `teacher_payments.rs`).
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

export const teacherPaymentsApi = {
  list: (teacherId: number) => call<TeacherPayment[]>('cmd_list_teacher_payments', { teacherId }),
  unattributed: (teacherId: number) => call<TeacherPayment[]>('cmd_list_unattributed_teacher_payments', { teacherId }),
  create: (input: { teacherId: number; amountCents: number; paymentDate: string; method: string; notes: string | null }) =>
    call<number>('cmd_create_teacher_payment', input),
};

export default teachersApi;
