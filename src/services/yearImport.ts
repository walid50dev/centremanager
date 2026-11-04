import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
export type ImportKind = 'students' | 'groups' | 'teachers';
export interface ImportableItem { id: number; label: string; detail: string; already_imported: boolean; }
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return import.meta.env.DEV && !isTauri() ? devInvoke(command, args) as Promise<T> : api<T>(command, args);
}
export const yearImportApi = {
  list: (kind: ImportKind, prevYearId: number) => call<ImportableItem[]>(`cmd_get_importable_${kind}`, { prevYearId }),
  import: (kind: ImportKind, ids: number[], targetYearId: number) => call<number>(`cmd_import_${kind}`, {
    ...(kind === 'students' ? { studentIds: ids, targetYearId } : kind === 'groups' ? { groupIds: ids, targetYearId } : { teacherIds: ids }),
  }),
};
