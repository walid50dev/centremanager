import type { TFunction } from 'i18next';
import type { InvoiceStatus } from '../types';

/** Fallback names, used when a locale has no `payments.monthNames` array. */
const FRENCH_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

/** Localised month name ("Octobre" / "أكتوبر"). */
export function monthLabel(t: TFunction, month: number): string {
  // `common.months.<n>` is the canonical single-key form used across the app…
  const key = `common.months.${month}`;
  const single = t(key);
  if (typeof single === 'string' && single !== key) return single;
  // …`payments.monthNames` is the array form exposed for billing screens.
  const names = t('payments.monthNames', { returnObjects: true }) as unknown;
  if (Array.isArray(names) && typeof names[month - 1] === 'string') {
    return names[month - 1] as string;
  }
  return FRENCH_MONTHS[month - 1] ?? String(month);
}

/** "Octobre 2025" / "أكتوبر 2025". */
export function periodLabel(t: TFunction, month: number, year: number): string {
  return `${monthLabel(t, month)} ${year}`;
}

/** Stored payment method ("espèces") → localised label. */
export function methodLabel(t: TFunction, method: string | null | undefined): string {
  switch ((method ?? '').toLowerCase()) {
    case 'espèces':
    case 'especes':
    case 'cash':
      return t('payment.cash');
    case 'virement':
    case 'transfer':
      return t('payment.transfer');
    case 'chèque':
    case 'cheque':
    case 'check':
      return t('payment.check');
    case 'autre':
    case 'other':
      return t('payment.other');
    default:
      return method ?? '—';
  }
}

/** Badge tone + label key for an invoice status. */
export function statusMeta(status: string): {
  variant: 'success' | 'warning' | 'destructive' | 'muted';
  labelKey: string;
} {
  switch (status as InvoiceStatus) {
    case 'payé':
      return { variant: 'success', labelKey: 'student.invoice.paid' };
    case 'partiel':
      return { variant: 'warning', labelKey: 'student.invoice.partial' };
    case 'impayé':
      return { variant: 'destructive', labelKey: 'student.invoice.unpaid' };
    default:
      return { variant: 'muted', labelKey: 'student.invoice.unpaid' };
  }
}

/** `YYYY-MM-DD` for today, in the user's timezone. */
export function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** True when the due date is in the past and money is still owed. */
export function isOverdue(dueDate: string, remainingCents: number): boolean {
  if (!dueDate || remainingCents <= 0) return false;
  return dueDate < todayIsoDate();
}
