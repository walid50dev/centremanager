import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Receipt } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import MoneyInput from '../ui/MoneyInput';
import CreatableEntitySelect from '../ui/CreatableEntitySelect';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import CategoryModal from '../entity-modals/CategoryModal';
import { ExpenseCategoryBadge } from './ExpenseCategoryBadge';
import { expensesApi } from '../../services/expenses';
import { categoryLabel } from '../../utils/expenses';
import type { Expense, ExpenseInput } from '../../types';

export interface ExpenseModalProps {
  open: boolean;
  /** `null` = create mode. */
  expense?: Expense | null;
  /** Period of the page selector — the new row belongs to it. */
  month: number;
  year: number;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  category: string;
  label: string;
  /** Centimes: `MoneyInput` keeps the conversion, the state stays integral. */
  amountCents: number;
  notes: string;
}

type FieldName = keyof FormState;
type Errors = Partial<Record<FieldName, string>>;

/**
 * Create / edit one expense.
 *
 * Month and year are **not** editable here: they come from the page selector, so
 * a charge always lands in the month the director is looking at. The category
 * list is read from `settings` every time the modal opens, which means a
 * category added in Settings is available immediately.
 */
export function ExpenseModal({
  open,
  expense = null,
  month,
  year,
  onClose,
  onSaved,
}: ExpenseModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(expense);

  const [form, setForm] = useState<FormState>({
    category: '',
    label: '',
    amountCents: 0,
    notes: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [quickCategory, setQuickCategory] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) setQuickCategory(false); }, [open]);

  // Categories of the current centre (they are editable in Settings).
  useEffect(() => {
    if (!open) return;
    let active = true;
    expensesApi
      .categories()
      .then((list) => {
        if (!active) return;
        setCategories(list);
        setForm((current) => ({
          ...current,
          // Default to the first category, unless we are editing.
          category: current.category || (expense ? expense.category : (list[0] ?? '')),
        }));
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [open, expense]);

  /** Reloaded after a quick-create so the new category is selectable. */
  const loadCategories = useCallback(async () => {
    const list = await expensesApi.categories();
    setCategories(list);
  }, []);

  // Prefill / reset on each opening.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      category: expense?.category ?? '',
      label: expense?.label ?? '',
      amountCents: expense?.amount_cents ?? 0,
      notes: expense?.notes ?? '',
    });
  }, [open, expense]);

  const set = useCallback(<K extends FieldName>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }, []);

  const validate = useCallback((): Errors => {
    const next: Errors = {};
    if (!form.category.trim()) next.category = t('expenses.validation.categoryRequired');
    if (!form.label.trim()) next.label = t('expenses.validation.labelRequired');
    if (!Number.isFinite(form.amountCents) || form.amountCents <= 0) {
      next.amountCents = t('expenses.validation.amountPositive');
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

      const payload: ExpenseInput = {
        label: form.label.trim(),
        amount_cents: Math.round(form.amountCents),
        category: form.category.trim(),
        month,
        year,
        notes: form.notes.trim() || null,
      };

      setSaving(true);
      try {
        if (isEdit && expense) {
          await expensesApi.update(expense.id, payload);
          toast.success(t('expenses.toast.updated'));
        } else {
          await expensesApi.create(payload);
          toast.success(t('expenses.toast.created'));
        }
        onSaved();
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    },
    [expense, form, isEdit, month, onClose, onSaved, t, validate, year],
  );

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
          {isEdit ? t('expenses.editTitle') : t('expenses.createTitle')}
        </span>
      }
      description={isEdit ? t('expenses.editDescription') : t('expenses.createDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="expense-form" loading={saving} data-testid="expense-save">
            {t('expenses.save')}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <CreatableEntitySelect
              testId="expense-category"
              label={t('expenses.category')}
              required
              placeholder={t('expenses.categoryPlaceholder')}
              options={categories}
              value={form.category || null}
              onChange={(category) => set('category', category ?? '')}
              getOptionLabel={(category) => categoryLabel(t, category)}
              getOptionValue={(category) => category}
              onCreate={() => setQuickCategory(true)}
              error={errors.category}
            />
            {/* The badge previews the colour the row will get in the table. */}
            {form.category ? (
              <span className="mt-2 inline-flex">
                <ExpenseCategoryBadge category={form.category} />
              </span>
            ) : null}
          </div>

          <Input
            label={t('expenses.label')}
            required
            value={form.label}
            onChange={(event) => set('label', event.target.value)}
            error={errors.label}
            placeholder={t('expenses.labelPlaceholder')}
            data-testid="expense-label"
          />
        </div>

        <MoneyInput
          label={t('expenses.amount')}
          required
          step={50}
          valueCents={form.amountCents}
          onChange={(cents) => set('amountCents', cents)}
          error={errors.amountCents}
          data-testid="expense-amount"
        />

        <Textarea
          label={t('expenses.notes')}
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder={t('expenses.notesPlaceholder')}
          hint={t('students.optional')}
          data-testid="expense-notes"
        />
      </form>
    </Modal>

      {quickCategory && open ? (
        <CategoryModal
          onClose={() => setQuickCategory(false)}
          onCreated={async (category) => {
            setQuickCategory(false);
            setCategories(current => current.includes(category) ? current : [...current, category]);
            set('category', category);
            void loadCategories().catch(() => {});
          }}
        />
      ) : null}
    </>
  );
}

export default ExpenseModal;
