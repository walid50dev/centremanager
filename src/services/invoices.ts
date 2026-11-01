import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { PaymentAlerts, StudentInvoice } from '../types';

/**
 * Typed wrappers for the invoicing commands
 * (`src-tauri/src/commands/invoices.rs`).
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export const invoicesApi = {
  /** Idempotent: existing `(enrollment, month, year)` rows are skipped. */
  generateMonthly: (month: number, year: number) =>
    call<number>('cmd_generate_monthly_invoices', { month, year }),

  forStudent: (studentId: number) =>
    call<StudentInvoice[]>('cmd_get_student_invoices', { studentId }),

  /** Overdue invoices, all periods (sidebar badge). */
  latePaymentCount: () => call<number>('cmd_get_late_payment_count'),

  alerts: (month: number, year: number) =>
    call<PaymentAlerts>('cmd_get_payment_alerts', { month, year }),
};

export default invoicesApi;
