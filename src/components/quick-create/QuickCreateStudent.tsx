import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import DuplicateWarnings from '../duplicates/DuplicateWarnings';
import { splitFullName } from '../../services/duplicates';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import { isValidPhone, studentsApi } from '../../services/students';
import { formatPhone, stripPhone } from '../../utils/format';
import type { Level, Student, StudentInput } from '../../types';
import QuickCreateShell from './QuickCreateShell';

export interface QuickCreateStudentProps {
  open?: boolean;
  zIndex?: number;
  onCreated: (student: Student) => void;
  onClose: () => void;
}

/**
 * “Nouvel élève (rapide)” — a name, a phone, and optionally a level.
 *
 * Enough to open an enrollment or record a first payment. The level field is a
 * plain `Select` on purpose: a quick-create opened from a quick-create would
 * stack a third dialog, and one level of nesting is the rule.
 */
export function QuickCreateStudent({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateStudentProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [guardian, setGuardian] = useState('');
  const [levelId, setLevelId] = useState('');
  const [levels, setLevels] = useState<Level[]>([]);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setPhone('');
    setGuardian('');
    setLevelId('');
    setErrors({});
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    levelsApi
      .list()
      .then((rows) => {
        if (active) setLevels(rows);
      })
      .catch(() => {
        /* the select simply stays empty */
      });
    return () => {
      active = false;
    };
  }, [open]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = fullName.trim();
      const nextErrors: { name?: string; phone?: string } = {};
      if (!trimmedName) nextErrors.name = t('quickCreate.validation.nameRequired');
      else if (trimmedName.length < 2) nextErrors.name = t('quickCreate.validation.nameTooShort');
      if (!phone.trim()) nextErrors.phone = t('quickCreate.validation.phoneRequired');
      else if (!isValidPhone(phone)) nextErrors.phone = t('quickCreate.validation.phoneInvalid');
      if (!guardian.trim() || !levelId || trimmedName.split(/\s+/).length < 2) { toast.error(t('students.quick_required')); return; }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const parts = trimmedName.split(/\s+/);
      const payload: StudentInput = {
        full_name: trimmedName, first_name: parts[0], last_name: parts.slice(1).join(' '),
        birth_date: null, phone: stripPhone(phone), guardian_phone: stripPhone(phone),
        guardian_name: guardian.trim(), guardian_relation: null, secondary_contact_name: null,
        secondary_contact_phone: null, school_name: null, enrollment_date: new Date().toISOString().split('T')[0],
        level_id: Number(levelId), branch_id: null, address: null, notes: null, status: 'actif',
      };

      setSaving(true);
      try {
        const id = await studentsApi.create(payload);
        const detail = await studentsApi.detail(id);
        const created: Student = detail.student;
        toast.success(t('quickCreate.created', { entity: created.full_name }));
        onCreated(created);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSaving(false);
      }
    },
    [fullName, guardian, levelId, onCreated, phone, t],
  );

  return (
    <QuickCreateShell
      open={open}
      zIndex={zIndex}
      testId="quick-create-student"
      title={t('quickCreate.student.title')}
      description={t('quickCreate.student.description')}
      formId="quick-student-form"
      saving={saving}
      onClose={onClose}
    >
      <form id="quick-student-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <DuplicateWarnings open={open} type="student" first={splitFullName(fullName).first} last={splitFullName(fullName).last} phone={phone} />
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
          data-testid="quick-student-name"
        />

        <Input label={t('students.guardian_name')} required value={guardian} onChange={event => setGuardian(event.target.value)} />

        <Input
          type="tel"
          label={t('students.guardian_phone')}
          required
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setErrors((current) => ({ ...current, phone: undefined }));
          }}
          onBlur={() => {
            if (isValidPhone(phone)) setPhone(formatPhone(phone));
          }}
          error={errors.phone}
          placeholder="06 XX XX XX XX"
          dir="ltr"
          data-testid="quick-student-phone"
        />

        <Select
          label={t('quickCreate.fields.level')}
          placeholder={t('students.selectLevel')}
          value={levelId}
          onChange={(event) => setLevelId(event.target.value)}
          options={levels.map((level) => ({ value: level.id, label: level.name }))}
          required
          data-testid="quick-student-level"
        />
      </form>
    </QuickCreateShell>
  );
}

export default QuickCreateStudent;
