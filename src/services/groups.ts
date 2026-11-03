import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { Group, GroupDetail, GroupInput, ScheduleConflict, ScheduleConflictInput, TeacherOption } from '../types';

/**
 * Typed wrappers for the group commands
 * (`src-tauri/src/commands/groups.rs`).
 *
 * In a browser (`npm run dev`, no Tauri IPC) the calls are served by the
 * development store in `settingsDevBackend.ts`.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export interface GroupFilters {
  schoolYearId?: number | null;
  status?: string | null;
}

/** Canonical weekdays, in the order the backend sorts them. */
export const DAY_NAMES = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

export type DayName = (typeof DAY_NAMES)[number];

export const groupsApi = {
  list: (filters: GroupFilters = {}) =>
    call<Group[]>('cmd_get_groups', {
      schoolYearId: filters.schoolYearId ?? null,
      status: filters.status ?? null,
    }),

  detail: (id: number) => call<GroupDetail>('cmd_get_group_detail', { id }),

  create: (data: GroupInput) => call<number>('cmd_create_group', { data }),

  update: (id: number, data: GroupInput) => call<void>('cmd_update_group', { id, data }),

  checkScheduleConflicts: (groupId: number | null, teacherId: number | null, room: string, schoolYearId: number, schedules: ScheduleConflictInput[]) =>
    call<ScheduleConflict[]>('cmd_check_schedule_conflicts', { groupId, teacherId, room, schoolYearId, schedules }),

  teachers: () => call<TeacherOption[]>('cmd_get_teacher_options'),
};

/** Capacity colour stop: green < 70 %, amber 70-90 %, red above. */
export function occupancyTone(enrolled: number, capacity: number): 'success' | 'warning' | 'destructive' {
  const ratio = capacity > 0 ? enrolled / capacity : 0;
  if (ratio >= 0.9) return 'destructive';
  if (ratio >= 0.7) return 'warning';
  return 'success';
}

export default groupsApi;
