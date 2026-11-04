import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import Button from '../ui/Button';
import ScheduleConflictWarnings from './ScheduleConflictWarnings';
import CreatableEntitySelect from '../ui/CreatableEntitySelect';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import NumberInput from '../ui/NumberInput';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import LevelModal from '../entity-modals/LevelModal';
import BranchModal from '../entity-modals/BranchModal';
import SubjectModal from '../entity-modals/SubjectModal';
import TeacherModal from '../teachers/TeacherModal';
import { groupsApi } from '../../services/groups';
import { WEEK_DAYS, formatSchedules, scheduleSlots, shortDayLabel } from '../../utils/schedule';
import { cn } from '../../utils/format';
import { levelsApi, schoolYearsApi, subjectsApi } from '../../services/settings';
import { amountToCents, centsToAmount } from '../../utils/format';
import type {
  Branch,
  Group,
  GroupInput,
  GroupSchedule,
  Level,
  SchoolYear,
  Subject,
  TeacherOption,
} from '../../types';

export interface GroupModalProps {
  open: boolean;
  /** `null` = create mode, otherwise the group being edited. */
  group?: Group | null;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (id: number) => void;
  zIndex?: number;
}

/** One weekday of the week editor (Phase 13). */
interface DaySlot {
  enabled: boolean;
  start: string;
  end: string;
}
type Week = Record<string, DaySlot>;

interface FormState {
  subjectId: string;
  levelId: string;
  branchId: string;
  teacherId: string;
  schoolYearId: string;
  /** The whole week, keyed by canonical weekday name. */
  week: Week;
  room: string;
  fee: string;
  capacity: string;
}

type FieldName = keyof FormState;
/** `schedule` is the shared error line under the week editor. */
type Errors = Partial<Record<FieldName | 'schedule', string>>;

/** A week with no class on any day; Monday is ticked by default (the old default). */
const EMPTY_WEEK: Week = Object.fromEntries(
  WEEK_DAYS.map((day) => [day, { enabled: false, start: '16:00', end: '18:00' }]),
);

const EMPTY_FORM: FormState = {
  subjectId: '',
  levelId: '',
  branchId: '',
  teacherId: '',
  schoolYearId: '',
  week: { ...EMPTY_WEEK, Lundi: { enabled: true, start: '16:00', end: '18:00' } },
  room: '',
  fee: '',
  capacity: '10',
};

/** Prefill the week editor from a stored group (falls back to the legacy slot). */
function weekFromGroup(group: Group): Week {
  const week: Week = JSON.parse(JSON.stringify(EMPTY_WEEK)) as Week;
  scheduleSlots(group).forEach((slot) => {
    if (!week[slot.day_of_week]) return;
    week[slot.day_of_week] = {
      enabled: true,
      start: slot.start_time,
      end: slot.end_time,
    };
  });
  return week;
}

/** The ticked days, Monday first, in the shape the backend expects. */
function weekPayload(week: Week): GroupSchedule[] {
  return WEEK_DAYS.filter((day) => week[day]?.enabled).map((day, index) => ({
    id: index,
    day_of_week: day,
    start_time: week[day]?.start ?? '16:00',
    end_time: week[day]?.end ?? '18:00',
  }));
}

/** Create / edit a group. Levels drive the branch list, like the student form. */
export function GroupModal({ open, group = null, onClose, onSaved, onCreated, zIndex = 50 }: GroupModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(group);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);

  // Quick-create dialogs stacked above this form (one level, `z-60`).
  const [quickCreate, setQuickCreate] = useState<'teacher' | 'subject' | 'level' | 'branch' | null>(null);

  // Reference data is fetched once per opening; the three loaders are reused
  // after a quick-create so the new row appears in its dropdown.
  const loadSubjects = useCallback(async () => {
    const rows = await subjectsApi.list();
    setSubjects(rows.filter((subject) => subject.is_active));
  }, []);

  const loadLevels = useCallback(async () => {
    setLevels(await levelsApi.list());
  }, []);

  const loadTeachers = useCallback(async () => {
    setTeachers(await groupsApi.teachers());
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([
      subjectsApi.list(),
      levelsApi.list(),
      levelsApi.branches(),
      groupsApi.teachers(),
      schoolYearsApi.list(),
    ])
      .then(([subjectList, levelList, branchList, teacherList, yearList]) => {
        if (!active) return;
        setSubjects(subjectList.filter((subject) => subject.is_active));
        setLevels(levelList);
        setBranches(branchList);
        setTeachers(teacherList);
        setSchoolYears(yearList);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Close the quick-create dialogs with the form.
  useEffect(() => {
    if (!open) setQuickCreate(null);
  }, [open]);

  // Reset (or prefill) whenever the modal opens — once per opening.
  //
  // The guard matters since Phase 13: re-running this effect (the parent can
  // hand over a fresh `group` object, or the year list can arrive late) would
  // silently throw away the days the user just ticked.
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      prefilled.current = null;
      return;
    }
    const activeYear = schoolYears.find((year) => year.is_active) ?? schoolYears[0];
    const key = group ? `group:${group.id}` : `new:${activeYear?.id ?? ''}`;
    if (prefilled.current === key) return;
    prefilled.current = key;

    setErrors({});
    if (group) {
      setForm({
        subjectId: group.subject_id ? String(group.subject_id) : '',
        levelId: group.level_id ? String(group.level_id) : '',
        branchId: group.branch_id ? String(group.branch_id) : '',
        teacherId: group.teacher_id ? String(group.teacher_id) : '',
        schoolYearId: group.school_year_id ? String(group.school_year_id) : '',
        week: weekFromGroup(group),
        room: group.room ?? '',
        fee: centsToAmount(group.monthly_fee_cents),
        capacity: String(group.capacity),
      });
    } else {
      setForm({ ...EMPTY_FORM, schoolYearId: activeYear ? String(activeYear.id) : '' });
    }
  }, [open, group, schoolYears]);

  // A group can reference a branch that no longer belongs to its level (imported
  // or legacy data edited in settings). The select cannot display such an option,
  // so the raw id would be submitted back unchanged and rejected by the backend
  // with "La branche ne correspond pas au niveau sélectionné". Drop it instead,
  // so the form shows what it is actually going to save.
  useEffect(() => {
    if (!open || !form.branchId || branches.length === 0) return;
    const belongsToLevel = branches.some(
      (branch) => String(branch.id) === form.branchId && String(branch.level_id) === form.levelId,
    );
    if (!belongsToLevel) setForm((current) => ({ ...current, branchId: '' }));
  }, [open, branches, form.branchId, form.levelId]);

  const levelBranches = useMemo(
    () => branches.filter((branch) => String(branch.level_id) === form.levelId),
    [branches, form.levelId],
  );

  const set = useCallback(<K extends FieldName>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }, []);

  /** Patch one weekday of the week editor. */
  const setWeekDay = useCallback((day: string, patch: Partial<DaySlot>) => {
    setForm((current) => ({
      ...current,
      week: {
        ...current.week,
        [day]: { ...(current.week[day] ?? EMPTY_WEEK[day]), ...patch },
      },
    }));
    setErrors((current) => ({ ...current, schedule: undefined }));
  }, []);

  const validate = useCallback((): Errors => {
    const next: Errors = {};
    if (!form.subjectId) next.subjectId = t('groups.validation.subjectRequired');
    if (!form.levelId) next.levelId = t('groups.validation.levelRequired');
    if (!form.schoolYearId) next.schoolYearId = t('groups.validation.schoolYearRequired');
    const activeDays = WEEK_DAYS.filter((day) => form.week[day]?.enabled);
    if (activeDays.length === 0) {
      next.schedule = t('groups.validation.atLeastOneDay');
    } else {
      const incomplete = activeDays.find((day) => {
        const slot = form.week[day];
        return !slot.start || !slot.end;
      });
      const reversed = activeDays.find((day) => {
        const slot = form.week[day];
        return slot.start && slot.end && slot.end <= slot.start;
      });
      if (incomplete) {
        next.schedule = t('groups.validation.scheduleIncomplete', {
          day: t(`groups.dayNames.${incomplete}`),
        });
      } else if (reversed) {
        next.schedule = t('groups.validation.endAfterStartDay', {
          day: t(`groups.dayNames.${reversed}`),
        });
      }
    }
    const fee = amountToCents(form.fee);
    if (!form.fee.trim() || fee <= 0) next.fee = t('groups.validation.feePositive');
    const capacity = Number.parseInt(form.capacity, 10);
    if (!Number.isFinite(capacity) || capacity < 1) {
      next.capacity = t('groups.validation.capacityPositive');
    }
    return next;
  }, [form, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const nextErrors = validate();
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const schedules = weekPayload(form.week);
      const first = schedules[0];
      const payload: GroupInput = {
        subject_id: Number(form.subjectId),
        level_id: Number(form.levelId),
        branch_id: form.branchId ? Number(form.branchId) : null,
        teacher_id: form.teacherId ? Number(form.teacherId) : null,
        school_year_id: Number(form.schoolYearId),
        // The legacy triple mirrors the first day, like the backend does.
        day_of_week: first?.day_of_week ?? '',
        start_time: first?.start_time ?? '',
        end_time: first?.end_time ?? '',
        schedules,
        room: form.room.trim() || null,
        monthly_fee_cents: amountToCents(form.fee),
        capacity: Number.parseInt(form.capacity, 10),
      };

      setSaving(true);
      try {
        if (isEdit && group) {
          await groupsApi.update(group.id, payload);
          toast.success(t('groups.toast.updated'));
        } else {
          const id = await groupsApi.create(payload);
          onCreated?.(id);
          toast.success(t('groups.toast.created'));
        }
        onSaved();
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    },
    [form, group, isEdit, onClose, onSaved, onCreated, t, validate],
  );

  const conflictSchedules = useMemo(() => weekPayload(form.week).map(slot => ({
    day: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time,
  })), [form.week]);

  // The form keeps ids; the dropdowns work with objects.
  const selectedSubject = useMemo(
    () => subjects.find((subject) => String(subject.id) === form.subjectId) ?? null,
    [form.subjectId, subjects],
  );
  const selectedLevel = useMemo(
    () => levels.find((level) => String(level.id) === form.levelId) ?? null,
    [form.levelId, levels],
  );
  const selectedTeacher = useMemo(
    () => teachers.find((teacher) => String(teacher.id) === form.teacherId) ?? null,
    [form.teacherId, teachers],
  );

  return (
    <>
      <Modal
      open={open}
      onClose={onClose}
      size="lg"
      zIndex={zIndex}
      title={
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          {isEdit ? t('groups.edit') : t('groups.new')}
        </span>
      }
      description={t('groups.formHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="group-form" loading={saving}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="group-form"
        onSubmit={handleSubmit}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <ScheduleConflictWarnings open={open} groupId={group?.id ?? null} teacherId={form.teacherId ? Number(form.teacherId) : null} room={form.room} schoolYearId={form.schoolYearId ? Number(form.schoolYearId) : null} schedules={conflictSchedules} />
        <CreatableEntitySelect
          testId="group-subject"
          label={t('groups.subject')}
          required
          placeholder={t('groups.selectSubject')}
          options={subjects}
          value={selectedSubject}
          onChange={(subject) => set('subjectId', subject ? String(subject.id) : '')}
          getOptionLabel={(subject) => subject.name}
          getOptionValue={(subject) => subject.id}
          onCreate={() => setQuickCreate('subject')}
          disableCreate={zIndex >= 70}
          searchable
          error={errors.subjectId}
        />

        <CreatableEntitySelect
          testId="group-level"
          label={t('groups.level')}
          required
          placeholder={t('groups.selectLevel')}
          options={levels}
          value={selectedLevel}
          onChange={(level) => {
            set('levelId', level ? String(level.id) : '');
            set('branchId', '');
          }}
          getOptionLabel={(level) => level.name}
          getOptionValue={(level) => level.id}
          onCreate={() => setQuickCreate('level')}
          disableCreate={zIndex >= 70}
          searchable
          error={errors.levelId}
        />

        <CreatableEntitySelect
          testId="group-branch"
          label={t('groups.branch')}
          placeholder={levels.find((level) => String(level.id) === form.levelId)?.category === 'lycee'
            ? t('groups.selectBranch') : t('groups.noBranch')}
          options={levelBranches}
          value={levelBranches.find(branch => String(branch.id) === form.branchId) ?? null}
          onChange={branch => set('branchId', branch ? String(branch.id) : '')}
          getOptionLabel={branch => branch.name}
          getOptionValue={branch => branch.id}
          clearable
          onCreate={() => setQuickCreate('branch')}
          disableCreate={zIndex >= 70}
        />

        <CreatableEntitySelect
          testId="group-teacher"
          label={t('groups.teacher')}
          placeholder={teachers.length === 0 ? t('groups.noTeacherAvailable') : t('groups.noTeacher')}
          options={teachers}
          value={selectedTeacher}
          onChange={(teacher) => set('teacherId', teacher ? String(teacher.id) : '')}
          getOptionLabel={(teacher) => teacher.full_name}
          getOptionValue={(teacher) => teacher.id}
          onCreate={() => setQuickCreate('teacher')}
          disableCreate={zIndex >= 70}
          searchable
          clearable
        />

        <Select
          label={t('groups.schoolYear')}
          required
          placeholder={t('groups.selectSchoolYear')}
          value={form.schoolYearId}
          onChange={(event) => set('schoolYearId', event.target.value)}
          error={errors.schoolYearId}
          options={schoolYears.map((year) => ({ value: year.id, label: year.label ?? '' }))}
        />

        {/* ------------------------------------------- days of the week --- */}
        <fieldset className="sm:col-span-2" data-testid="group-week">
          <legend className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            {t('groups.schedules')}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </legend>
          <p className="mb-2 text-[12px] text-muted">{t('groups.schedulesHint')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {WEEK_DAYS.map((day) => {
              const slot = form.week[day] ?? { enabled: false, start: '16:00', end: '18:00' };
              const dayLabel = t(`groups.dayNames.${day}`);
              return (
                <div
                  key={day}
                  data-testid={`group-day-${day}`}
                  data-enabled={slot.enabled ? 'true' : 'false'}
                  className={cn(
                    'rounded-lg border p-2 transition-colors',
                    slot.enabled
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-slate-50/60 opacity-60',
                  )}
                >
                  <label
                    className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-foreground"
                    title={dayLabel}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={slot.enabled}
                      onChange={(event) =>
                        setWeekDay(day, { enabled: event.target.checked })
                      }
                      data-testid={`group-day-${day}-toggle`}
                    />
                    <span dir="auto">{shortDayLabel(t, day)}</span>
                  </label>
                  <div className="mt-1.5 space-y-1">
                    <input
                      type="time"
                      aria-label={`${dayLabel} — ${t('groups.startTime')}`}
                      value={slot.start}
                      disabled={!slot.enabled}
                      onChange={(event) => setWeekDay(day, { start: event.target.value })}
                      data-testid={`group-day-${day}-start`}
                      className="w-full rounded-md border border-border bg-white px-1 py-0.5 text-[12px] text-foreground disabled:cursor-not-allowed disabled:bg-transparent"
                    />
                    <input
                      type="time"
                      aria-label={`${dayLabel} — ${t('groups.endTime')}`}
                      value={slot.end}
                      disabled={!slot.enabled}
                      onChange={(event) => setWeekDay(day, { end: event.target.value })}
                      data-testid={`group-day-${day}-end`}
                      className="w-full rounded-md border border-border bg-white px-1 py-0.5 text-[12px] text-foreground disabled:cursor-not-allowed disabled:bg-transparent"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-muted" data-testid="group-week-summary">
            {formatSchedules(t, weekPayload(form.week))}
          </p>
          {errors.schedule ? (
            <p className="mt-1 text-[12px] text-destructive" role="alert" data-testid="group-week-error">
              {errors.schedule}
            </p>
          ) : null}
        </fieldset>

        <Input
          label={t('groups.room')}
          placeholder={t('groups.roomPlaceholder')}
          value={form.room}
          onChange={(event) => set('room', event.target.value)}
        />

        <MoneyInput
          label={t('groups.monthlyFee')}
          required
          data-testid="group-fee"
          valueCents={amountToCents(form.fee)}
          step={50}
          onChange={(cents) => set('fee', cents === 0 ? '' : String(cents / 100))}
          error={errors.fee}
          hint={t('groups.feeHint')}
        />

        <NumberInput
          label={t('groups.capacity')}
          required
          data-testid="group-capacity"
          decimals={0}
          min={1}
          max={200}
          step={1}
          suffix={t('common.suffix.students')}
          value={form.capacity === '' ? Number.NaN : Number(form.capacity)}
          onChange={(next) => set('capacity', Number.isFinite(next) && next > 0 ? String(next) : '')}
          error={errors.capacity}
        />
        </form>
      </Modal>

      {/* ----------------------------------------------- quick-create dialogs */}
      {quickCreate === 'subject' ? (
        <SubjectModal
          zIndex={zIndex + 10}
          onClose={() => setQuickCreate(null)}
          onCreated={async (subject) => {
            setQuickCreate(null);
            setSubjects(current => [...current.filter(row => row.id !== subject.id), subject]);
            set('subjectId', String(subject.id));
            void loadSubjects().catch(() => {});
          }}
        />
      ) : null}

      {quickCreate === 'level' ? (
        <LevelModal
          zIndex={zIndex + 10}
          onClose={() => setQuickCreate(null)}
          onCreated={async (level) => {
            setQuickCreate(null);
            setLevels(current => [...current.filter(row => row.id !== level.id), level]);
            set('levelId', String(level.id));
            void loadLevels().catch(() => {});
            set('branchId', '');
          }}
        />
      ) : null}

      {quickCreate === 'branch' ? (
        <BranchModal levels={levels} zIndex={zIndex + 10} onClose={() => setQuickCreate(null)}
          onCreated={branch => {
            setQuickCreate(null);
            setBranches(current => [...current.filter(row => row.id !== branch.id), branch]);
            setForm(current => ({ ...current, levelId: String(branch.level_id), branchId: String(branch.id) }));
            void levelsApi.branches().then(setBranches).catch(() => {});
          }} />
      ) : null}

      {quickCreate === 'teacher' ? (
        <TeacherModal
          open
          zIndex={zIndex + 10}
          onSaved={() => {}}
          onClose={() => setQuickCreate(null)}
          onCreated={async (teacher) => {
            setQuickCreate(null);
            setTeachers(current => [...current.filter(row => row.id !== teacher.id), teacher]);
            set('teacherId', String(teacher.id));
            void loadTeachers().catch(() => {});
          }}
        />
      ) : null}
    </>
  );
}

export default GroupModal;
