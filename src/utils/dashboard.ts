import { format } from 'date-fns';
import { ar } from 'date-fns/locale/ar';
import { fr } from 'date-fns/locale/fr';
import { todayIsoDate } from './billing';
import type { AlertItem } from '../types';

/**
 * Presentation helpers of the dashboard (Phase 7).
 *
 * The backend only returns numbers and raw statuses; every label, colour and
 * trend sentence lives here so the page stays declarative and testable.
 */

/** `Lundi 27 octobre 2025` / `الثلاثاء 27 أكتوبر 2025` (Latin digits in both). */
export function longDate(language: string, date: Date = new Date()): string {
  const locale = language === 'ar' ? ar : fr;
  const label = format(date, 'EEEE d MMMM yyyy', { locale });
  // date-fns lower-cases the weekday, the design wants a capitalised French one.
  return language === 'ar' ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

export type TrendDirection = 'up' | 'down' | 'stable';

export interface Trend {
  direction: TrendDirection;
  /**
   * Percentage change against the previous month, or `null` when there is no
   * baseline to compare with (previous month at zero).
   */
  percent: number | null;
}

/**
 * Compare a value with the previous month.
 *
 * A previous month at zero has no meaningful percentage: the direction is still
 * reported (activity appeared / disappeared) but `percent` is `null` so the UI
 * shows `—` instead of an infinite `+∞%`.
 */
export function computeTrend(current: number, previous: number): Trend {
  if (current === previous) return { direction: 'stable', percent: 0 };
  const direction: TrendDirection = current > previous ? 'up' : 'down';
  if (previous === 0) return { direction, percent: null };
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  // Rounded to the unit: "+82%", "-5%".
  return { direction, percent: Math.round(percent) };
}

/** `+12%` / `-5%` / `—`. */
export function trendText(t: (key: string, options?: Record<string, unknown>) => string, trend: Trend): string {
  if (trend.percent === null || trend.direction === 'stable') return t('dashboard.trend.stable');
  const absolute = Math.abs(trend.percent);
  return trend.direction === 'up'
    ? t('dashboard.trend.up', { value: absolute })
    : t('dashboard.trend.down', { value: absolute });
}

/** Colour of the collection-rate card: green > 80 %, amber 50–80 %, red below. */
export function rateTone(rate: number): 'success' | 'warning' | 'destructive' {
  if (rate > 80) return 'success';
  if (rate >= 50) return 'warning';
  return 'destructive';
}

/** Text class matching [`rateTone`]. */
export function rateTextClass(rate: number): string {
  switch (rateTone(rate)) {
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    default:
      return 'text-destructive';
  }
}

/** Background class of the icon bubble matching [`rateTone`]. */
export function rateBubbleClass(rate: number): string {
  switch (rateTone(rate)) {
    case 'success':
      return 'bg-success/10 text-success';
    case 'warning':
      return 'bg-warning/10 text-warning';
    default:
      return 'bg-destructive/10 text-destructive';
  }
}

/** `83.3 %` — one decimal, the trailing `.0` kept for stability of the column. */
export function rateLabel(rate: number): string {
  return `${rate.toFixed(1)} %`;
}

/** Dot colour of an alert row. */
export const SEVERITY_DOT: Record<AlertItem['severity'], string> = {
  late: 'bg-destructive',
  upcoming: 'bg-warning',
  ok: 'bg-success',
};

/** Amount text colour of an alert row. */
export const SEVERITY_TEXT: Record<AlertItem['severity'], string> = {
  late: 'text-destructive',
  upcoming: 'text-warning',
  ok: 'text-muted',
};

export interface AlertTiming {
  /** i18n key of the “when is it due” sentence. */
  key: string;
  /** Interpolation values (`count` drives the CLDR plurals). */
  values: Record<string, number>;
}

/**
 * Wording of the “when is it due” part of an alert row.
 *
 * Late → `daysLate` (plural), today → `today`, tomorrow → `tomorrow`,
 * otherwise `inDays` (plural).
 */
export function alertTiming(alert: AlertItem): AlertTiming {
  if (alert.severity === 'late' || alert.days_remaining < 0) {
    return { key: 'dashboard.alerts.daysLate', values: { count: Math.abs(alert.days_remaining) } };
  }
  if (alert.days_remaining === 0) {
    return { key: 'dashboard.alerts.today', values: {} };
  }
  if (alert.days_remaining === 1) {
    return { key: 'dashboard.alerts.tomorrow', values: {} };
  }
  return { key: 'dashboard.alerts.inDays', values: { count: alert.days_remaining } };
}

/** Month/year pair of the current date, used as the initial period. */
export function currentPeriod(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/** Today as `YYYY-MM-DD`, re-exported so the page has a single import. */
export { todayIsoDate };
