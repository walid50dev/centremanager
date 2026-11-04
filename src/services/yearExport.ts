import { api, isTauri } from './api';
import { devInvoke } from './settingsDevBackend';
export type ExportSection = 'students' | 'groups' | 'teachers' | 'payments' | 'expenses' | 'salaries';
export interface YearSummary {
  label: string; students: number; groups: number; teachers: number;
  revenue_cents: number; salaries_cents: number; expenses_cents: number; net_cents: number;
  subjects: Array<{ name: string; students: number; revenue_cents: number }>;
}
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  return import.meta.env.DEV && !isTauri() ? devInvoke(cmd, args) as Promise<T> : api<T>(cmd, args);
}
export const yearExportApi = {
  summary: (yearId: number) => call<YearSummary>('cmd_export_year_summary', { yearId }),
  data: (yearId: number, section: ExportSection) => call<Array<Record<string, string>>>('cmd_export_year_data', { yearId, section }),
};
export const EXPORT_COLUMNS: Record<ExportSection, string[]> = {
  students: ['id', 'first_name', 'last_name', 'full_name', 'phone', 'level', 'branch', 'guardian_name', 'school_name', 'status'],
  groups: ['id', 'subject', 'level', 'branch', 'teacher', 'day_of_week', 'start_time', 'end_time', 'schedules', 'room', 'monthly_fee_cents', 'capacity', 'status'],
  teachers: ['id', 'full_name', 'phone', 'email', 'status'],
  payments: ['id', 'student', 'invoice_id', 'amount_cents', 'payment_method', 'notes', 'created_at'],
  expenses: ['id', 'label', 'amount_cents', 'category', 'month', 'year', 'notes', 'created_at'],
  salaries: ['id', 'teacher', 'month', 'year', 'amount_cents', 'payment_method', 'notes', 'created_at'],
};
export async function downloadExcel(yearId: number, label: string, section: ExportSection) {
  const [rows, xlsx] = await Promise.all([yearExportApi.data(yearId, section), import('xlsx')]);
  const sheet = xlsx.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS[section] });
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, section);
  xlsx.writeFile(book, `${safeFile(label)}_${section}.xlsx`);
}
export function safeFile(value: string) { return value.replace(/[^A-Za-z0-9_-]+/g, '-') || 'annee'; }
