import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Tag } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingsSection from './SettingsSection';
import { CategoryTag } from '../expenses/ExpenseCategoryBadge';
import { toast } from '../ui/Toast';
import { expensesApi } from '../../services/expenses';

/**
 * Section 9 — the expense categories.
 *
 * The list lives in `settings.expense_categories` as a JSON array and drives the
 * select of the expense form, so this editor is the only place a category is
 * created or removed. It is saved as a whole (one `cmd_set_expense_categories`
 * call) rather than one request per keystroke: the director can reorder, remove
 * and add, then confirm.
 */
export function ExpenseCategoriesSection() {
  const { t } = useTranslation();

  const [saved, setSaved] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await expensesApi.categories();
      setSaved(list);
      setDraft(list);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    draft.length !== saved.length || draft.some((entry, index) => entry !== saved[index]);

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (draft.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      toast.error(t('settings.categoryExists', { name }));
      return;
    }
    setDraft((current) => [...current, name]);
    setNewCategory('');
  };

  const removeCategory = (name: string) => {
    setDraft((current) => current.filter((entry) => entry !== name));
  };

  const save = async () => {
    if (draft.length === 0) {
      toast.error(t('expenses.validation.categoryRequired'));
      return;
    }
    setSaving(true);
    try {
      await expensesApi.setCategories(draft);
      setSaved(draft);
      toast.success(t('settings.expenseCategoriesSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      icon={<Tag className="h-4 w-4" aria-hidden="true" />}
      title={t('settings.expenseCategories')}
      description={t('settings.expenseCategoriesDescription')}
    >
      <div className="space-y-3" data-testid="expense-categories-section">
        {loading ? (
          <p className="text-[13px] text-muted">{t('common.loading')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" data-testid="expense-category-list">
              {draft.map((category) => (
                <CategoryTag
                  key={category}
                  category={category}
                  onRemove={() => removeCategory(category)}
                  disabled={saving || draft.length <= 1}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Input
                label={t('settings.addCategory')}
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCategory();
                  }
                }}
                placeholder={t('settings.categoryPlaceholder')}
                containerClassName="w-full sm:w-64"
                data-testid="expense-category-input"
              />
              <Button
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={addCategory}
                disabled={saving || !newCategory.trim()}
                data-testid="expense-category-add"
              >
                {t('common.add')}
              </Button>
              <Button
                leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void save()}
                loading={saving}
                disabled={!dirty}
                data-testid="expense-categories-save"
              >
                {t('common.save')}
              </Button>
            </div>

            <p className="text-[12px] leading-5 text-muted">
              {t('settings.expenseCategoriesHint')}
            </p>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

export default ExpenseCategoriesSection;
