import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, HandCoins } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import SettlementModal from '../teachers/SettlementModal';
import { toast } from '../ui/Toast';
import { compensationApi } from '../../services/teachers';
import { modeLabel, statusLabelKey, statusVariant, summaryTotals } from '../../utils/compensation';
import { formatCurrency } from '../../utils/format';
import { monthLabel } from '../../utils/billing';
import type { TeacherCompSummary } from '../../types';

export interface TeacherSettlementsTabProps {
  month: number;
  year: number;
}

/** Payments page, tab 2 — what the centre owes every teacher this month. */
export function TeacherSettlementsTab({ month, year }: TeacherSettlementsTabProps) {
  const { t } = useTranslation();

  const [rows, setRows] = useState<TeacherCompSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<TeacherCompSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await compensationApi.summary(month, year));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => summaryTotals(rows), [rows]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
          title={t('payments.teacherSummary.empty')}
          description={t('payments.teacherSummary.emptyHint')}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]" data-testid="teacher-summary">
          <thead className="bg-background text-label text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('payments.teacherSummary.teacher')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('payments.teacherSummary.mode')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('payments.teacherSummary.due')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('payments.teacherSummary.settled')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('payments.teacherSummary.remaining')}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t('payments.teacherSummary.status')}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const blocked = row.status === 'settled' || row.status === 'not_configured';
              return (
                <tr key={row.teacher_id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{row.teacher_name}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {row.mode ? modeLabel(t, row.mode) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                    {formatCurrency(row.total_due_cents)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-success">
                    {formatCurrency(row.total_settled_cents)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">
                    {formatCurrency(row.remaining_cents)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={statusVariant(row.status)}>{t(statusLabelKey(row.status))}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Button
                      size="sm"
                      onClick={() => setTarget(row)}
                      disabled={blocked}
                      leftIcon={<HandCoins className="h-3.5 w-3.5" aria-hidden="true" />}
                    >
                      {t('teachers.comp.settle')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white px-4 py-3 text-[13px]">
        <span className="text-muted">
          {t('payments.teacherSummary.period', { period: `${monthLabel(t, month)} ${year}` })}
        </span>
        <span className="flex flex-wrap items-center gap-4">
          <span className="text-muted">
            {t('payments.teacherSummary.due')}:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {formatCurrency(totals.due)}
            </span>
          </span>
          <span className="text-muted">
            {t('payments.teacherSummary.settled')}:{' '}
            <span className="font-semibold tabular-nums text-success">
              {formatCurrency(totals.settled)}
            </span>
          </span>
          <span className="text-muted">
            {t('payments.teacherSummary.remaining')}:{' '}
            <span className="font-semibold tabular-nums text-destructive">
              {formatCurrency(totals.remaining)}
            </span>
          </span>
        </span>
      </div>

      {target ? (
        <SettlementModal
          open
          teacherId={target.teacher_id}
          teacherName={target.teacher_name}
          month={month}
          year={year}
          remainingCents={target.remaining_cents}
          totalCents={target.total_due_cents}
          onClose={() => setTarget(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}

export default TeacherSettlementsTab;
