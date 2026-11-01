import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import { isValidPhone, studentsApi } from '../../services/students';
import type { Branch, Level, Student, StudentInput } from '../../types';

export interface StudentModalProps {
  open: boolean;
  /** `null` = create mode, otherwise the student being edited. */
  student?: Student | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  parentPhone: string;
  levelId: string;
  branchId: string;
  address: string;
  notes: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  fullName: '',
  dateOfBirth: '',
  phone: '',
  parentPhone: '',
  levelId: '',
  branchId: '',
  address: '',
  notes: '',
};

function toForm(student?: Student | null): FormState {
  if (!student) return EMPTY_FORM;
  return {
    fullName: student.full_name ?? '',
    dateOfBirth: student.date_of_birth ?? '',
    phone: student.phone ?? '',
    parentPhone: student.parent_phone ?? '',
    levelId: student.level_id ? String(student.level_id) : '',
    branchId: student.branch_id ? String(student.branch_id) : '',
    address: student.address ?? '',
    notes: student.notes ?? '',
  };
}

/** Create / edit dialog for a student. */
export function StudentModal({ open, student = null, onClose, onSaved }: StudentModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(student);

  const [form, setForm] = useState<FormState>(() => toForm(student));
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Re-seed the form whenever the modal opens for a different student.
  useEffect(() => {
    if (!open) return;
    setForm(toForm(student));
    setTouched({});
    setSubmitting(false);
  }, [open, student]);

  // Levels are needed for both modes.
  useEffect(() => {
    if (!open) return;
    let active = true;
    levelsApi
      .list()
      .then((rows) => {
        if (active) setLevels(rows);
      })
      .catch(() => {
        /* the select simply stays empty; the list page surfaces errors */
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Branches depend on the selected level.
  const levelId = form.levelId ? Number(form.levelId) : null;
  useEffect(() => {
    if (!open) return;
    let active = true;
    if (!levelId) {
      setBranches([]);
      return undefined;
    }
    levelsApi
      .branches(levelId)
      .then((rows) => {
        if (active) setBranches(rows);
      })
      .catch(() => {
        if (active) setBranches([]);
      });
    return () => {
      active = false;
    };
  }, [open, levelId]);

  const errors = useMemo<Errors>(() => {
    const next: Errors = {};

    const name = form.fullName.trim();
    if (!name) next.fullName = t('students.validation.nameRequired');
    else if (name.length < 2) next.fullName = t('students.validation.nameTooShort');

    const phone = form.phone.trim();
    if (!phone) next.phone = t('students.validation.phoneRequired');
    else if (!isValidPhone(phone)) next.phone = t('students.validation.phoneFormat');

    const parentPhone = form.parentPhone.trim();
    if (parentPhone && !isValidPhone(parentPhone)) {
      next.parentPhone = t('students.validation.phoneFormat');
    }

    return next;
  }, [form, t]);

  const isValid = Object.keys(errors).length === 0;

  const update = useCallback((field: FieldName, value: string) => {
    setForm((previous) => {
      // Changing the level invalidates the branch selection.
      if (field === 'levelId' && value !== previous.levelId) {
        return { ...previous, levelId: value, branchId: '' };
      }
      return { ...previous, [field]: value };
    });
  }, []);

  const markTouched = (field: FieldName) =>
    setTouched((previous) => ({ ...previous, [field]: true }));

  const visibleError = (field: FieldName): string | undefined =>
    touched[field] ? errors[field] : undefined;

  const buildPayload = (): StudentInput => ({
    full_name: form.fullName.trim(),
    date_of_birth: form.dateOfBirth ? form.dateOfBirth : null,
    phone: form.phone.trim(),
    parent_phone: form.parentPhone.trim() ? form.parentPhone.trim() : null,
    level_id: form.levelId ? Number(form.levelId) : null,
    branch_id: form.levelId && form.branchId ? Number(form.branchId) : null,
    address: form.address.trim() ? form.address.trim() : null,
    notes: form.notes.trim() ? form.notes.trim() : null,
  });

  const handleSubmit = async () => {
    if (!isValid) {
      setTouched({
        fullName: true,
        phone: true,
        parentPhone: true,
        dateOfBirth: true,
      });
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && student) {
        await studentsApi.update(student.id, buildPayload());
        toast.success(t('students.toast.updated'));
      } else {
        await studentsApi.create(buildPayload());
        toast.success(t('students.toast.created'));
      }
      onSaved();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t('students.toast.error')} ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const branchOptions = branches.map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  const levelOptions = levels.map((level) => ({
    value: level.id,
    label: level.name,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
          {isEdit ? t('students.editTitle') : t('students.new')}
        </span>
      }
      description={isEdit ? t('students.editDescription') : t('students.createDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting} disabled={!isValid}>
            {t('students.save')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <Input
          containerClassName="sm:col-span-2"
          label={t('students.name')}
          required
          autoFocus
          value={form.fullName}
          onChange={(event) => update('fullName', event.target.value)}
          onBlur={() => markTouched('fullName')}
          error={visibleError('fullName')}
          placeholder={t('students.namePlaceholder')}
        />

        <Input
          type="date"
          label={t('students.birthDate')}
          value={form.dateOfBirth}
          onChange={(event) => update('dateOfBirth', event.target.value)}
          hint={t('students.optional')}
        />

        <Input
          type="tel"
          inputMode="numeric"
          label={t('students.phone')}
          required
          value={form.phone}
          onChange={(event) => update('phone', event.target.value)}
          onBlur={() => markTouched('phone')}
          error={visibleError('phone')}
          placeholder="06XXXXXXXX"
          hint={t('students.phoneHint')}
        />

        <Input
          type="tel"
          inputMode="numeric"
          label={t('students.parentPhone')}
          value={form.parentPhone}
          onChange={(event) => update('parentPhone', event.target.value)}
          onBlur={() => markTouched('parentPhone')}
          error={visibleError('parentPhone')}
          placeholder="06XXXXXXXX"
          hint={t('students.optional')}
        />

        <Select
          label={t('students.level')}
          placeholder={t('students.selectLevel')}
          options={levelOptions}
          value={form.levelId}
          onChange={(event) => update('levelId', event.target.value)}
        />

        <Select
          label={t('students.branch')}
          placeholder={
            levelId ? t('students.selectBranch') : t('students.selectLevelFirst')
          }
          options={branchOptions}
          value={form.branchId}
          disabled={!levelId || branchOptions.length === 0}
          onChange={(event) => update('branchId', event.target.value)}
          hint={
            levelId && branchOptions.length === 0 ? t('students.noBranchesForLevel') : undefined
          }
        />

        <Textarea
          containerClassName="sm:col-span-2"
          label={t('students.address')}
          rows={2}
          value={form.address}
          onChange={(event) => update('address', event.target.value)}
          placeholder={t('students.addressPlaceholder')}
        />

        <Textarea
          containerClassName="sm:col-span-2"
          label={t('students.notes')}
          rows={2}
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          placeholder={t('students.notesPlaceholder')}
        />

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default StudentModal;
