import type { TFunction } from 'i18next';
import { formatCurrency } from './format';
import { monthLabel } from './billing';
import type { CompensationDetail, CompensationMode, TeacherCompSummary } from '../types';

/** Stored mode → localised label ("Fixe mensuel", "Horaire", …). */
export function modeLabel(t: TFunction, mode: string | null | undefined): string {
  switch (mode) {
    case 'fixed_monthly':
      return t('teachers.fixedMonthly');
    case 'hourly':
      return t('teachers.hourly');
    case 'per_session':
      return t('teachers.perSession');
    case 'percentage':
      return t('teachers.percentage');
    default:
      return t('teachers.notConfigured');
  }
}

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

/** i18n key of a payroll status label. */
export function statusLabelKey(status: string): string {
  switch (status) {
    case 'settled':
      return 'teachers.status.settled';
    case 'partial':
      return 'teachers.status.partial';
    case 'pending':
      return 'teachers.status.pending';
    default:
      return 'teachers.status.notConfigured';
  }
}

/** Badge tone of a payroll status. */
export function statusVariant(
  status: string,
): 'success' | 'warning' | 'destructive' | 'muted' {
  switch (status) {
    case 'settled':
      return 'success';
    case 'partial':
      return 'warning';
    case 'pending':
      return 'destructive';
    default:
      return 'muted';
  }
}

/**
 * Rebuild the backend's French `detail_lines` in the active language.
 *
 * The Rust command already returns `detail_lines`; they are used as a fallback
 * when the structured breakdown is missing.
 */
export function detailLines(t: TFunction, detail: CompensationDetail): string[] {
  const lines: string[] = [];

  switch (detail.mode) {
    case 'fixed_monthly':
      lines.push(t('teachers.comp.lineFixed', { amount: formatCurrency(detail.value_cents) }));
      break;
    case 'hourly':
      lines.push(
        t('teachers.comp.lineHours', {
          hours: detail.hours ?? 0,
          rate: formatCurrency(detail.value_cents),
          amount: formatCurrency(detail.base_amount_cents),
        }),
      );
      break;
    case 'per_session':
      lines.push(
        t('teachers.comp.lineSessions', {
          count: detail.sessions ?? 0,
          rate: formatCurrency(detail.value_cents),
          amount: formatCurrency(detail.base_amount_cents),
        }),
      );
      break;
    case 'percentage':
      for (const group of detail.groups) {
        const groupLabel = group.branch_name
          ? t('teachers.comp.groupWithBranch', {
              subject: group.subject_name,
              level: group.level_name,
              branch: group.branch_name,
            })
          : t('teachers.comp.groupLabel', {
              subject: group.subject_name,
              level: group.level_name,
            });
        lines.push(
          t('teachers.comp.lineGroup', {
            group: groupLabel,
            count: group.enrolled_count,
            fee: formatCurrency(group.monthly_fee_cents),
            total: formatCurrency(group.total_cents),
          }),
        );
      }
      lines.push(
        t('teachers.comp.lineTheoretical', { total: formatCurrency(detail.theoretical_cents) }),
      );
      lines.push(
        t('teachers.comp.lineBase', {
          pct: percentageLabel(detail.value_cents),
          amount: formatCurrency(detail.base_amount_cents),
        }),
      );
      break;
    default:
      break;
  }

  if ((detail.bonus_pct ?? 0) > 0) {
    lines.push(
      t('teachers.comp.lineBonus', {
        theoretical: formatCurrency(detail.theoretical_cents),
        pct: detail.bonus_pct,
        bonus: formatCurrency(detail.bonus_amount_cents),
      }),
    );
  }

  return lines.length > 0 ? lines : detail.detail_lines;
}

/** "Octobre 2026" for a payroll period. */
export function payrollPeriod(t: TFunction, month: number, year: number): string {
  return `${monthLabel(t, month)} ${year}`;
}

/** Totals of the payroll table on the Payments page. */
export function summaryTotals(rows: TeacherCompSummary[]) {
  return rows.reduce(
    (acc, row) => ({
      due: acc.due + row.total_due_cents,
      settled: acc.settled + row.total_settled_cents,
      remaining: acc.remaining + row.remaining_cents,
    }),
    { due: 0, settled: 0, remaining: 0 },
  );
}
