import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
import type { Expense, ExpenseInput, ExpensesSummary } from '../types';

/**
 * Typed wrappers for the Phase 11 monthly-expense commands
 * (`src-tauri/src/commands/expenses.rs`).
 *
 * In a browser (`npm run dev`, no Tauri IPC) the calls are served by the
 * development store in `settingsDevBackend.ts`; inside the desktop app every
 * call goes to Rust.
 */
const USE_DEV_BACKEND = import.meta.env.DEV && !isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (USE_DEV_BACKEND) return devInvoke(cmd, args) as Promise<T>;
  return api<T>(cmd, args);
}

export const expensesApi = {
  /** One month of charges, optionally narrowed to a category. */
  list: (month: number, year: number, category: string | null = null) =>
    call<Expense[]>('cmd_get_expenses', { month, year, category }),

  summary: (month: number, year: number) =>
    call<ExpensesSummary>('cmd_get_expenses_summary', { month, year }),

  create: (data: ExpenseInput) => call<number>('cmd_create_expense', { data }),

  update: (id: number, data: ExpenseInput) => call<void>('cmd_update_expense', { id, data }),

  /** Expenses are internal bookkeeping: unlike payments, they can be deleted. */
  remove: (id: number) => call<void>('cmd_delete_expense', { id }),

  categories: () => call<string[]>('cmd_get_expense_categories'),

  setCategories: (categories: string[]) =>
    call<void>('cmd_set_expense_categories', { categories }),
};

export default expensesApi;
