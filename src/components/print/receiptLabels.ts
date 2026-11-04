import type { TFunction } from 'i18next';
import { formatDate, stripIsolates } from '../../utils/format';
import type { ReceiptData } from '../../types';

/**
 * Everything a PDF template needs, resolved **outside** React.
 *
 * `@react-pdf/renderer` renders documents with its own reconciler, so the
 * i18next context of the app is not reachable from inside a template. The modal
 * therefore translates the labels once and hands a plain object over.
 */
export interface ReceiptLabels {
  heading: string;
  number: string;
  date: string;
  student: string;
  level: string;
  subject: string;
  group: string;
  month: string;
  studentInfo: string;
  paymentDetails: string;
  signature: string;
  unavailable: string;
  groups: string;
  period: string;
  amount: string;
  method: string;
  thanks: string;
  advance: string;
  enrollmentFee: string;
  /** `Thermique` header, kept short on purpose. */
  shortHeading: string;
  thankYouShort: string;
  total: string;
  centerFallback: string;
}

/** One flat, already-formatted view of the receipt (no hooks inside PDFs). */
export interface ReceiptDocumentData {
  receiptNumber: string;
  dateText: string;
  centerName: string;
  centerAddress: string;
  centerPhone: string;
  logo: string | null;
  studentName: string;
  studentLevel: string;
  items: Array<{ subject: string; group: string; month: string; amount: string }>;
  groupsText: string;
  periodText: string;
  amountText: string;
  methodText: string;
}

function clean(value: string | null | undefined): string {
  return stripIsolates(value).trim();
}

export function buildReceiptLabels(t: TFunction): ReceiptLabels {
  return {
    heading: t('receipt.heading'),
    number: t('receipt.number'),
    date: t('receipt.date'),
    student: t('receipt.student'),
    level: t('receipt.level'),
    subject: t('receipt.subject'),
    group: t('receipt.group'),
    month: t('receipt.month'),
    studentInfo: t('receipt.studentInfo'),
    paymentDetails: t('receipt.paymentDetails'),
    signature: t('receipt.signature'),
    unavailable: t('receipt.unavailable'),
    groups: t('receipt.groups'),
    period: t('receipt.period'),
    amount: t('receipt.amountPaid'),
    method: t('receipt.method'),
    thanks: t('receipt.thanks'),
    advance: t('receipt.advance'),
    enrollmentFee: t('receipt.enrollment_fee'),
    shortHeading: t('receipt.shortHeading'),
    thankYouShort: t('receipt.thankYouShort'),
    total: t('receipt.total'),
    centerFallback: t('app.name'),
  };
}

/**
 * Collapse `ReceiptData` (frozen receipt row + live centre block) into the flat
 * strings a PDF needs. Every optional field falls back to an empty string so a
 * template never has to guard against `null`.
 */
function receiptAmount(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} DH`;
}

export function buildReceiptDocument(
  data: ReceiptData,
  labels: ReceiptLabels,
  periodText: string,
  methodText: string,
): ReceiptDocumentData {
  return {
    receiptNumber: clean(data.receipt_number),
    dateText: clean(formatDate(data.payment_date)),
    centerName: clean(data.center_name) || labels.centerFallback,
    centerAddress: clean(data.center_address),
    centerPhone: clean(data.center_phone),
    logo: data.center_logo ? data.center_logo : null,
    studentName: clean(data.student_name),
    studentLevel: clean(data.student_level) || '—',
    items: data.items.map(item => ({ subject: item.kind === 'enrollment_fee' ? labels.enrollmentFee : item.kind === 'advance' ? labels.advance : item.kind === 'unavailable' ? labels.unavailable : clean(item.subject) || '—', group: clean(item.group_name) || '—', month: clean(item.month) || '—', amount: receiptAmount(item.amount) })),
    groupsText: clean(data.groups_text) || (data.items.some(item => item.kind === 'enrollment_fee') ? '—' : labels.advance),
    periodText: clean(periodText),
    amountText: receiptAmount(data.amount_cents),
    methodText: clean(methodText),
  };
}
