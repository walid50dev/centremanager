import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { TrashEntityType, TrashItem } from '../types';

export const TRASH_CHANGED = 'centremanager:trash-changed';
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return import.meta.env.DEV && !isTauri() ? devInvoke(command, args) as Promise<T> : api<T>(command, args);
}
async function change<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await call<T>(command, args);
  window.dispatchEvent(new Event(TRASH_CHANGED));
  return result;
}
export const trashApi = {
  list: () => call<TrashItem[]>('cmd_list_trash'),
  remove: (entityType: TrashEntityType, entityId: number) => change<void>('cmd_delete_to_trash', { entityType, entityId }),
  restore: (entityType: TrashEntityType, entityId: number) => change<void>('cmd_restore_from_trash', { entityType, entityId }),
  purge: () => change<number>('cmd_purge_trash'),
  deletePermanently: (entityType: TrashEntityType, entityId: number) => change<void>('cmd_delete_permanently', { entityType, entityId }),
  empty: () => change<number>('cmd_empty_trash'),
};
