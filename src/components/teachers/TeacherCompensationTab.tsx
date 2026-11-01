import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Calculator, HandCoins, Receipt } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import SettlementModal from './SettlementModal';
import { compensationApi } from '../../services/teachers';
import { currentPeriod } from '../../services/payments';
import { monthLabel } from '../../utils/billing';
import {
  detailLines as buildDetailLines,
  modeLabel,
  statusLabelKey,
  statusVariant,
} from '../../utils/compensation';
import { formatCurrency, formatDate } from '../../utils/format';
import { methodLabel } from '../../utils/billing';
import type { CompensationDetail, CompensationStatus, Settlement } from '../../types';

export interface TeacherCompensationTabProps {
  teacherId: number;
  teacherName: string;
  /** Called when the configuration is missing, to jump to tab 1. */
  onConfigure: () => void;
  onChanged?: () => void;
}

/** Tab 4 of the teacher sheet: monthly calculation + settlements. */
export function TeacherCompensationTab({
  teacherId,
  teacherName,
  onConfigure,
  onChanged,
}: TeacherCompensationTabProps) {
  const { t } = useTranslation();
  const initial = currentPeriod();

  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [detail, setDetail] = useState<CompensationDetail | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calculated, history] = await Promise.all([
        compensationApi.calculate(teacherId, month, year),
        compensationApi.settlements(teacherId, month, year),
      ]);
      setDetail(calculated);
      setSettlements(history);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetail(null);
      setSettlements([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [teacherId, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const status: CompensationStatus = useMemo(() => {
    if (!detail) return 'not_configured';
    if (detail.total_cents > 0 && detail.already_settled_cents >= detail.total_cents) {
      return 'settled';
    }
    return detail.already_settled_cents > 0 ? 'partial' : 'pending';
  }, [detail]);

  const years = useMemo(() => [initial.year - 1, initial.year, initial.year + 1], [initial.year]);
  const selectClass =
    'h-9 rounded-md border border-border bg-white px-3 text-body text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  const notConfigured = error === 'Compensation non configurée';
  const lines = detail ? buildDetailLines(t, detail) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            aria-label={t('payments.month')}
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            className={selectClass}
            data-testid="comp-month"
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
            data-testid="comp-year"
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(status)} data-testid="comp-status">
            {t(statusLabelKey(status))}
          </Badge>
          <Button
            leftIcon={<HandCoins className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setModalOpen(true)}
            disabled={!detail || loading}
            data-testid="comp-settle"
          >
            {t('teachers.comp.settle')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
      ) : notConfigured ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            title={t('teachers.comp.notConfigured')}
            description={t('teachers.comp.notConfiguredHint')}
            action={
              <Button variant="secondary" onClick={onConfigure} data-testid="comp-go-config">
                {t('teachers.configureComp')}
              </Button>
            }
          />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            title={t('common.error')}
            description={error}
          />
        </Card>
      ) : detail ? (
        <>
          <Card className="border-primary/40 p-5" data-testid="comp-calculation">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-h2 text-foreground">
                <Calculator className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('teachers.comp.detail')}
              </h3>
              <Badge variant="primary">
                {modeLabel(t, detail.mode)}
                {detail.mode === 'percentage'
                  ? ` · ${detail.value_cents / 100}%`
                  : detail.mode === 'hourly'
                    ? ` · ${formatCurrency(detail.value_cents)}/h`
                    : detail.mode === 'per_session'
                      ? ` · ${formatCurrency(detail.value_cents)}`
                      : ''}
              </Badge>
            </div>

            <ul className="mt-3 space-y-1.5 text-[13px]" data-testid="comp-lines">
              {lines.map((line, index) => {
                // "label : formule" — the formula stays left-to-right even in Arabic.
                const cut = line.indexOf(' : ');
                const label = cut > 0 ? line.slice(0, cut) : null;
                const formula = cut > 0 ? line.slice(cut + 3) : line;
                return (
                  <li
                    key={`${line}-${index}`}
                    className={
                      index === lines.length - 1 && (detail.bonus_pct ?? 0) > 0
                        ? 'text-warning'
                        : 'text-muted'
                    }
                  >
                    {label ? <span>{label} : </span> : null}
                    <span dir="ltr" className="inline-block tabular-nums">
                      {formula}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
              <div>
                <p className="text-label text-muted">{t('teachers.comp.base')}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {formatCurrency(detail.base_amount_cents)}
                </p>
              </div>
              <div>
                <p className="text-label text-muted">{t('teachers.comp.bonusAmount')}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-warning">
                  {formatCurrency(detail.bonus_amount_cents)}
                </p>
              </div>
              <div>
                <p className="text-label text-muted">{t('teachers.comp.total')}</p>
                <p
                  className="mt-0.5 text-lg font-semibold tabular-nums text-primary"
                  data-testid="comp-total"
                >
                  {formatCurrency(detail.total_cents)}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 border-t border-border pt-3 text-[13px] sm:grid-cols-3">
              <p className="flex items-center justify-between gap-2 sm:block">
                <span className="text-muted">{t('teachers.comp.settled')}</span>
                <span className="block font-medium tabular-nums text-success">
                  {formatCurrency(detail.already_settled_cents)}
                </span>
              </p>
              <p className="flex items-center justify-between gap-2 sm:block">
                <span className="text-muted">{t('teachers.comp.remaining')}</span>
                <span
                  className="block font-semibold tabular-nums text-destructive"
                  data-testid="comp-remaining"
                >
                  {formatCurrency(detail.remaining_cents)}
                </span>
              </p>
              <p className="text-[12px] text-muted sm:pt-4">{t('teachers.comp.theoreticalNote')}</p>
            </div>
          </Card>

          <div className="space-y-2">
            <h3 className="text-btn font-medium text-foreground">{t('teachers.comp.settlements')}</h3>
            {settlements.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
                  title={t('teachers.comp.noSettlements')}
                  description={t('teachers.comp.noSettlementsHint')}
                />
              </Card>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[13px]" data-testid="teacher-settlements">
                  <thead className="bg-background text-label text-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-start font-medium">
                        {t('teachers.settlement.date')}
                      </th>
                      <th className="px-4 py-2.5 text-end font-medium">
                        {t('teachers.settlement.amount')}
                      </th>
                      <th className="px-4 py-2.5 text-start font-medium">
                        {t('teachers.settlement.method')}
                      </th>
                      <th className="px-4 py-2.5 text-start font-medium">
                        {t('teachers.settlement.notes')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((settlement) => (
                      <tr key={settlement.id} className="border-t border-border">
                        <td className="px-4 py-2.5 text-muted">
                          {formatDate(settlement.created_at)}
                        </td>
                        <td className="px-4 py-2.5 text-end font-medium tabular-nums text-success">
                          {formatCurrency(settlement.amount_cents)}
                        </td>
                        <td className="px-4 py-2.5 text-muted">
                          {methodLabel(t, settlement.payment_method)}
                        </td>
                        <td className="px-4 py-2.5 text-muted">{settlement.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {detail ? (
        <SettlementModal
          open={modalOpen}
          teacherId={teacherId}
          teacherName={teacherName}
          month={month}
          year={year}
          remainingCents={detail.remaining_cents}
          totalCents={detail.total_cents}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}

export default TeacherCompensationTab;
