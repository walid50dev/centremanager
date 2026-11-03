import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { GroupSchedule, TimetableEntry, TimetableFilters } from '../types';

/**
 * Typed wrappers for the scheduling commands
 * (`src-tauri/src/commands/schedules.rs`).
 *
 * In a browser (`npm run dev`, no Tauri IPC) the calls are served by the
 * development store in `settingsDevBackend.ts`.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

/** A slot as the form sends it (no id yet). */
export interface SchedulePayload {
  day_of_week: string;
  start_time: string;
  end_time: string;
}

export const schedulesApi = {
  /** The weekly slots of one group, Monday first. */
  forGroup: (groupId: number) =>
    call<GroupSchedule[]>('cmd_get_group_schedules', { groupId }),

  /** Replace every slot of a group; returns the stored rows. */
  set: (groupId: number, schedules: SchedulePayload[]) =>
    call<GroupSchedule[]>('cmd_set_group_schedules', { groupId, schedules }),

  /** Every active class, optionally filtered (filters are ANDed server-side). */
  timetable: (filters: Partial<TimetableFilters> = {}) =>
    call<TimetableEntry[]>('cmd_get_timetable', {
      filters: {
        level_id: filters.level_id ?? null,
        subject_id: filters.subject_id ?? null,
        teacher_id: filters.teacher_id ?? null,
        room: filters.room ?? null,
      },
    }),

  /** Distinct rooms of active groups, for the filter dropdown. */
  rooms: () => call<string[]>('cmd_get_timetable_rooms'),
};

export default schedulesApi;
