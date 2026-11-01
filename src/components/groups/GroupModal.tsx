import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import { DAY_NAMES, groupsApi } from '../../services/groups';
import { levelsApi, schoolYearsApi, subjectsApi } from '../../services/settings';
import { amountToCents, centsToAmount } from '../../utils/format';
import type { Branch, Group, GroupInput, Level, SchoolYear, Subject, TeacherOption } from '../../types';

export interface GroupModalProps {
  open: boolean;
  /** `null` = create mode, otherwise the group being edited. */
  group?: Group | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  subjectId: string;
  levelId: string;
  branchId: string;
  teacherId: string;
  schoolYearId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string;
  fee: string;
  capacity: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  subjectId: '',
  levelId: '',
  branchId: '',
  teacherId: '',
  schoolYearId: '',
  dayOfWeek: 'Lundi',
  startTime: '16:00',
  endTime: '18:00',
  room: '',
  fee: '',
  capacity: '10',
};

/** Create / edit a group. Levels drive the branch list, like the student form. */
export function GroupModal({ open, group = null, onClose, onSaved }: GroupModalProps) {
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

  // Reference data is fetched once per opening.
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

  // Reset (or prefill) whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (group) {
      setForm({
        subjectId: group.subject_id ? String(group.subject_id) : '',
        levelId: group.level_id ? String(group.level_id) : '',
        branchId: group.branch_id ? String(group.branch_id) : '',
        teacherId: group.teacher_id ? String(group.teacher_id) : '',
        schoolYearId: group.school_year_id ? String(group.school_year_id) : '',
        dayOfWeek: group.day_of_week || 'Lundi',
        startTime: group.start_time || '16:00',
        endTime: group.end_time || '18:00',
        room: group.room ?? '',
        fee: centsToAmount(group.monthly_fee_cents),
        capacity: String(group.capacity),
      });
    } else {
      const activeYear = schoolYears.find((year) => year.is_active) ?? schoolYears[0];
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

  const validate = useCallback((): Errors => {
    const next: Errors = {};
    if (!form.subjectId) next.subjectId = t('groups.validation.subjectRequired');
    if (!form.levelId) next.levelId = t('groups.validation.levelRequired');
    if (!form.schoolYearId) next.schoolYearId = t('groups.validation.schoolYearRequired');
    if (!form.dayOfWeek) next.dayOfWeek = t('groups.validation.dayRequired');
    if (!form.startTime) next.startTime = t('groups.validation.startRequired');
    if (!form.endTime) {
      next.endTime = t('groups.validation.endRequired');
    } else if (form.startTime && form.endTime <= form.startTime) {
      next.endTime = t('groups.validation.endAfterStart');
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

      const payload: GroupInput = {
        subject_id: Number(form.subjectId),
        level_id: Number(form.levelId),
        branch_id: form.branchId ? Number(form.branchId) : null,
        teacher_id: form.teacherId ? Number(form.teacherId) : null,
        school_year_id: Number(form.schoolYearId),
        day_of_week: form.dayOfWeek,
        start_time: form.startTime,
        end_time: form.endTime,
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
          await groupsApi.create(payload);
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
    [form, group, isEdit, onClose, onSaved, t, validate],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
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
        <Select
          label={t('groups.subject')}
          required
          placeholder={t('groups.selectSubject')}
          value={form.subjectId}
          onChange={(event) => set('subjectId', event.target.value)}
          error={errors.subjectId}
          options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
        />

        <Select
          label={t('groups.level')}
          required
          placeholder={t('groups.selectLevel')}
          value={form.levelId}
          onChange={(event) => {
            set('levelId', event.target.value);
            set('branchId', '');
          }}
          error={errors.levelId}
          options={levels.map((level) => ({ value: level.id, label: level.name }))}
        />

        <Select
          label={t('groups.branch')}
          placeholder={levels.find((level) => String(level.id) === form.levelId)?.category === 'lycee'
            ? t('groups.selectBranch')
            : t('groups.noBranch')}
          value={form.branchId}
          onChange={(event) => set('branchId', event.target.value)}
          disabled={levelBranches.length === 0}
          options={levelBranches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />

        <Select
          label={t('groups.teacher')}
          placeholder={teachers.length === 0 ? t('groups.noTeacherAvailable') : t('groups.noTeacher')}
          value={form.teacherId}
          onChange={(event) => set('teacherId', event.target.value)}
          disabled={teachers.length === 0}
          options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.full_name }))}
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

        <Select
          label={t('groups.day')}
          required
          value={form.dayOfWeek}
          onChange={(event) => set('dayOfWeek', event.target.value)}
          error={errors.dayOfWeek}
          options={DAY_NAMES.map((day) => ({ value: day, label: t(`groups.dayNames.${day}`) }))}
        />

        <Input
          label={t('groups.startTime')}
          required
          type="time"
          value={form.startTime}
          onChange={(event) => set('startTime', event.target.value)}
          error={errors.startTime}
        />

        <Input
          label={t('groups.endTime')}
          required
          type="time"
          value={form.endTime}
          onChange={(event) => set('endTime', event.target.value)}
          error={errors.endTime}
        />

        <Input
          label={t('groups.room')}
          placeholder={t('groups.roomPlaceholder')}
          value={form.room}
          onChange={(event) => set('room', event.target.value)}
        />

        <Input
          label={t('groups.monthlyFee')}
          required
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          placeholder="300"
          value={form.fee}
          onChange={(event) => set('fee', event.target.value)}
          error={errors.fee}
          hint={t('groups.feeHint')}
        />

        <Input
          label={t('groups.capacity')}
          required
          type="number"
          min="1"
          step="1"
          value={form.capacity}
          onChange={(event) => set('capacity', event.target.value)}
          error={errors.capacity}
        />
      </form>
    </Modal>
  );
}

export default GroupModal;
