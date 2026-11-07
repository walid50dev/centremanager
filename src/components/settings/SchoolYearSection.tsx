import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Plus, Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useAppStore } from '../../stores/appStore';
import Button from '../ui/Button';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import Select from '../ui/Select';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { schoolYearsApi, settingsApi } from '../../services/settings';
import { downloadExcel, type ExportSection } from '../../services/yearExport';
import { downloadYearPdf } from '../year-export/yearPdf';
import { formatDate } from '../../utils/format';
import type { SchoolYear } from '../../types';

/** Section 2 — school years, with exactly one active year. */
export function SchoolYearSection() {
  const { t, i18n } = useTranslation();

  const [years, setYears] = useState<SchoolYear[]>([]);
  const [fee, setFee] = useState(0);
  const [savingFee, setSavingFee] = useState(false);
  const [feeReady, setFeeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [deleteYear, setDeleteYear] = useState<SchoolYear | null>(null);
  const [deleting, setDeleting] = useState(false);
  const switchYear = useAppStore(state => state.switchSchoolYear);
  const loadYears = useAppStore(state => state.loadSchoolYears);

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

  useEffect(() => {
    setFeeReady(false);
    if (!activeYear) return;
    let live = true;
    settingsApi.getEnrollmentFee().then(value => { if (live) { setFee(value); setFeeReady(true); } })
      .catch(error => { if (live) toast.error(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [activeYear?.id]);

  const saveFee = async () => {
    if (!activeYear || !feeReady) return;
    setSavingFee(true);
    try { await settingsApi.setEnrollmentFee(fee, activeYear.id); toast.success(t('settings.enrollment_fee_saved')); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setSavingFee(false); }
  };

  const handleActivate = async (id: number) => {
    setActivatingId(id);
    try {
      await switchYear(id);
      setPendingId(null);
      await load();
      toast.success(t('settings.schoolYear.activated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteYear || deleting) return;
    setDeleting(true);
    try { await schoolYearsApi.remove(deleteYear.id); setDeleteYear(null); await Promise.all([loadYears(), load()]); toast.success(t('school_year.deleted')); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setDeleting(false); }
  };

  const handleExport = async (year: SchoolYear, section: ExportSection | 'pdf') => {
    if (exporting !== null) return;
    setExporting(year.id);
    try {
      if (section === 'pdf') {
        await downloadYearPdf(year.id, year.label ?? '', {
          title: t('export.summary', { year: year.label ?? '' }),
          students: t('export.section_students'), groups: t('export.section_groups'), teachers: t('export.section_teachers'),
          revenue: t('export.revenue'), expenses: t('export.section_expenses'), salaries: t('export.section_salaries'),
          net: t('export.net'), subject: t('export.subject'), note: t('export.note'),
        }, i18n.language === 'ar');
      } else await downloadExcel(year.id, year.label ?? '', section);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(null); }
  };

  const handleCreate = async () => {
    setFormError(null);
    setShowFieldErrors(true);
    if (!label.trim() || !startDate || !endDate || endDate <= startDate) return;

    setSubmitting(true);
    try {
      await schoolYearsApi.create(label.trim(), startDate, endDate);
      await loadYears();
      setLabel('');
      setStartDate('');
      setEndDate('');
      setShowFieldErrors(false);
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
      <ConfirmDialog open={pendingId !== null} title={t('schoolYearSwitch.title')} message={t('schoolYearSwitch.message', { year: years.find(year => year.id === pendingId)?.label ?? '' })}
        confirmLabel={t('schoolYearSwitch.confirm')} cancelLabel={t('common.cancel')} destructive={false} loading={activatingId !== null}
        onClose={() => { if (activatingId === null) setPendingId(null); }} onConfirm={() => { if (pendingId !== null) void handleActivate(pendingId); }} />
      <ConfirmDialog open={deleteYear !== null} title={t('school_year.delete')} message={`${t('school_year.delete_confirm', { label: deleteYear?.label ?? '' })} ${t('school_year.ambiguous_note')}`}
        confirmLabel={t('school_year.delete')} cancelLabel={t('common.cancel')} loading={deleting}
        onClose={() => { if (!deleting) setDeleteYear(null); }} onConfirm={() => void handleDelete()} />
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
              if (Number.isFinite(id) && id > 0 && id !== activeYear?.id) setPendingId(id);
            }}
          />

          {activeYear && <div className="mt-4 flex flex-wrap items-end gap-3">
            <MoneyInput label={t('settings.enrollment_fee_label')} hint={t('settings.enrollment_fee_hint')}
              valueCents={fee} onChange={setFee} disabled={!feeReady || savingFee} data-testid="enrollment-fee-input" />
            <Button onClick={() => void saveFee()} disabled={!feeReady} loading={savingFee} data-testid="enrollment-fee-save">{t('common.save')}</Button>
          </div>}

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
                <Button size="sm" variant="secondary" disabled={exporting !== null} onClick={() => void handleExport(year, 'pdf')} data-testid={`year-pdf-${year.id}`}>📄 {exporting === year.id ? t('export.generating') : t('export.pdf')}</Button>
                <select aria-label={t('export.excel')} data-testid={`year-excel-${year.id}`} value="" disabled={exporting !== null}
                  className="h-8 max-w-[170px] rounded border border-border bg-white px-2 text-[13px]" onChange={event => {
                    if (event.target.value) void handleExport(year, event.target.value as ExportSection);
                  }}>
                  <option value="">📊 {t('export.excel')}</option>
                  {(['students','groups','teachers','payments','expenses','salaries'] as const).map(section => <option key={section} value={section}>{t(`export.section_${section}`)}</option>)}
                </select>
                <span title={year.is_active ? t('school_year.cannot_delete_active') : t('school_year.delete')}>
                  <Button size="icon" variant="ghost" aria-label={year.is_active ? t('school_year.cannot_delete_active') : t('school_year.delete')}
                    data-testid={`year-delete-${year.id}`} disabled={year.is_active || deleting} onClick={() => setDeleteYear(year)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </span>
                {!year.is_active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={activatingId === year.id}
                    onClick={() => setPendingId(year.id)}
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
                    required
                    error={showFieldErrors && !label.trim() ? t('settings.schoolYear.labelRequired') : undefined}
                    placeholder={t('settings.schoolYear.labelPlaceholder')}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                  <Input
                    type="date"
                    label={t('settings.schoolYear.startDate')}
                    required
                    error={showFieldErrors && !startDate ? t('settings.schoolYear.datesRequired') : undefined}
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                  <Input
                    type="date"
                    label={t('settings.schoolYear.endDate')}
                    required
                    error={showFieldErrors && !endDate ? t('settings.schoolYear.datesRequired') : showFieldErrors && startDate && endDate <= startDate ? t('settings.schoolYear.invalidDates') : undefined}
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
                      setShowFieldErrors(false);
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
