import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { AlertItem, DashboardKPIs, RecentPayment } from '../types';

/**
 * Typed wrappers for the Phase 7 read-only dashboard commands
 * (`commands/dashboard.rs`).
 *
 * The teacher payroll block is **not** wrapped here: the dashboard reuses
 * `compensationApi.summary(month, year)` from Phase 6 so there is exactly one
 * implementation of the payroll totals.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export const dashboardApi = {
  kpis: (month: number, year: number) =>
    call<DashboardKPIs>('cmd_get_dashboard_kpis', { month, year }),

  /** `cmd` is argument-less: the window is computed from today in Rust. */
  alerts: () => call<AlertItem[]>('cmd_get_dashboard_alerts'),

  recentPayments: (limit = 10) =>
    call<RecentPayment[]>('cmd_get_recent_payments', { limit }),
};

export default dashboardApi;
