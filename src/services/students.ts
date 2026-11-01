import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { PaginatedStudents, StudentDetail, StudentInput } from '../types';

/**
 * Typed wrappers for the student commands
 * (`src-tauri/src/commands/students.rs`).
 *
 * In a browser (`npm run dev`, no Tauri IPC) the calls are served by the
 * development store in `settingsDevBackend.ts`; inside the desktop app every
 * call goes to Rust.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export interface StudentFilters {
  search?: string;
  levelId?: number | null;
  status?: string | null;
  page?: number;
  limit?: number;
}

export const studentsApi = {
  list: (filters: StudentFilters = {}) =>
    call<PaginatedStudents>('cmd_get_students', {
      search: filters.search?.trim() ? filters.search.trim() : null,
      levelId: filters.levelId ?? null,
      status: filters.status ?? null,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    }),

  detail: (id: number) => call<StudentDetail>('cmd_get_student_detail', { id }),

  create: (data: StudentInput) => call<number>('cmd_create_student', { data }),

  update: (id: number, data: StudentInput) => call<void>('cmd_update_student', { id, data }),

  setStatus: (id: number, status: 'actif' | 'inactif') =>
    call<void>('cmd_set_student_status', { id, status }),
};

/** Moroccan mobile numbers: 10 digits starting with 06 or 07. */
export const PHONE_PATTERN = /^0[67]\d{8}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

export default studentsApi;
