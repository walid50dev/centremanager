import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';

export interface Absence {
  id: number; student_id: number; group_id: number; group_name: string;
  absence_date: string; reason: string | null; is_justified: boolean; created_at: string;
}
export interface AbsenceInput {
  student_id: number; group_id: number; absence_date: string; reason: string | null; is_justified: boolean;
}
const useDev = import.meta.env.DEV && !isTauri();
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return useDev ? devInvoke(command, args) as Promise<T> : api<T>(command, args);
}
export const absencesApi = {
  list: (studentId: number) => call<Absence[]>('cmd_get_student_absences', { studentId }),
  add: (data: AbsenceInput) => call<number>('cmd_add_absence', { data }),
  remove: (id: number) => call<void>('cmd_delete_absence', { id }),
};
