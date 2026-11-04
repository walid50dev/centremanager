import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import MonthPicker from '../components/ui/MonthPicker';
import ViewButton from '../components/ui/ViewButton';
import Modal from '../components/ui/Modal';
import Card from '../components/ui/Card';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import Select from '../components/ui/Select';
import ExpenseModal from '../components/expenses/ExpenseModal';
import {
  CategorySummaryCard,
  ExpenseCategoryBadge,
} from '../components/expenses/ExpenseCategoryBadge';
import { toast } from '../components/ui/Toast';
import { expensesApi } from '../services/expenses';
import { currentPeriod } from '../services/payments';
import { categoryLabel } from '../utils/expenses';
import { cn, formatCurrency, formatDateTime } from '../utils/format';
import { monthLabel } from '../utils/billing';
import type { Expense, ExpensesSummary } from '../types';

const EMPTY_SUMMARY: ExpensesSummary = { total_cents: 0, by_category: [], count: 0 };

/**
 * Monthly expenses (Phase 11).
 *
 * The charges of one month — rent, WiFi, electricity, water, the assistant's
 * salary, supplies — so the director can read the real profit next to the
 * revenue. Everything is scoped to the calendar period; a category filter
 * narrows the table but not the summary cards.
 */
export function ExpensesPage() {
  const { t } = useTranslation();

  const [period, setPeriod] = useState(currentPeriod);
  const { month, year } = period;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpensesSummary>(EMPTY_SUMMARY);
  const [categories, setCategories] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, totals, categoryList] = await Promise.all([
        expensesApi.list(month, year, null),
        expensesApi.summary(month, year),
        expensesApi.categories(),
      ]);
      setExpenses(rows);
      setSummary(totals);
      setCategories(categoryList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setExpenses([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter ? expenses.filter((expense) => expense.category === filter) : expenses),
    [expenses, filter],
  );

  const filteredTotal = useMemo(
    () => visible.reduce((sum, expense) => sum + expense.amount_cents, 0),
    [visible],
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await expensesApi.remove(deleting.id);
      toast.success(t('expenses.toast.deleted'));
      setDeleting(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
    }
  };

  /** Categories offered by the filter: the configured ones plus any legacy value. */
  const filterCategories = useMemo(() => {
    const seen = new Set(categories.map((entry) => entry.toLowerCase()));
    const extra = expenses
      .map((expense) => expense.category)
      .filter((category) => !seen.has(category.toLowerCase()));
    return [...categories, ...new Set(extra)];
  }, [categories, expenses]);

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-h1 text-foreground" data-testid="expenses-title">
            {t('expenses.title')}
            {!loading && summary.count > 0 && (
              <Badge variant="muted" data-testid="expenses-count-badge">
                {summary.count}
              </Badge>
            )}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">{t('expenses.intro')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={period}
            onChange={(value) => { setPeriod(value); setFilter(''); }}
            label={t('expenses.period')}
            testId="expenses-period"
          />
          <Button leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openCreate} data-testid="expense-new">
            {t('expenses.new')}
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------------------- summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="expenses-summary">
        <Card className="p-4" data-testid="expenses-total-card">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              aria-hidden="true"
            >
              <Wallet className="h-4 w-4" />
            </span>
            <span className="text-label text-muted">{t('expenses.total')}</span>
          </div>
          <p
            className="mt-2 text-2xl font-bold tabular-nums text-destructive"
            data-testid="expenses-total-value"
          >
            {formatCurrency(summary.total_cents)}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {monthLabel(t, month)} {year}
          </p>
        </Card>

        <Card className="p-4" data-testid="expenses-count-card">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Receipt className="h-4 w-4" />
            </span>
            <span className="text-label text-muted">{t('expenses.summary.count')}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground" data-testid="expenses-count-value">
            {summary.count}
          </p>
          <p className="mt-1 text-[12px] text-muted">{t('expenses.period')}</p>
        </Card>

        {/* One mini card per category, biggest first. */}
        {summary.by_category.map((line) => (
          <CategorySummaryCard
            key={line.category}
            line={line}
            totalCents={summary.total_cents}
            onClick={() => setFilter(line.category === filter ? '' : line.category)}
          />
        ))}
      </div>

      {/* ------------------------------------------------------------------ table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-h2 text-foreground">{t('expenses.summary.byCategory')}</h2>
            {filter && (
              <button
                type="button"
                onClick={() => setFilter('')}
                className="text-[12px] text-primary hover:underline"
                data-testid="expenses-clear-filter"
              >
                {t('students.clearFilters')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('expenses.category')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('expenses.allCategories')}
              options={filterCategories.map((category) => ({
                value: category,
                label: categoryLabel(t, category),
              }))}
              containerClassName="w-52"
              data-testid="expenses-filter"
            />
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <div className="skeleton h-5 w-24" />
                <div className="skeleton h-3 w-40 flex-1" />
                <div className="skeleton h-3 w-20" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
            title={filter ? t('expenses.emptyFiltered') : t('expenses.empty')}
            description={filter ? undefined : t('expenses.emptyHint')}
            action={
              filter ? undefined : (
                <Button
                  leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={openCreate}
                  data-testid="expenses-empty-add"
                >
                  {t('expenses.add')}
                </Button>
              )
            }
            className="py-12"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="expenses-table">
              <thead className="bg-background text-label text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('expenses.columns.category')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('expenses.columns.label')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('expenses.columns.amount')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('expenses.columns.notes')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('expenses.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((expense) => (
                  <tr
                    key={expense.id}
                    className="border-t border-border transition-colors hover:bg-slate-50"
                    data-testid={`expense-row-${expense.id}`}
                  >
                    <td className="px-4 py-2.5">
                      <ExpenseCategoryBadge category={expense.category} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">{expense.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {t('expenses.createdAt')} {formatDateTime(expense.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold tabular-nums text-destructive">
                      {formatCurrency(expense.amount_cents)}
                    </td>
                    <td className="max-w-[18rem] px-4 py-2.5 text-muted">
                      <span className="line-clamp-2">{expense.notes || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <ViewButton name={expense.label} testId={`view-expense-${expense.id}`} onView={() => setViewing(expense)} />
                        <button
                          type="button"
                          onClick={() => openEdit(expense)}
                          aria-label={t('expenses.editTitle')}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-primary/10 hover:text-primary"
                          data-testid={`expense-edit-${expense.id}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(expense)}
                          aria-label={t('expenses.delete')}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`expense-delete-${expense.id}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-background">
                <tr>
                  <td
                    className="px-4 py-2.5 text-label text-muted"
                    colSpan={2}
                    data-testid="expenses-footer-count"
                  >
                    {filter
                      ? `${categoryLabel(t, filter)} — ${t('expenses.count', { count: visible.length })}`
                      : t('expenses.count', { count: visible.length })}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-end text-[14px] font-bold tabular-nums text-destructive',
                    )}
                    data-testid="expenses-footer-total"
                  >
                    {formatCurrency(filteredTotal)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={t('actions.view')}
        testId="expense-detail" footer={<Button variant="secondary" onClick={() => setViewing(null)}>{t('common.close')}</Button>}>
        {viewing && <dl className="space-y-4 text-[13px]">
          <div><dt className="text-muted">{t('expenses.category')}</dt><dd><ExpenseCategoryBadge category={viewing.category} /></dd></div>
          <div><dt className="text-muted">{t('expenses.label')}</dt><dd dir="auto">{viewing.label}</dd></div>
          <div><dt className="text-muted">{t('expenses.amount')}</dt><dd>{formatCurrency(viewing.amount_cents)}</dd></div>
          <div><dt className="text-muted">{t('expenses.notes')}</dt><dd dir="auto" className="whitespace-pre-wrap break-words">{viewing.notes || '—'}</dd></div>
          <div><dt className="text-muted">{t('expenses.period')}</dt><dd>{monthLabel(t, viewing.month)} {viewing.year}</dd></div>
          <div><dt className="text-muted">{t('expenses.createdAt')}</dt><dd>{formatDateTime(viewing.created_at)}</dd></div>
        </dl>}
      </Modal>

      <ExpenseModal
        open={modalOpen}
        expense={editing}
        month={month}
        year={year}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('expenses.deleteTitle')}
        message={t('trash.confirm_delete')}
        confirmLabel={t('expenses.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={removing}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export default ExpensesPage;
