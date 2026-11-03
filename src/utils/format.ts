import { format as formatDateFns, isValid, parseISO } from 'date-fns';

/** Currency suffix used across the app (Moroccan dirham). */
export const CURRENCY_SYMBOL = 'DH';

/**
 * Format an amount expressed in centimes as Moroccan dirhams.
 * formatCurrency(15000) -> "150.00 DH"
 */
export function formatCurrency(cents: number | null | undefined): string {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  const amount = (value / 100).toFixed(2);
  // The amount is wrapped in left-to-right isolates (U+2066 / U+2069): inside an
  // Arabic paragraph the digits would otherwise be read as Arabic numbers and
  // the currency symbol would jump in front of them ("DH 150.00").
  return `\u2066${amount} ${CURRENCY_SYMBOL}\u2069`;
}

/**
 * Remove the invisible direction isolates (U+2066 … U+2069) from a string.
 *
 * They exist for the HTML UI so an Arabic paragraph keeps `150.00 DH` in that
 * order. Inside a PDF they would be laid out as glyphless control characters,
 * so every string handed to `@react-pdf/renderer` goes through this first.
 */
export function stripIsolates(value: string | null | undefined): string {
  if (!value) return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u2066-\u2069]/g, '');
}

/**
 * Display a Moroccan mobile number as `06 07 12 34 56`.
 *
 * Storage keeps the ten raw digits (`0607123456`); only the UI groups them, so
 * the same string is copy-pasteable into a phone dialer and readable in a table.
 * Anything that is not a 10-digit number is returned untouched (legacy rows,
 * foreign numbers), and an empty value becomes an em dash.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—';
  const digits = raw.replace(/[\s-]/g, '');
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(
    6,
    8,
  )} ${digits.slice(8, 10)}`;
}

/** `06 07 12 34 56` (or `06-07-12-34-56`) → `0607123456`. */
export function stripPhone(formatted: string | null | undefined): string {
  if (!formatted) return '';
  return formatted.replace(/[\s-]/g, '');
}

/**
 * Format an ISO date (or datetime) as DD/MM/YYYY.
 * formatDate('2025-01-15') -> "15/01/2025"
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // Accept both "2025-01-15" and full ISO timestamps / "YYYY-MM-DD HH:MM:SS".
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const date = parseISO(normalised);
  const fallback = new Date(iso);
  const parsed = isValid(date) ? date : isValid(fallback) ? fallback : null;
  if (!parsed) return '';
  return formatDateFns(parsed, 'dd/MM/yyyy');
}

/** Format an ISO date as DD/MM/YYYY HH:mm. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const date = parseISO(normalised);
  if (!isValid(date)) return '';
  return formatDateFns(date, 'dd/MM/yyyy HH:mm');
}

/** Format an amount in centimes for input fields, e.g. 15000 -> "150.00". */
export function centsToAmount(cents: number | null | undefined): string {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return (value / 100).toFixed(2);
}

/** Parse a user-typed amount ("150,50" or "150.50") into centimes. */
export function amountToCents(amount: string | number): number {
  const normalised = typeof amount === 'number' ? String(amount) : amount.replace(',', '.').trim();
  const parsed = Number.parseFloat(normalised);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Human readable file size, e.g. 2411724 -> "2.3 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : size >= 100 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[exponent]}`;
}

/** Compact timestamp for backup file names: 2026-10-31 -> "20261031". */
export function formatFileStamp(date: Date = new Date()): string {
  return formatDateFns(date, 'yyyyMMdd');
}

/** Month + year label, e.g. (1, 2025) -> "01/2025". */
export function formatPeriod(month: number | null, year: number | null): string {
  if (!month || !year) return '';
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** Join a first/last-agnostic list for display. */
export function formatGroupsText(names: string[]): string {
  return names.filter(Boolean).join(', ');
}

/** Lightweight className joiner (avoids an extra dependency). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
