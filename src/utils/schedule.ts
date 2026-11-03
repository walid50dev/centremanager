import type { TFunction } from 'i18next';
import type { GroupSchedule } from '../types';

export interface ScheduleLike {
  day_of_week: string;
  start_time: string;
  end_time: string;
  /** Phase 13 — the whole week, when the row carries it. */
  schedules?: GroupSchedule[] | null;
}

/** Canonical weekdays, in the order everything sorts by. */
export const WEEK_DAYS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

/** `Lundi` → `monday` (the i18n key suffix). */
export const DAY_KEYS: Record<string, string> = {
  Lundi: 'monday',
  Mardi: 'tuesday',
  Mercredi: 'wednesday',
  Jeudi: 'thursday',
  Vendredi: 'friday',
  Samedi: 'saturday',
  Dimanche: 'sunday',
};

/** `16:00` → `16`, `16:30` → `16:30`. */
function shortTime(value: string): string {
  return value.endsWith(':00') ? value.slice(0, -3) : value;
}

/** `"16:00"` → 960 minutes since midnight (0 when unparsable). */
export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':');
  const parsed = Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dayLabel(t: TFunction, day: string): string {
  return t(`groups.dayNames.${day}`, { defaultValue: day });
}

export function shortDayLabel(t: TFunction, day: string): string {
  const key = DAY_KEYS[day] ?? day.toLowerCase();
  return t(`timetable.days.short.${key}`, { defaultValue: day.slice(0, 3) });
}

/** Slots of a group, sorted Monday-first, ignoring empty rows. */
export function scheduleSlots(group: ScheduleLike): GroupSchedule[] {
  const source = Array.isArray(group.schedules) ? group.schedules : [];
  const slots = source
    .filter((slot) => slot.day_of_week && slot.start_time && slot.end_time)
    .map((slot, index) => ({ ...slot, id: slot.id ?? index + 1 }));
  if (slots.length > 0) {
    return slots.sort(
      (a, b) =>
        WEEK_DAYS.indexOf(a.day_of_week as (typeof WEEK_DAYS)[number]) -
          WEEK_DAYS.indexOf(b.day_of_week as (typeof WEEK_DAYS)[number]) ||
        a.start_time.localeCompare(b.start_time),
    );
  }
  // Legacy row that never got a schedule row (pre-Phase 13 data).
  if (group.day_of_week && group.start_time && group.end_time) {
    return [
      {
        id: 0,
        day_of_week: group.day_of_week,
        start_time: group.start_time,
        end_time: group.end_time,
      },
    ];
  }
  return [];
}

/** `"Lun 16-18 · Mer 14-16"` — the compact summary shown on a card. */
export function formatSchedules(t: TFunction, slots: GroupSchedule[]): string {
  if (slots.length === 0) return '—';

  // One slot keeps the verbose form teachers are used to: "Lundi 16:00–18:00".
  if (slots.length === 1) {
    const [slot] = slots;
    return `${dayLabel(t, slot.day_of_week)} ${slot.start_time}–${slot.end_time}`;
  }

  const sameHours = slots.every(
    (slot) => slot.start_time === slots[0].start_time && slot.end_time === slots[0].end_time,
  );
  const range = `${shortTime(slots[0].start_time)}–${shortTime(slots[0].end_time)}`;

  // Identical hours collapse into one range: "Lun · Mar · Mer · Jeu 16-18".
  if (sameHours) {
    return `${slots.map((slot) => shortDayLabel(t, slot.day_of_week)).join(' · ')} ${range}`;
  }
  return slots
    .map(
      (slot) =>
        `${shortDayLabel(t, slot.day_of_week)} ${shortTime(slot.start_time)}–${shortTime(slot.end_time)}`,
    )
    .join(' · ');
}

/**
 * "Lundi 16:00–18:00" for a single-slot group, "Lun 16-18 · Mer 14-16" for a
 * multi-day one, and an em dash for legacy rows with nothing recorded.
 */
export function groupSchedule(t: TFunction, group: ScheduleLike): string {
  return formatSchedules(t, scheduleSlots(group));
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

/**
 * Colour of a subject block in the timetable.
 *
 * The palette is fixed per subject name (not per group) so every Mathématiques
 * class reads the same across the week; anything unknown falls back to slate.
 */
const SUBJECT_COLORS: Record<string, string> = {
  Mathématiques: '#2563EB',
  'Physique-Chimie': '#7C3AED',
  SVT: '#16A34A',
  Français: '#DC2626',
  Arabe: '#0D9488',
  Anglais: '#EA580C',
  Philosophie: '#DB2777',
  'Histoire-Géographie': '#D97706',
  Économie: '#0891B2',
  Informatique: '#4F46E5',
};

export const DEFAULT_SUBJECT_COLOR = '#64748B';

export function subjectColor(name: string): string {
  return SUBJECT_COLORS[name] ?? DEFAULT_SUBJECT_COLOR;
}

/** A 20 % tint of a subject colour, for the block background. */
export function subjectTint(hex: string): string {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.2)`;
}
