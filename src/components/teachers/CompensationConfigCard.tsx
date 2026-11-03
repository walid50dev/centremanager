import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import MoneyInput from '../ui/MoneyInput';
import NumberInput from '../ui/NumberInput';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import { compensationApi } from '../../services/teachers';
import { cn, formatCurrency } from '../../utils/format';
import { percentageLabel } from '../../utils/compensation';
import type { CompensationMode, TeacherGroup } from '../../types';

export interface CompensationConfigCardProps {
  teacherId: number;
  groups: TeacherGroup[];
  config: { mode: CompensationMode; value_cents: number; bonus_pct: number | null } | null;
  /** Called after a successful save (refreshes the sheet). */
  onSaved?: () => void;
}

/** Tab 1 section: main compensation mode + optional recruitment bonus. */
export function CompensationConfigCard({
  teacherId,
  groups,
  config,
  onSaved,
}: CompensationConfigCardProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<CompensationMode>(config?.mode ?? 'fixed_monthly');
  const [amountCents, setAmountCents] = useState<number>(config?.value_cents ?? 0);
  const [bonusOn, setBonusOn] = useState<boolean>((config?.bonus_pct ?? 0) > 0);
  const [bonusPct, setBonusPct] = useState<string>(
    config?.bonus_pct ? String(config.bonus_pct) : '',
  );
  const [saving, setSaving] = useState(false);

  // Re-seed when the teacher (or their saved configuration) changes.
  useEffect(() => {
    setMode(config?.mode ?? 'fixed_monthly');
    setAmountCents(config?.value_cents ?? 0);
    setBonusOn((config?.bonus_pct ?? 0) > 0);
    setBonusPct(config?.bonus_pct ? String(config.bonus_pct) : '');
  }, [config?.mode, config?.value_cents, config?.bonus_pct, teacherId]);

  const bonusValue = Number.parseFloat(bonusPct);
  // An empty field right after enabling the toggle is not an error yet.
  const bonusEmpty = bonusPct.trim() === '';
  const bonusValid =
    !bonusOn ||
    bonusEmpty ||
    (Number.isFinite(bonusValue) && bonusValue >= 0 && bonusValue <= 100);
  const percentageValid = mode !== 'percentage' || (amountCents > 0 && amountCents <= 10_000);
  const canSave = amountCents > 0 && bonusValid && percentageValid && !saving;

  const theoretical = useMemo(
    () => groups.reduce((sum, group) => sum + group.monthly_fee_cents * group.enrolled_count, 0),
    [groups],
  );

  /** Quick local estimate — the real calculation is the backend's job. */
  const estimate = useMemo(() => {
    switch (mode) {
      case 'fixed_monthly':
        return amountCents;
      case 'percentage':
        return Math.round((theoretical * (amountCents / 100)) / 100);
      default:
        return 0;
    }
  }, [mode, amountCents, theoretical]);

  const bonusEstimate =
    bonusOn && Number.isFinite(bonusValue) && bonusValue > 0
      ? Math.round((theoretical * bonusValue) / 100)
      : 0;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await compensationApi.set({
        teacherId,
        mode,
        valueCents: amountCents,
        bonusPct: bonusOn && Number.isFinite(bonusValue) && bonusValue > 0 ? bonusValue : null,
      });
      toast.success(t('teachers.toast.compSaved'));
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [amountCents, bonusOn, bonusValue, canSave, mode, onSaved, t, teacherId]);

  const valueLabel =
    mode === 'fixed_monthly'
      ? t('teachers.valueFixed')
      : mode === 'hourly'
        ? t('teachers.valueHourly')
        : mode === 'per_session'
          ? t('teachers.valueSession')
          : t('teachers.valuePercentage');

  return (
    <Card className="border-primary/20 p-5" data-testid="compensation-config">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-h2 text-foreground">
          <span aria-hidden="true">💰</span>
          {t('teachers.compConfig')}
        </h3>
        {config ? (
          <Badge variant="primary">
            {mode === 'percentage'
              ? t('teachers.badgePercentage', { pct: percentageLabel(config.value_cents) })
              : t(`teachers.${mode === 'fixed_monthly' ? 'badgeFixed' : mode === 'hourly' ? 'badgeHourly' : 'badgeSession'}`, {
                  amount: formatCurrency(config.value_cents),
                })}
          </Badge>
        ) : (
          <Badge variant="muted">{t('teachers.notConfigured')}</Badge>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Select
          label={t('teachers.mainMode')}
          value={mode}
          onChange={(event) => {
            const next = event.target.value as CompensationMode;
            setMode(next);
            setAmountCents(0);
          }}
          options={[
            { value: 'fixed_monthly', label: t('teachers.fixedMonthly') },
            { value: 'hourly', label: t('teachers.hourly') },
            { value: 'per_session', label: t('teachers.perSession') },
            { value: 'percentage', label: t('teachers.percentage') },
          ]}
          data-testid="comp-mode"
        />

        {mode === 'percentage' ? (
          <NumberInput
            id="comp-pct"
            label={valueLabel}
            data-testid="comp-pct"
            decimals={1}
            min={0}
            max={100}
            step={0.5}
            suffix={t('common.suffix.percent')}
            /* The percentage lives in centimes-like hundredths in the API. */
            value={amountCents / 100}
            onChange={(next) => setAmountCents(Math.round(next * 100))}
            error={
              !percentageValid && amountCents > 10_000 ? t('teachers.validation.pctRange') : undefined
            }
          />
        ) : (
          <MoneyInput
            label={valueLabel}
            valueCents={amountCents}
            onChange={setAmountCents}
            data-testid="comp-amount"
          />
        )}
      </div>

      <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={bonusOn}
            onChange={(event) => {
              setBonusOn(event.target.checked);
              if (!event.target.checked) setBonusPct('');
            }}
            data-testid="comp-bonus-toggle"
          />
          <span className="text-[13px] font-medium text-foreground">{t('teachers.bonus')}</span>
        </label>

        {bonusOn ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <NumberInput
              id="comp-bonus"
              label={t('teachers.bonusPct')}
              data-testid="comp-bonus-pct"
              decimals={1}
              min={0}
              max={100}
              step={0.5}
              suffix={t('common.suffix.percent')}
              value={bonusPct.trim() === '' ? Number.NaN : Number(bonusPct)}
              onChange={(next) => setBonusPct(Number.isFinite(next) ? String(next) : '')}
              error={!bonusValid && !bonusEmpty ? t('teachers.validation.pctRange') : undefined}
            />
            <p className="self-end pb-1 text-[12px] leading-5 text-muted">
              {t('teachers.bonusHint')}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted">{t('teachers.compRuntimeNote')}</p>
        <Button onClick={() => void save()} loading={saving} disabled={!canSave} data-testid="comp-save">
          {t('teachers.saveComp')}
        </Button>
      </div>

      <div className="mt-4 rounded-md bg-muted/10 p-3" data-testid="comp-estimate">
        <p className="flex items-center gap-1.5 text-label text-muted">
          <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
          {t('teachers.estimate')}
        </p>
        {groups.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted">{t('teachers.noGroups')}</p>
        ) : (
          <div className="mt-1 space-y-1 text-[13px]">
            <p className="text-muted">
              {t('teachers.estimateGroups', {
                count: groups.length,
                theoretical: formatCurrency(theoretical),
              })}
            </p>
            {mode === 'hourly' || mode === 'per_session' ? (
              <p className="text-muted">{t('teachers.estimateNeedsActivities')}</p>
            ) : (
              <p className={cn('font-semibold tabular-nums text-foreground')}>
                {formatCurrency(estimate + bonusEstimate)}
                {bonusEstimate > 0 ? (
                  <span className="ms-2 text-[12px] font-normal text-warning">
                    {t('teachers.estimateBonus', { bonus: formatCurrency(bonusEstimate) })}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default CompensationConfigCard;
