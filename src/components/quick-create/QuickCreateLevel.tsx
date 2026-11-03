import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import type { Level } from '../../types';
import QuickCreateShell from './QuickCreateShell';

export interface QuickCreateLevelProps {
  open?: boolean;
  zIndex?: number;
  onCreated: (level: Level) => void;
  onClose: () => void;
}

/** Primaire / Collège / Lycée — the three categories of the schema. */
const CATEGORIES = [
  { value: 'primaire', labelKey: 'settings.levels.primaire' },
  { value: 'college', labelKey: 'settings.levels.college' },
  { value: 'lycee', labelKey: 'settings.levels.lycee' },
] as const;

/** New levels land at the end of the list unless Settings reorders them. */
const LAST_SORT_ORDER = 99;

/** “Nouveau niveau”, with its mandatory category. */
export function QuickCreateLevel({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateLevelProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('primaire');
  const [errors, setErrors] = useState<{ name?: string; category?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCategory('primaire');
    setErrors({});
    setSaving(false);
  }, [open]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      const nextErrors: { name?: string; category?: string } = {};
      if (!trimmed) nextErrors.name = t('quickCreate.validation.nameRequired');
      else if (trimmed.length < 2) nextErrors.name = t('quickCreate.validation.nameTooShort');
      if (!category) nextErrors.category = t('quickCreate.validation.categoryRequired');
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setSaving(true);
      try {
        const id = await levelsApi.create(trimmed, category, LAST_SORT_ORDER);
        const rows = await levelsApi.list();
        const created =
          rows.find((row) => row.id === id) ??
          ({ id, name: trimmed, category, sort_order: LAST_SORT_ORDER } as Level);
        toast.success(t('quickCreate.created', { entity: created.name }));
        onCreated(created);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSaving(false);
      }
    },
    [category, name, onCreated, t],
  );

  return (
    <QuickCreateShell
      open={open}
      zIndex={zIndex}
      testId="quick-create-level"
      title={t('quickCreate.level.title')}
      description={t('quickCreate.level.description')}
      formId="quick-level-form"
      saving={saving}
      onClose={onClose}
    >
      <form id="quick-level-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label={t('quickCreate.fields.levelName')}
          required
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => ({ ...current, name: undefined }));
          }}
          error={errors.name}
          placeholder={t('quickCreate.fields.levelPlaceholder')}
          data-testid="quick-level-name"
        />

        <Select
          label={t('quickCreate.fields.category')}
          required
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          error={errors.category}
          options={CATEGORIES.map((entry) => ({ value: entry.value, label: t(entry.labelKey) }))}
          data-testid="quick-level-category"
        />
      </form>
    </QuickCreateShell>
  );
}

export default QuickCreateLevel;
