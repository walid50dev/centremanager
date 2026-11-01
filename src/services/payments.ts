import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { PaginatedPayments, ReceiptData } from '../types';

/**
 * Typed wrappers for the payment commands
 * (`src-tauri/src/commands/payments.rs`).
 *
 * Payments and invoices are never deleted: there is deliberately no `remove`
 * in this API.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export interface PaymentInput {
  studentId: number;
  invoiceIds: number[];
  amountCents: number;
  method: string;
  notes?: string | null;
}

export interface PaymentHistoryFilters {
  studentId?: number | null;
  month?: number | null;
  year?: number | null;
  page?: number;
  limit?: number;
}

export const paymentsApi = {
  /** Returns the id of the first allocation row (used for the receipt). */
  record: (input: PaymentInput) =>
    call<number>('cmd_record_payment', {
      studentId: input.studentId,
      invoiceIds: input.invoiceIds,
      amountCents: input.amountCents,
      method: input.method,
      notes: input.notes ?? null,
    }),

  history: (filters: PaymentHistoryFilters = {}) =>
    call<PaginatedPayments>('cmd_get_payments_history', {
      studentId: filters.studentId ?? null,
      month: filters.month ?? null,
      year: filters.year ?? null,
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
    }),

  createReceipt: (paymentId: number) => call<number>('cmd_create_receipt', { paymentId }),

  receipt: (receiptId: number) => call<ReceiptData>('cmd_get_receipt_data', { receiptId }),
};

/** Current month (1-12) and year, in the user's timezone. */
export function currentPeriod(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default paymentsApi;
