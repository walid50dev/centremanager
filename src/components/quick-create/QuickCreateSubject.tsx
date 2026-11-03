import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import { toast } from '../ui/Toast';
import { subjectsApi } from '../../services/settings';
import type { Subject } from '../../types';
import QuickCreateShell from './QuickCreateShell';

export interface QuickCreateSubjectProps {
  open?: boolean;
  zIndex?: number;
  onCreated: (subject: Subject) => void;
  onClose: () => void;
}

/**
 * “Nouvelle matière”, from a dropdown that has no subject to offer yet.
 *
 * `cmd_create_subject` returns the new id only, so the freshly created row is
 * read back from the list: the parent needs the whole object to auto-select it.
 */
export function QuickCreateSubject({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateSubjectProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(undefined);
    setSaving(false);
  }, [open]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) {
        setError(t('quickCreate.validation.nameRequired'));
        return;
      }
      if (trimmed.length < 2) {
        setError(t('quickCreate.validation.nameTooShort'));
        return;
      }

      setSaving(true);
      try {
        const id = await subjectsApi.create(trimmed);
        const rows = await subjectsApi.list();
        const created =
          rows.find((row) => row.id === id) ?? ({ id, name: trimmed, is_active: true } as Subject);
        toast.success(t('quickCreate.created', { entity: created.name }));
        onCreated(created);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSaving(false);
      }
    },
    [name, onCreated, t],
  );

  return (
    <QuickCreateShell
      open={open}
      zIndex={zIndex}
      testId="quick-create-subject"
      title={t('quickCreate.subject.title')}
      description={t('quickCreate.subject.description')}
      formId="quick-subject-form"
      saving={saving}
      onClose={onClose}
    >
      <form id="quick-subject-form" onSubmit={handleSubmit} noValidate>
        <Input
          label={t('quickCreate.fields.subjectName')}
          required
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          error={error}
          placeholder={t('quickCreate.fields.subjectPlaceholder')}
          data-testid="quick-subject-name"
        />
      </form>
    </QuickCreateShell>
  );
}

export default QuickCreateSubject;
