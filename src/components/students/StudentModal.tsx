import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import CreatableSelect from '../ui/CreatableSelect';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import QuickCreateLevel from '../quick-create/QuickCreateLevel';
import { isValidPhone, studentsApi } from '../../services/students';
import { formatPhone, stripPhone } from '../../utils/format';
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
  fatherName: string;
  dateOfBirth: string;
  /** Kept as typed (spaces and dashes allowed); stripped when submitted. */
  phone: string;
  parentPhone: string;
  levelId: string;
  branchId: string;
  homeAddress: string;
  notes: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  fullName: '',
  fatherName: '',
  dateOfBirth: '',
  phone: '',
  parentPhone: '',
  levelId: '',
  branchId: '',
  homeAddress: '',
  notes: '',
};

function toForm(student?: Student | null): FormState {
  if (!student) return EMPTY_FORM;
  return {
    fullName: student.full_name ?? '',
    fatherName: student.father_name ?? '',
    dateOfBirth: student.date_of_birth ?? '',
    // Stored raw (`0607123456`); shown grouped as soon as the modal opens.
    phone: student.phone ? formatPhone(student.phone) : '',
    parentPhone: student.parent_phone ? formatPhone(student.parent_phone) : '',
    levelId: student.level_id ? String(student.level_id) : '',
    branchId: student.branch_id ? String(student.branch_id) : '',
    homeAddress: student.home_address ?? '',
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
  const [quickLevel, setQuickLevel] = useState(false);

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

  /** Reloaded after a quick-create so the new level is selectable. */
  const loadLevels = useCallback(async () => {
    const rows = await levelsApi.list();
    setLevels(rows);
  }, []);

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

    // Validation always runs on the ten raw digits, whatever the user typed.
    const phone = stripPhone(form.phone);
    if (!phone) next.phone = t('students.validation.phoneRequired');
    else if (!isValidPhone(phone)) next.phone = t('students.validation.phoneFormat');

    const parentPhone = stripPhone(form.parentPhone);
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
    // The backend stores plain digits, never the display grouping.
    phone: stripPhone(form.phone),
    parent_phone: stripPhone(form.parentPhone) || null,
    father_name: form.fatherName.trim() || null,
    level_id: form.levelId ? Number(form.levelId) : null,
    branch_id: form.levelId && form.branchId ? Number(form.branchId) : null,
    home_address: form.homeAddress.trim() || null,
    notes: form.notes.trim() || null,
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

  return (
    <>
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
          data-testid="student-full-name"
          required
          autoFocus
          value={form.fullName}
          onChange={(event) => update('fullName', event.target.value)}
          onBlur={() => markTouched('fullName')}
          error={visibleError('fullName')}
          placeholder={t('students.namePlaceholder')}
        />

        <Input
          label={t('students.fatherName')}
          value={form.fatherName}
          onChange={(event) => update('fatherName', event.target.value)}
          placeholder={t('students.fatherNamePlaceholder')}
          hint={t('students.optional')}
          data-testid="student-father-name"
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
          inputMode="tel"
          dir="ltr"
          label={t('students.phone')}
          required
          value={form.phone}
          onChange={(event) => update('phone', event.target.value)}
          onBlur={() => {
            // `06 07 12 34 56` the moment the field is left. An invalid number
            // is left exactly as typed so the user can fix it.
            const digits = stripPhone(form.phone);
            if (isValidPhone(digits)) update('phone', formatPhone(digits));
            markTouched('phone');
          }}
          error={visibleError('phone')}
          placeholder={t('students.phonePlaceholder')}
          hint={t('students.phoneHint')}
          data-testid="student-phone"
        />

        <Input
          type="tel"
          inputMode="tel"
          dir="ltr"
          label={t('students.parentPhone')}
          value={form.parentPhone}
          onChange={(event) => update('parentPhone', event.target.value)}
          onBlur={() => {
            const digits = stripPhone(form.parentPhone);
            if (isValidPhone(digits)) update('parentPhone', formatPhone(digits));
            markTouched('parentPhone');
          }}
          error={visibleError('parentPhone')}
          placeholder={t('students.phonePlaceholder')}
          hint={t('students.optional')}
          data-testid="student-parent-phone"
        />

        <CreatableSelect
          testId="student-level"
          label={t('students.level')}
          placeholder={t('students.selectLevel')}
          options={levels}
          value={levels.find((level) => String(level.id) === form.levelId) ?? null}
          onChange={(level) => update('levelId', level ? String(level.id) : '')}
          getOptionLabel={(level) => level.name}
          getOptionValue={(level) => level.id}
          onCreate={() => setQuickLevel(true)}
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
          label={t('students.homeAddress')}
          rows={2}
          value={form.homeAddress}
          onChange={(event) => update('homeAddress', event.target.value)}
          placeholder={t('students.homeAddressPlaceholder')}
          data-testid="student-home-address"
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

      {quickLevel ? (
        <QuickCreateLevel
          onClose={() => setQuickLevel(false)}
          onCreated={async (level) => {
            setQuickLevel(false);
            await loadLevels();
            update('levelId', String(level.id));
          }}
        />
      ) : null}
    </>
  );
}

export default StudentModal;
