import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { CheckDuplicateInput, DuplicateMatch } from '../types';

export type DuplicateEntityType = 'student' | 'teacher';
export function splitFullName(name: string): { first: string; last: string } {
  const [first = '', ...last] = name.trim().split(/\s+/);
  return { first, last: last.join(' ') };
}
export const duplicatesApi = {
  check(entityType: DuplicateEntityType, data: CheckDuplicateInput): Promise<DuplicateMatch[]> {
    const args = { entityType, data };
    if (import.meta.env.DEV && !isTauri()) return devInvoke('cmd_check_duplicates', args) as Promise<DuplicateMatch[]>;
    return api<DuplicateMatch[]>('cmd_check_duplicates', args);
  },
};
