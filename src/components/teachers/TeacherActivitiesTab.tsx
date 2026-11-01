import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import Badge, { type BadgeVariant } from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import ActivityModal from './ActivityModal';
import { toast } from '../ui/Toast';
import { activitiesApi } from '../../services/teachers';
import { currentPeriod } from '../../services/payments';
import { monthLabel } from '../../utils/billing';
import { formatDate } from '../../utils/format';
import type { Activity } from '../../types';

export interface TeacherActivitiesTabProps {
  teacherId: number;
}

/** Badge tone of an activity type. */
const TYPE_VARIANTS: Record<string, BadgeVariant> = {
  cours: 'primary',
  rattrapage: 'warning',
  examen: 'default',
  autre: 'muted',
};

/** Tab 3 of the teacher sheet: the monthly activities log. */
export function TeacherActivitiesTab({ teacherId }: TeacherActivitiesTabProps) {
  const { t } = useTranslation();
  const initial = currentPeriod();

  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await activitiesApi.list(teacherId, month, year));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [teacherId, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          hours: acc.hours + (row.hours ?? 0),
          sessions: acc.sessions + (row.sessions ?? 0),
        }),
        { hours: 0, sessions: 0 },
      ),
    [rows],
  );

  const years = useMemo(() => [initial.year - 1, initial.year, initial.year + 1], [initial.year]);

  const selectClass =
    'h-9 rounded-md border border-border bg-white px-3 text-body text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            aria-label={t('payments.month')}
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            className={selectClass}
            data-testid="activities-month"
          >
            {Array.from({ length: 12 }).map((_, index) => (
              <option key={index + 1} value={index + 1}>
                {monthLabel(t, index + 1)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('payments.year')}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className={selectClass}
            data-testid="activities-year"
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <Button
          leftIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setModalOpen(true)}
          data-testid="activity-add"
        >
          {t('teachers.activity.add')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
            title={t('teachers.activity.empty')}
            description={t('teachers.activity.emptyHint')}
            action={
              <Button
                variant="secondary"
                leftIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setModalOpen(true)}
              >
                {t('teachers.activity.add')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]" data-testid="teacher-activities">
            <thead className="bg-background text-label text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('teachers.activity.date')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('teachers.activity.type')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('teachers.activity.hours')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('teachers.activity.sessions')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('teachers.activity.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-2.5 text-muted">{formatDate(row.activity_date)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={TYPE_VARIANTS[row.activity_type] ?? 'muted'}>
                      {t(`teachers.activity.${row.activity_type}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{row.hours ?? '—'}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{row.sessions ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted">{row.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-background/60 text-[13px]">
              <tr>
                <td className="px-4 py-2.5 font-medium text-foreground" colSpan={2}>
                  {t('teachers.activity.totals', { period: `${monthLabel(t, month)} ${year}` })}
                </td>
                <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                  {totals.hours} h
                </td>
                <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                  {totals.sessions}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <ActivityModal
        open={modalOpen}
        teacherId={teacherId}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

export default TeacherActivitiesTab;
