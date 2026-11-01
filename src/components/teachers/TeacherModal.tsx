import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { subjectsApi } from '../../services/settings';
import { isValidTeacherPhone, teachersApi } from '../../services/teachers';
import { cn } from '../../utils/format';
import type { Subject, Teacher, TeacherDetail, TeacherInput } from '../../types';

export interface TeacherModalProps {
  open: boolean;
  /** `null` = create mode, otherwise the teacher being edited. */
  teacher?: Teacher | TeacherDetail | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  notes: string;
  subjectIds: number[];
}

type FieldName = 'fullName' | 'phone' | 'email';
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  fullName: '',
  phone: '',
  email: '',
  notes: '',
  subjectIds: [],
};

function toForm(teacher?: Teacher | TeacherDetail | null): FormState {
  if (!teacher) return EMPTY_FORM;
  const row = 'teacher' in teacher ? teacher.teacher : teacher;
  const ids = 'teacher' in teacher ? teacher.subject_ids : null;
  let subjectIds = ids ?? [];
  if (!ids) {
    // The list row only carries the joined names: map them back to ids.
    subjectIds = [];
  }
  return {
    fullName: row.full_name ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    subjectIds,
  };
}

/** Create / edit dialog for a teacher. */
export function TeacherModal({ open, teacher = null, onClose, onSaved }: TeacherModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(teacher);

  const [form, setForm] = useState<FormState>(() => toForm(teacher));
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadedDetail, setLoadedDetail] = useState<number[] | null>(null);

  // Re-seed the form whenever the modal opens for a different teacher.
  useEffect(() => {
    if (!open) return;
    setForm(toForm(teacher));
    setTouched({});
    setSubmitting(false);
    setLoadedDetail(null);
  }, [open, teacher]);

  // Subjects (active only) for the checkbox grid.
  useEffect(() => {
    if (!open) return;
    let active = true;
    subjectsApi
      .list()
      .then((rows) => {
        if (active) setSubjects(rows.filter((subject) => subject.is_active));
      })
      .catch(() => {
        /* the grid simply stays empty */
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Editing from the grid only has the joined names: load the raw ids once.
  useEffect(() => {
    if (!open || !teacher) return;
    if ('teacher' in teacher) {
      setLoadedDetail(teacher.subject_ids);
      return;
    }
    let active = true;
    teachersApi
      .detail(teacher.id)
      .then((detail) => {
        if (active) setLoadedDetail(detail.subject_ids);
      })
      .catch(() => {
        if (active) setLoadedDetail([]);
      });
    return () => {
      active = false;
    };
  }, [open, teacher]);

  // Merge the loaded ids into the form the first time they arrive.
  useEffect(() => {
    if (loadedDetail === null) return;
    setForm((previous) => ({ ...previous, subjectIds: loadedDetail }));
  }, [loadedDetail]);

  const errors = useMemo<Errors>(() => {
    const next: Errors = {};

    const name = form.fullName.trim();
    if (!name) next.fullName = t('teachers.validation.nameRequired');
    else if (name.length < 2) next.fullName = t('teachers.validation.nameTooShort');

    const phone = form.phone.trim();
    if (phone && !isValidTeacherPhone(phone)) next.phone = t('teachers.validation.phoneFormat');

    const email = form.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      next.email = t('teachers.validation.emailFormat');
    }

    return next;
  }, [form, t]);

  const isValid = Object.keys(errors).length === 0;

  const update = useCallback((field: FieldName, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  }, []);

  const toggleSubject = (id: number) =>
    setForm((previous) => ({
      ...previous,
      subjectIds: previous.subjectIds.includes(id)
        ? previous.subjectIds.filter((value) => value !== id)
        : [...previous.subjectIds, id],
    }));

  const markTouched = (field: FieldName) =>
    setTouched((previous) => ({ ...previous, [field]: true }));

  const visibleError = (field: FieldName): string | undefined =>
    touched[field] ? errors[field] : undefined;

  const buildPayload = (): TeacherInput => ({
    full_name: form.fullName.trim(),
    phone: form.phone.trim() ? form.phone.trim() : null,
    email: form.email.trim() ? form.email.trim() : null,
    notes: form.notes.trim() ? form.notes.trim() : null,
    subject_ids: [...form.subjectIds].sort((a, b) => a - b),
  });

  const handleSubmit = async () => {
    if (!isValid) {
      setTouched({ fullName: true, phone: true, email: true });
      return;
    }

    setSubmitting(true);
    try {
      const id = teacher
        ? 'teacher' in teacher
          ? (teacher as TeacherDetail).teacher.id
          : (teacher as Teacher).id
        : null;
      if (isEdit && id) {
        await teachersApi.update(id, buildPayload());
        toast.success(t('teachers.toast.updated'));
      } else {
        await teachersApi.create(buildPayload());
        toast.success(t('teachers.toast.created'));
      }
      onSaved();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t('teachers.toast.error')} ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" />
          {isEdit ? t('teachers.edit') : t('teachers.new')}
        </span>
      }
      description={isEdit ? t('teachers.editDescription') : t('teachers.createDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting} disabled={!isValid}>
            {t('common.save')}
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
          label={t('teachers.name')}
          required
          autoFocus
          value={form.fullName}
          onChange={(event) => update('fullName', event.target.value)}
          onBlur={() => markTouched('fullName')}
          error={visibleError('fullName')}
          placeholder={t('teachers.namePlaceholder')}
        />

        <Input
          type="tel"
          label={t('teachers.phone')}
          value={form.phone}
          onChange={(event) => update('phone', event.target.value)}
          onBlur={() => markTouched('phone')}
          error={visibleError('phone')}
          placeholder="06XXXXXXXX"
          hint={t('teachers.optional')}
          dir="ltr"
        />

        <Input
          type="email"
          label={t('teachers.email')}
          value={form.email}
          onChange={(event) => update('email', event.target.value)}
          onBlur={() => markTouched('email')}
          error={visibleError('email')}
          placeholder="nom@centre.ma"
          hint={t('teachers.optional')}
          dir="ltr"
        />

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 block text-label text-muted">{t('teachers.subjects')}</legend>
          {subjects.length === 0 ? (
            <p className="text-[13px] text-muted">{t('teachers.noSubjects')}</p>
          ) : (
            <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-3">
              {subjects.map((subject) => (
                <label
                  key={subject.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] transition-colors',
                    form.subjectIds.includes(subject.id)
                      ? 'bg-primary/5 text-foreground'
                      : 'text-muted hover:bg-background',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.subjectIds.includes(subject.id)}
                    onChange={() => toggleSubject(subject.id)}
                    data-testid={`teacher-subject-${subject.id}`}
                  />
                  <span dir="auto">{subject.name}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-[12px] text-muted">{t('teachers.subjectsHint')}</p>
        </fieldset>

        <Textarea
          containerClassName="sm:col-span-2"
          label={t('teachers.notes')}
          rows={2}
          value={form.notes}
          onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))}
          placeholder={t('teachers.notesPlaceholder')}
        />

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default TeacherModal;
