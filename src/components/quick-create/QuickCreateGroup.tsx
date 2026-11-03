import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import CreatableSelect from '../ui/CreatableSelect';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import NumberInput from '../ui/NumberInput';
import { toast } from '../ui/Toast';
import { groupsApi } from '../../services/groups';
import { WEEK_DAYS, shortDayLabel } from '../../utils/schedule';
import { cn } from '../../utils/format';
import { levelsApi, schoolYearsApi, subjectsApi } from '../../services/settings';
import { amountToCents, centsToAmount } from '../../utils/format';
import type { Group, GroupInput, GroupSchedule, Level, Subject, TeacherOption } from '../../types';
import QuickCreateShell from './QuickCreateShell';
import QuickCreateLevel from './QuickCreateLevel';
import QuickCreateSubject from './QuickCreateSubject';
import QuickCreateTeacher from './QuickCreateTeacher';

export interface QuickCreateGroupProps {
  open?: boolean;
  zIndex?: number;
  onCreated: (group: Group) => void;
  onClose: () => void;
}

interface TimeRange {
  start: string;
  end: string;
}

interface FormState {
  /** Ticked weekdays, in week order (Phase 13). */
  days: string[];
  /** One range for every ticked day, or one per day when off. */
  sameHours: boolean;
  startTime: string;
  endTime: string;
  perDay: Record<string, TimeRange>;
  fee: string;
  capacity: string;
}

const DEFAULT_RANGE: TimeRange = { start: '16:00', end: '18:00' };

const EMPTY_FORM: FormState = {
  days: ['Lundi'],
  sameHours: true,
  startTime: DEFAULT_RANGE.start,
  endTime: DEFAULT_RANGE.end,
  perDay: Object.fromEntries(WEEK_DAYS.map((day) => [day, { ...DEFAULT_RANGE }])),
  fee: '',
  capacity: '10',
};

/** The schedule rows for the ticked days, Monday first. */
function scheduleRows(form: FormState): GroupSchedule[] {
  return WEEK_DAYS.filter((day) => form.days.includes(day)).map((day, index) => {
    const range = form.sameHours
      ? { start: form.startTime, end: form.endTime }
      : (form.perDay[day] ?? DEFAULT_RANGE);
    return { id: index, day_of_week: day, start_time: range.start, end_time: range.end };
  });
}

/**
 * “Nouveau groupe (rapide)” — two steps, because a group without a schedule and
 * a fee cannot be enrolled into.
 *
 * Step 1 (subject, level, teacher) uses `CreatableSelect`, so a missing subject
 * or level can be added without leaving the wizard: that is the **one** level of
 * nesting the app allows. The modals it opens sit one layer higher (`z-70`) and
 * use plain selects themselves, so the stack can never grow a third dialog.
 */
export function QuickCreateGroup({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateGroupProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState<1 | 2>(1);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [teacher, setTeacher] = useState<TeacherOption | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<{
    fee?: string;
    capacity?: string;
    endTime?: string;
    schedule?: string;
  }>({});
  const [saving, setSaving] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [schoolYearId, setSchoolYearId] = useState<number | null>(null);

  // Nested quick-creates (one level only).
  const [showSubject, setShowSubject] = useState(false);
  const [showLevel, setShowLevel] = useState(false);
  const [showTeacher, setShowTeacher] = useState(false);

  const loadSubjects = useCallback(async () => {
    const rows = await subjectsApi.list();
    setSubjects(rows.filter((row) => row.is_active));
  }, []);
  const loadLevels = useCallback(async () => {
    setLevels(await levelsApi.list());
  }, []);
  const loadTeachers = useCallback(async () => {
    setTeachers(await groupsApi.teachers());
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubject(null);
    setLevel(null);
    setTeacher(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setSaving(false);
    setShowSubject(false);
    setShowLevel(false);
    setShowTeacher(false);

    let active = true;
    Promise.all([subjectsApi.list(), levelsApi.list(), groupsApi.teachers(), schoolYearsApi.list()])
      .then(([subjectRows, levelRows, teacherRows, years]) => {
        if (!active) return;
        setSubjects(subjectRows.filter((row) => row.is_active));
        setLevels(levelRows);
        setTeachers(teacherRows);
        const activeYear = years.find((year) => year.is_active) ?? years[0];
        setSchoolYearId(activeYear ? activeYear.id : null);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [open]);

  const canGoNext = useMemo(() => Boolean(subject && level), [level, subject]);

  const validateStep2 = useCallback((): typeof errors => {
    const next: typeof errors = {};
    const rows = scheduleRows(form);
    if (rows.length === 0) {
      next.schedule = t('groups.validation.atLeastOneDay');
    } else {
      const reversed = rows.find((row) => !row.start_time || !row.end_time || row.end_time <= row.start_time);
      if (reversed) {
        next.schedule = form.sameHours
          ? t('quickCreate.validation.endAfterStart')
          : t('groups.validation.endAfterStartDay', {
              day: t(`groups.dayNames.${reversed.day_of_week}`),
            });
      }
    }
    const fee = amountToCents(form.fee);
    if (!form.fee.trim() || fee <= 0) next.fee = t('quickCreate.validation.feePositive');
    const capacity = Number.parseInt(form.capacity, 10);
    if (!Number.isFinite(capacity) || capacity < 1) {
      next.capacity = t('quickCreate.validation.capacityPositive');
    }
    return next;
  }, [form, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!subject || !level) {
        setStep(1);
        return;
      }
      if (!schoolYearId) {
        toast.error(t('quickCreate.noSchoolYear'));
        return;
      }
      const nextErrors = validateStep2();
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const schedules = scheduleRows(form);
      const first = schedules[0];
      const payload: GroupInput = {
        subject_id: subject.id,
        level_id: level.id,
        branch_id: null,
        teacher_id: teacher ? teacher.id : null,
        school_year_id: schoolYearId,
        day_of_week: first.day_of_week,
        start_time: first.start_time,
        end_time: first.end_time,
        schedules,
        room: null,
        monthly_fee_cents: amountToCents(form.fee),
        capacity: Number.parseInt(form.capacity, 10),
      };

      setSaving(true);
      try {
        const id = await groupsApi.create(payload);
        const detail = await groupsApi.detail(id);
        toast.success(
          t('quickCreate.created', { entity: `${detail.group.subject_name} — ${detail.group.level_name}` }),
        );
        onCreated(detail.group);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSaving(false);
      }
    },
    [form, level, onCreated, schoolYearId, subject, t, teacher, validateStep2],
  );

  return (
    <>
      <QuickCreateShell
        open={open}
        zIndex={zIndex}
        testId="quick-create-group"
        title={t('quickCreate.group.title')}
        description={t('quickCreate.group.description')}
        formId="quick-group-form"
        saving={saving}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            {step === 2 ? (
              <Button variant="secondary" onClick={() => setStep(1)} disabled={saving}>
                {t('common.previous')}
              </Button>
            ) : null}
            {step === 1 ? (
              <Button
                onClick={() => setStep(2)}
                disabled={!canGoNext}
                data-testid="quick-group-next"
              >
                {t('common.next')}
              </Button>
            ) : (
              <Button
                type="submit"
                form="quick-group-form"
                loading={saving}
                disabled={saving}
                data-testid="quick-group-create"
              >
                {t('common.create')}
              </Button>
            )}
          </>
        }
      >
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">
          {t('quickCreate.group.step', { current: step, total: 2 })} ·{' '}
          {step === 1 ? t('quickCreate.group.basics') : t('quickCreate.group.schedule')}
        </p>

        <form id="quick-group-form" onSubmit={handleSubmit} noValidate className="space-y-4">
          {step === 1 ? (
            <>
              <CreatableSelect
                testId="quick-group-subject"
                label={t('quickCreate.fields.subject')}
                required
                placeholder={t('groups.selectSubject')}
                options={subjects}
                value={subject}
                onChange={setSubject}
                getOptionLabel={(option) => option.name}
                getOptionValue={(option) => option.id}
                onCreate={() => setShowSubject(true)}
              />

              <CreatableSelect
                testId="quick-group-level"
                label={t('quickCreate.fields.level')}
                required
                placeholder={t('groups.selectLevel')}
                options={levels}
                value={level}
                onChange={setLevel}
                getOptionLabel={(option) => option.name}
                getOptionValue={(option) => option.id}
                onCreate={() => setShowLevel(true)}
              />

              <CreatableSelect
                testId="quick-group-teacher"
                label={t('quickCreate.fields.teacher')}
                placeholder={t('groups.noTeacher')}
                options={teachers}
                value={teacher}
                onChange={setTeacher}
                getOptionLabel={(option) => option.full_name}
                getOptionValue={(option) => option.id}
                onCreate={() => setShowTeacher(true)}
                clearable
              />
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-background px-3 py-2 text-[13px]">
                <span className="font-medium text-foreground">{subject?.name}</span>
                <span className="text-muted"> — {level?.name}</span>
                {teacher ? <span className="text-muted"> · {teacher.full_name}</span> : null}
              </div>

              {/* ------------------------------------------- days of the week */}
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-foreground">
                  {t('groups.schedules')} <span className="text-destructive">*</span>
                </p>
                <div className="flex flex-wrap gap-1.5" data-testid="quick-group-days">
                  {WEEK_DAYS.map((day) => {
                    const checked = form.days.includes(day);
                    return (
                      <label
                        key={day}
                        title={t(`groups.dayNames.${day}`)}
                        data-testid={`quick-group-day-${day}`}
                        data-enabled={checked ? 'true' : 'false'}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium',
                          checked
                            ? 'border-primary/40 bg-primary/5 text-foreground'
                            : 'border-border bg-slate-50/60 text-muted',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary"
                          checked={checked}
                          onChange={(event) => {
                            setForm((current) => ({
                              ...current,
                              days: event.target.checked
                                ? WEEK_DAYS.filter(
                                    (name) => name === day || current.days.includes(name),
                                  )
                                : current.days.filter((name) => name !== day),
                            }));
                            setErrors((current) => ({ ...current, schedule: undefined }));
                          }}
                          data-testid={`quick-group-day-${day}-toggle`}
                        />
                        <span dir="auto">{shortDayLabel(t, day)}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.schedule ? (
                  <p
                    className="mt-1 text-[12px] text-destructive"
                    role="alert"
                    data-testid="quick-group-schedule-error"
                  >
                    {errors.schedule}
                  </p>
                ) : null}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.sameHours}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sameHours: event.target.checked }))
                  }
                  data-testid="quick-group-same-hours"
                />
                {t('groups.sameHours')}
              </label>

              {form.sameHours ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('quickCreate.fields.startTime')}
                    required
                    type="time"
                    value={form.startTime}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, startTime: event.target.value }));
                      setErrors((current) => ({ ...current, schedule: undefined }));
                    }}
                    data-testid="quick-group-start"
                  />
                  <Input
                    label={t('quickCreate.fields.endTime')}
                    required
                    type="time"
                    value={form.endTime}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, endTime: event.target.value }));
                      setErrors((current) => ({ ...current, schedule: undefined }));
                    }}
                    error={errors.schedule && form.sameHours ? errors.schedule : errors.endTime}
                    data-testid="quick-group-end"
                  />
                </div>
              ) : (
                <div className="space-y-1.5" data-testid="quick-group-per-day">
                  {scheduleRows(form).map((row) => (
                    <div key={row.day_of_week} className="flex items-center gap-2">
                      <span className="w-12 text-[12px] font-medium text-muted">
                        {shortDayLabel(t, row.day_of_week)}
                      </span>
                      <input
                        type="time"
                        aria-label={`${t(`groups.dayNames.${row.day_of_week}`)} — ${t('groups.startTime')}`}
                        value={row.start_time}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            perDay: {
                              ...current.perDay,
                              [row.day_of_week]: {
                                ...(current.perDay[row.day_of_week] ?? DEFAULT_RANGE),
                                start: event.target.value,
                              },
                            },
                          }))
                        }
                        data-testid={`quick-group-${row.day_of_week}-start`}
                        className="w-28 rounded-md border border-border bg-white px-2 py-1 text-[13px]"
                      />
                      <input
                        type="time"
                        aria-label={`${t(`groups.dayNames.${row.day_of_week}`)} — ${t('groups.endTime')}`}
                        value={row.end_time}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            perDay: {
                              ...current.perDay,
                              [row.day_of_week]: {
                                ...(current.perDay[row.day_of_week] ?? DEFAULT_RANGE),
                                end: event.target.value,
                              },
                            },
                          }))
                        }
                        data-testid={`quick-group-${row.day_of_week}-end`}
                        className="w-28 rounded-md border border-border bg-white px-2 py-1 text-[13px]"
                      />
                    </div>
                  ))}
                </div>
              )}

              <MoneyInput
                label={t('quickCreate.fields.fee')}
                required
                step={50}
                valueCents={amountToCents(form.fee)}
                onChange={(cents) => {
                  setForm((current) => ({ ...current, fee: cents === 0 ? '' : centsToAmount(cents) }));
                  setErrors((current) => ({ ...current, fee: undefined }));
                }}
                error={errors.fee}
                data-testid="quick-group-fee"
              />

              <NumberInput
                label={t('quickCreate.fields.capacity')}
                required
                decimals={0}
                min={1}
                max={200}
                step={1}
                suffix={t('common.suffix.students')}
                value={form.capacity === '' ? Number.NaN : Number(form.capacity)}
                onChange={(next) => {
                  setForm((current) => ({
                    ...current,
                    capacity: Number.isFinite(next) && next > 0 ? String(next) : '',
                  }));
                  setErrors((current) => ({ ...current, capacity: undefined }));
                }}
                error={errors.capacity}
                data-testid="quick-group-capacity"
              />
            </>
          )}
        </form>
      </QuickCreateShell>

      {/* One level of nesting: z-70, plain selects inside, no further create. */}
      {showSubject ? (
        <QuickCreateSubject
          zIndex={zIndex + 10}
          onClose={() => setShowSubject(false)}
          onCreated={(created) => {
            setShowSubject(false);
            void loadSubjects();
            setSubject(created);
          }}
        />
      ) : null}

      {showLevel ? (
        <QuickCreateLevel
          zIndex={zIndex + 10}
          onClose={() => setShowLevel(false)}
          onCreated={(created) => {
            setShowLevel(false);
            void loadLevels();
            setLevel(created);
          }}
        />
      ) : null}

      {showTeacher ? (
        <QuickCreateTeacher
          zIndex={zIndex + 10}
          onClose={() => setShowTeacher(false)}
          onCreated={(created) => {
            setShowTeacher(false);
            void loadTeachers();
            setTeacher(created);
          }}
        />
      ) : null}
    </>
  );
}

export default QuickCreateGroup;
