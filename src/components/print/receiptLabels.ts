import type { TFunction } from 'i18next';
import { formatCurrency, formatDate, stripIsolates } from '../../utils/format';
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
  groups: string;
  period: string;
  amount: string;
  method: string;
  thanks: string;
  advance: string;
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
    groups: t('receipt.groups'),
    period: t('receipt.period'),
    amount: t('receipt.amountPaid'),
    method: t('receipt.method'),
    thanks: t('receipt.thanks'),
    advance: t('receipt.advance'),
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
    groupsText: clean(data.groups_text) || labels.advance,
    periodText: clean(periodText),
    amountText: clean(formatCurrency(data.amount_cents)),
    methodText: clean(methodText),
  };
}
