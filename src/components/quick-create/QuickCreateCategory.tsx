import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import { toast } from '../ui/Toast';
import { expensesApi } from '../../services/expenses';
import QuickCreateShell from './QuickCreateShell';

export interface QuickCreateCategoryProps {
  open?: boolean;
  zIndex?: number;
  /** Receives the trimmed label of the category that is now in the settings. */
  onCreated: (category: string) => void;
  onClose: () => void;
}

/**
 * “Nouvelle catégorie” for the expense form.
 *
 * A category is just a string in `settings.expense_categories`, so creating one
 * is a read-append-write of that list. Existing names are matched
 * case-insensitively: `Loyer` and `loyer` would be two badges with one colour.
 */
export function QuickCreateCategory({
  open = true,
  zIndex = 60,
  onCreated,
  onClose,
}: QuickCreateCategoryProps) {
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

      setSaving(true);
      try {
        const current = await expensesApi.categories();
        if (current.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
          setError(t('quickCreate.existing'));
          return;
        }
        await expensesApi.setCategories([...current, trimmed]);
        toast.success(t('quickCreate.created', { entity: trimmed }));
        onCreated(trimmed);
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
      testId="quick-create-category"
      title={t('quickCreate.category.title')}
      description={t('quickCreate.category.description')}
      formId="quick-category-form"
      saving={saving}
      onClose={onClose}
    >
      <form id="quick-category-form" onSubmit={handleSubmit} noValidate>
        <Input
          label={t('quickCreate.fields.categoryName')}
          required
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          error={error}
          placeholder={t('quickCreate.fields.categoryPlaceholder')}
          data-testid="quick-category-name"
        />
      </form>
    </QuickCreateShell>
  );
}

export default QuickCreateCategory;
