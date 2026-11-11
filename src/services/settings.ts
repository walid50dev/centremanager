import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { Branch, CentreInfo, DbInfo, Level, SchoolYear, Subject } from '../types';

/**
 * Typed wrappers for the settings / reference-data commands
 * (`src-tauri/src/commands/{settings,school_years,levels,subjects,backup}.rs`).
 *
 * In a browser (`npm run dev`, no Tauri IPC) the calls are served by the
 * development store in `settingsDevBackend.ts`. Inside the desktop app every
 * call goes to Rust.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export const settingsApi = {
  resetOperationalData: () => call<void>('cmd_reset_operational_data'),
  getEnrollmentFee: () => call<number>('cmd_get_enrollment_fee'),
  setEnrollmentFee: (amount: number, yearId: number) => call<void>('cmd_set_enrollment_fee', { amount, yearId }),
  getCentreInfo: () => call<CentreInfo>('cmd_get_centre_info'),
  setCentreInfo: (name: string, logo: string | null) => call<void>('cmd_set_centre_info', { name, logo }),
  /** All settings except the password hash. */
  getAll: () => call<Record<string, string>>('cmd_get_all_settings'),
  get: (key: string) => call<string | null>('cmd_get_setting', { key }),
  set: (key: string, value: string) => call<void>('cmd_set_setting', { key, value }),
};

export const schoolYearsApi = {
  list: () => call<SchoolYear[]>('cmd_get_school_years'),
  create: (label: string, startDate: string, endDate: string) =>
    call<number>('cmd_create_school_year', { label, startDate, endDate }),
  setActive: (id: number) => call<void>('cmd_set_active_year', { id }),
  active: () => call<SchoolYear | null>('cmd_get_active_school_year'),
  remove: (yearId: number) => call<void>('cmd_delete_school_year', { yearId }),
  switch: (yearId: number) => call<void>('cmd_switch_school_year', { yearId }),
};

export const levelsApi = {
  list: () => call<Level[]>('cmd_get_levels'),
  create: (name: string, category: string, sortOrder: number) =>
    call<number>('cmd_create_level', { name, category, sortOrder }),
  update: (id: number, name: string, sortOrder: number) =>
    call<void>('cmd_update_level', { id, name, sortOrder }),
  remove: (id: number) => call<void>('cmd_delete_level', { id }),
  branches: (levelId?: number | null) =>
    call<Branch[]>('cmd_get_branches', { levelId: levelId ?? null }),
  createBranch: (name: string, levelId: number) =>
    call<number>('cmd_create_branch', { name, levelId }),
  removeBranch: (id: number) => call<void>('cmd_delete_branch', { id }),
};

export const subjectsApi = {
  list: () => call<Subject[]>('cmd_get_subjects'),
  create: (name: string) => call<number>('cmd_create_subject', { name }),
  update: (id: number, name: string, isActive: boolean) =>
    call<void>('cmd_update_subject', { id, name, isActive }),
};

export const backupApi = {
  backup: (destPath: string) => call<void>('cmd_backup_db', { destPath }),
  info: () => call<DbInfo>('cmd_get_db_info'),
};

/** True when the browser development store is serving these calls. */
export const usingDevSettingsBackend = USE_DEV_BACKEND;

export default settingsApi;
