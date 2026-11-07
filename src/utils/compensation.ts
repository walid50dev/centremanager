import type { TFunction } from 'i18next';
import { formatCurrency } from './format';
import type { CompensationMode } from '../types';

/** Short badge shown on the teacher card: "Fixe : 500.00 DH/mois", "40% du théorique"… */
export function modeBadge(
  t: TFunction,
  mode: CompensationMode | string | null,
  valueCents: number | null,
): string {
  const amount = formatCurrency(valueCents ?? 0);
  switch (mode) {
    case 'fixed_monthly':
      return t('teachers.badgeFixed', { amount });
    case 'hourly':
      return t('teachers.badgeHourly', { amount });
    case 'per_session':
      return t('teachers.badgeSession', { amount });
    case 'percentage':
      return t('teachers.badgePercentage', { pct: percentageLabel(valueCents ?? 0) });
    default:
      return t('teachers.notConfigured');
  }
}

/** `4000` → `40`, `2550` → `25.5` (percentage stored × 100). */
export function percentageLabel(valueCents: number): string {
  const pct = valueCents / 100;
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
}
