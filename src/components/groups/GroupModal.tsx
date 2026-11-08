import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import Button from '../ui/Button';
import CreatableEntitySelect from '../ui/CreatableEntitySelect';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import Modal from '../ui/Modal';
import { toast } from '../ui/Toast';
import LevelModal from '../entity-modals/LevelModal';
import SubjectModal from '../entity-modals/SubjectModal';
import TeacherModal from '../teachers/TeacherModal';
import { groupsApi } from '../../services/groups';
import { scheduleSlots } from '../../utils/schedule';
import { levelsApi, schoolYearsApi, subjectsApi } from '../../services/settings';
import { amountToCents, centsToAmount } from '../../utils/format';
import type {
  Group,
  GroupInput,
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

interface FormState {
  name: string;
  subjectId: string;
  levelId: string;
  branchId: string;
  teacherId: string;
  schoolYearId: string;
  fee: string;
  capacity: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  name: '',
  subjectId: '',
  levelId: '',
  branchId: '',
  teacherId: '',
  schoolYearId: '',
  fee: '',
  capacity: '200',
};

/** Create or edit a group; scheduling is managed on the timetable. */
export function GroupModal({ open, group = null, onClose, onSaved, onCreated, zIndex = 50 }: GroupModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(group);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [referencesReady, setReferencesReady] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);

  // Quick-create dialogs stacked above this form (one level, `z-60`).
  const [quickCreate, setQuickCreate] = useState<'teacher' | 'subject' | 'level' | null>(null);

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
    setReferencesReady(false);
    let active = true;
    Promise.all([
      subjectsApi.list(),
      levelsApi.list(),
      groupsApi.teachers(),
      schoolYearsApi.list(),
    ])
      .then(([subjectList, levelList, teacherList, yearList]) => {
        if (!active) return;
        setSubjects(subjectList.filter((subject) => subject.is_active));
        setLevels(levelList);
        setTeachers(teacherList);
        setSchoolYears(yearList);
        setReferencesReady(true);
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
  // Reference data may arrive after typing starts: only fill the year in that
  // case, never replace the rest of the draft.
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      prefilled.current = null;
      return;
    }
    const activeYear = schoolYears.find((year) => year.is_active) ?? schoolYears[0];
    const key = group ? `group:${group.id}` : 'new';
    if (prefilled.current === key) {
      if (!group && activeYear) setForm(current => current.schoolYearId === String(activeYear.id) ? current : { ...current, schoolYearId: String(activeYear.id) });
      return;
    }
    prefilled.current = key;

    setErrors({});
    if (group) {
      setForm({
        name: group.name ?? '',
        subjectId: group.subject_id ? String(group.subject_id) : '',
        levelId: group.level_id ? String(group.level_id) : '',
        branchId: group.branch_id ? String(group.branch_id) : '',
        teacherId: group.teacher_id ? String(group.teacher_id) : '',
        schoolYearId: group.school_year_id ? String(group.school_year_id) : '',
        fee: centsToAmount(group.monthly_fee_cents),
        capacity: String(group.capacity),
      });
    } else {
      setForm({ ...EMPTY_FORM, schoolYearId: activeYear ? String(activeYear.id) : '' });
    }
  }, [open, group, schoolYears]);

  const set = useCallback(<K extends FieldName>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }, []);

  const validate = useCallback((): Errors => {
    const next: Errors = {};
    if (!form.name.trim()) next.name = t('common.required');
    if (!form.subjectId) next.subjectId = t('groups.validation.subjectRequired');
    if (!form.levelId) next.levelId = t('groups.validation.levelRequired');
    if (!form.schoolYearId) next.schoolYearId = t('groups.validation.schoolYearRequired');
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
      if (!referencesReady || saving) return;
      const nextErrors = validate();
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const schedules = group ? scheduleSlots(group) : [];
      const first = schedules[0];
      const payload: GroupInput = {
        name: form.name.trim() || null,
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
        room: group?.room ?? null,
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
    [form, group, isEdit, onClose, onSaved, onCreated, t, validate, referencesReady, saving],
  );

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
      size="wide"
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
          <Button type="submit" form="group-form" loading={saving} disabled={!referencesReady}>
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
        <Input label={t('groups.name')} required error={errors.name} data-testid="group-name" value={form.name} onChange={event => set('name', event.target.value)} />
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
