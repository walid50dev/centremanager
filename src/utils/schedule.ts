import type { TFunction } from 'i18next';

export interface ScheduleLike {
  day_of_week: string;
  start_time: string;
  end_time: string;
}

/**
 * "Lundi 16:00–18:00", translated, or an em dash for legacy rows that have no
 * schedule recorded yet (the columns are nullable in the schema).
 */
export function groupSchedule(t: TFunction, group: ScheduleLike): string {
  if (!group.day_of_week || !group.start_time || !group.end_time) return '—';
  const day = t(`groups.dayNames.${group.day_of_week}`, { defaultValue: group.day_of_week });
  return `${day} ${group.start_time}–${group.end_time}`;
}

export default groupSchedule;

export interface GroupLabels {
  subject_name: string;
  level_name: string;
}

/**
 * "Mathématiques — Tronc Commun". Legacy rows can have a NULL subject or level
 * (the columns are nullable), so empty labels are dropped instead of showing
 * a stray em dash.
 */
export function groupTitle(t: TFunction, group: GroupLabels): string {
  const clean = (value: string) => (value && value !== '—' ? value : '');
  const parts = [clean(group.subject_name), clean(group.level_name)].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : t('groups.untitled');
}
