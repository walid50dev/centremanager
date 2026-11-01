import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Plus } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { schoolYearsApi } from '../../services/settings';
import { formatDate } from '../../utils/format';
import type { SchoolYear } from '../../types';

/** Section 2 — school years, with exactly one active year. */
export function SchoolYearSection() {
  const { t } = useTranslation();

  const [years, setYears] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setYears(await schoolYearsApi.list());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeYear = years.find((year) => year.is_active) ?? null;

  const handleActivate = async (id: number) => {
    setActivatingId(id);
    try {
      await schoolYearsApi.setActive(id);
      await load();
      toast.success(t('settings.schoolYear.activated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setActivatingId(null);
    }
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!label.trim()) {
      setFormError(t('settings.schoolYear.labelRequired'));
      return;
    }
    if (!startDate || !endDate) {
      setFormError(t('settings.schoolYear.datesRequired'));
      return;
    }
    if (endDate <= startDate) {
      setFormError(t('settings.schoolYear.invalidDates'));
      return;
    }

    setSubmitting(true);
    try {
      await schoolYearsApi.create(label.trim(), startDate, endDate);
      setLabel('');
      setStartDate('');
      setEndDate('');
      setFormOpen(false);
      await load();
      toast.success(t('settings.schoolYear.created'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.error');
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsSection
      icon={<CalendarDays className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.schoolYear')}
      description={t('settings.schoolYear.description')}
    >
      {loading ? (
        <p className="text-[13px] text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <Select
            label={t('settings.schoolYear.activeYear')}
            value={activeYear?.id ?? ''}
            placeholder={t('settings.schoolYear.none')}
            options={years.map((year) => ({ value: year.id, label: year.label ?? '' }))}
            onChange={(event) => {
              const id = Number(event.target.value);
              if (Number.isFinite(id) && id > 0) void handleActivate(id);
            }}
          />

          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {years.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-muted">
                {t('settings.schoolYear.empty')}
              </li>
            )}
            {years.map((year) => (
              <li key={year.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-btn font-medium text-foreground">
                    {year.label}
                    {year.is_active && (
                      <Badge variant="success" className="badge-success">
                        <span aria-hidden="true">🟢</span>
                        {t('settings.schoolYear.active')}
                      </Badge>
                    )}
                  </p>
                  <p className="text-[12px] text-muted">
                    {formatDate(year.start_date)} → {formatDate(year.end_date)}
                  </p>
                </div>
                {!year.is_active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={activatingId === year.id}
                    onClick={() => void handleActivate(year.id)}
                    leftIcon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {t('settings.schoolYear.activate')}
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4">
            {!formOpen ? (
              <Button
                variant="secondary"
                onClick={() => setFormOpen(true)}
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('settings.schoolYear.new')}
              </Button>
            ) : (
              <div className="rounded-md border border-border bg-background p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label={t('settings.schoolYear.label')}
                    placeholder={t('settings.schoolYear.labelPlaceholder')}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                  <Input
                    type="date"
                    label={t('settings.schoolYear.startDate')}
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                  <Input
                    type="date"
                    label={t('settings.schoolYear.endDate')}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
                {formError && (
                  <p className="mt-2 text-[13px] text-destructive" role="alert">
                    {formError}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button onClick={handleCreate} loading={submitting} size="sm">
                    {t('settings.schoolYear.create')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFormOpen(false);
                      setFormError(null);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}

export default SchoolYearSection;
