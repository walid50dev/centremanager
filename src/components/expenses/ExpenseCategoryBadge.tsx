import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { categoryLabel, categoryStyle } from '../../utils/expenses';
import { formatCurrency } from '../../utils/format';
import type { CategoryTotal } from '../../types';

export interface ExpenseCategoryBadgeProps {
  category: string;
  /** Optional amount, shown after the label (`Loyer · 1 200,00 DH`). */
  amountCents?: number;
  className?: string;
  'data-testid'?: string;
}

/**
 * Coloured badge naming a category.
 *
 * The colour and the icon come from `utils/expenses` so the badge, the summary
 * cards and the filter select always agree — a custom category gets a stable
 * colour out of the six-entry palette.
 */
export function ExpenseCategoryBadge({
  category,
  amountCents,
  className,
  'data-testid': testId,
}: ExpenseCategoryBadgeProps) {
  const { t } = useTranslation();
  const style = categoryStyle(category);
  const Icon = style.icon;

  return (
    <span
      className={[
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium',
        style.badge,
        className ?? '',
      ]
        .join(' ')
        .trim()}
      data-testid={testId}
      data-category={category}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{categoryLabel(t, category)}</span>
      {amountCents === undefined ? null : (
        <span className="shrink-0 tabular-nums opacity-80">· {formatCurrency(amountCents)}</span>
      )}
    </span>
  );
}

export interface CategorySummaryCardProps {
  line: CategoryTotal;
  /** Month total, used to show the share of the expenses. */
  totalCents: number;
  onClick?: () => void;
}

/** One mini card of the summary row: `🏠 Loyer — 1 200,00 DH (32 %)`. */
export function CategorySummaryCard({ line, totalCents, onClick }: CategorySummaryCardProps) {
  const { t } = useTranslation();
  const style = categoryStyle(line.category);
  const Icon = style.icon;
  const share = totalCents > 0 ? Math.round((line.total_cents / totalCents) * 100) : 0;

  const content = (
    <>
      <span className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.bubble}`}
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 truncate text-label text-muted">
          {categoryLabel(t, line.category)}
        </span>
      </span>
      <span className="mt-1.5 block text-[15px] font-semibold tabular-nums text-destructive">
        {formatCurrency(line.total_cents)}
      </span>
      {/* No `dir="ltr"` here: the percentage is isolated below, and forcing the
          direction would push it to the wrong end of the Arabic sentence. */}
      <span className="mt-0.5 block text-[11px] tabular-nums text-muted">
        {/* The percentage is isolated (U+2066…U+2069) so that Arabic keeps it on
            the right-hand side of the sentence instead of flipping it to the end. */}
        {t('expenses.summary.share', { pct: `\u2066${share} %\u2069` })}
      </span>
    </>
  );

  const className =
    'card block w-full p-3 text-start transition-colors hover:border-primary/40 hover:bg-primary/5';

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={className}
      data-testid={`expense-category-card-${line.category}`}
    >
      {content}
    </button>
  ) : (
    <div className={className} data-testid={`expense-category-card-${line.category}`}>
      {content}
    </div>
  );
}

export interface CategoryTagProps {
  category: string;
  onRemove: () => void;
  disabled?: boolean;
}

/** Removable chip used by the Settings category editor. */
export function CategoryTag({ category, onRemove, disabled = false }: CategoryTagProps) {
  const { t } = useTranslation();
  const style = categoryStyle(category);
  const Icon = style.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium ${style.badge}`}
      data-testid={`expense-category-tag-${category}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {categoryLabel(t, category)}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('settings.removeCategory', { name: categoryLabel(t, category) })}
        className="ms-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

export default ExpenseCategoryBadge;
