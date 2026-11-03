import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import { toast } from '../ui/Toast';
import { subjectsApi } from '../../services/settings';
import { isValidTeacherPhone, teachersApi } from '../../services/teachers';
import { groupsApi } from '../../services/groups';
import { cn, formatPhone, stripPhone } from '../../utils/format';
import type { Subject, TeacherInput, TeacherOption } from '../../types';
import QuickCreateShell from './QuickCreateShell';

export interface QuickCreateTeacherProps {
  open?: boolean;
  zIndex?: number;
  onCreated: (teacher: TeacherOption) => void;
  onClose: () => void;
}

/**
 * “Nouvel enseignant (rapide)” — exactly the fields a group needs to exist:
 * a name, an optional phone, and the subjects they can teach.
 *
 * Everything else (email, notes, compensation) lives on the full teacher sheet,
 * reachable afterwards from *Enseignants*.
 */
export function QuickCreateTeacher({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateTeacherProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setPhone('');
    setSubjectIds([]);
    setErrors({});
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    subjectsApi
      .list()
      .then((rows) => {
        if (active) setSubjects(rows.filter((subject) => subject.is_active));
      })
      .catch(() => {
        /* the checkbox grid simply stays empty */
      });
    return () => {
      active = false;
    };
  }, [open]);

  const toggleSubject = (id: number) =>
    setSubjectIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = fullName.trim();
      const nextErrors: { name?: string; phone?: string } = {};
      if (!trimmedName) nextErrors.name = t('quickCreate.validation.nameRequired');
      else if (trimmedName.length < 2) nextErrors.name = t('quickCreate.validation.nameTooShort');
      if (phone.trim() && !isValidTeacherPhone(phone)) {
        nextErrors.phone = t('quickCreate.validation.phoneInvalid');
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const payload: TeacherInput = {
        full_name: trimmedName,
        phone: phone.trim() ? stripPhone(phone) : null,
        email: null,
        notes: null,
        subject_ids: subjectIds,
      };

      setSaving(true);
      try {
        const id = await teachersApi.create(payload);
        const options = await groupsApi.teachers();
        const created = options.find((option) => option.id === id) ?? { id, full_name: trimmedName };
        toast.success(t('quickCreate.created', { entity: created.full_name }));
        onCreated(created);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSaving(false);
      }
    },
    [fullName, onCreated, phone, subjectIds, t],
  );

  return (
    <QuickCreateShell
      open={open}
      zIndex={zIndex}
      testId="quick-create-teacher"
      title={t('quickCreate.teacher.title')}
      description={t('quickCreate.teacher.description')}
      formId="quick-teacher-form"
      saving={saving}
      onClose={onClose}
    >
      <form id="quick-teacher-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label={t('quickCreate.fields.name')}
          required
          autoFocus
          value={fullName}
          onChange={(event) => {
            setFullName(event.target.value);
            setErrors((current) => ({ ...current, name: undefined }));
          }}
          error={errors.name}
          placeholder={t('quickCreate.fields.namePlaceholder')}
          data-testid="quick-teacher-name"
        />

        <Input
          type="tel"
          label={t('quickCreate.fields.phone')}
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setErrors((current) => ({ ...current, phone: undefined }));
          }}
          onBlur={() => {
            if (phone.trim() && isValidTeacherPhone(phone)) setPhone(formatPhone(phone));
          }}
          error={errors.phone}
          placeholder="06 XX XX XX XX"
          hint={t('teachers.optional')}
          dir="ltr"
          data-testid="quick-teacher-phone"
        />

        <fieldset>
          <legend className="mb-1.5 block text-label text-muted">
            {t('quickCreate.fields.subjects')}
          </legend>
          {subjects.length === 0 ? (
            <p className="text-[13px] text-muted">{t('teachers.noSubjects')}</p>
          ) : (
            <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {subjects.map((subject) => (
                <label
                  key={subject.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] transition-colors',
                    subjectIds.includes(subject.id)
                      ? 'bg-primary/5 text-foreground'
                      : 'text-muted hover:bg-background',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={subjectIds.includes(subject.id)}
                    onChange={() => toggleSubject(subject.id)}
                    data-testid={`quick-teacher-subject-${subject.id}`}
                  />
                  <span dir="auto">{subject.name}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted">{t('quickCreate.fields.subjectsHint')}</p>
        </fieldset>
      </form>
    </QuickCreateShell>
  );
}

export default QuickCreateTeacher;
