import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { EnrollmentInput, Group, StudentEnrollment } from '../types';

/**
 * Typed wrappers for the enrollment commands
 * (`src-tauri/src/commands/enrollments.rs`).
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export interface EnrollmentResult { id: number; enrollment_fee_invoice_id: number | null; enrollment_fee_amount_cents: number | null }

export const enrollmentsApi = {
  /** One transaction for the whole list — a single failure rolls it all back. */
  enrollBatch: (enrollments: EnrollmentInput[]) =>
    call<EnrollmentResult[]>('cmd_enroll_student_batch', { enrollments }),

  end: (enrollmentId: number) => call<void>('cmd_end_enrollment', { enrollmentId }),

  forStudent: (studentId: number) =>
    call<StudentEnrollment[]>('cmd_get_student_enrollments', { studentId }),

  availableForStudent: (studentId: number, levelId: number | null = null) =>
    call<Group[]>('cmd_get_available_groups_for_student', { studentId, levelId }),
};

/** `YYYY-MM-DD` for today, in the user's timezone. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default enrollmentsApi;
