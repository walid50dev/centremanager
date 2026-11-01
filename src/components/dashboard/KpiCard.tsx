import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '../ui/Card';
import { cn } from '../../utils/format';
import { trendText, type Trend } from '../../utils/dashboard';

export interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  /** Already formatted (currency, percentage, count…). */
  value: ReactNode;
  /** Tailwind classes of the icon bubble (`bg-primary/10 text-primary`). */
  iconClass: string;
  /** Optional colour override of the value itself (collection rate). */
  valueClass?: string;
  /** Comparison with the previous month — omitted on the “no trend” cards. */
  trend?: Trend;
  /** Small line under the value (ratio, “vs le mois précédent”…). */
  hint?: ReactNode;
  hintClass?: string;
  showTrendHint?: boolean;
  testId?: string;
}

/**
 * One headline number of the dashboard.
 *
 * Layout: icon bubble + label on the first line, the value below, then either
 * the trend arrow (`+82%`, green when it improved) or a short hint.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  iconClass,
  valueClass,
  trend,
  hint,
  hintClass,
  showTrendHint = false,
  testId,
}: KpiCardProps) {
  const { t } = useTranslation();
  const direction = trend?.direction ?? 'stable';
  const TrendIcon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const trendClass =
    direction === 'up'
      ? 'text-success'
      : direction === 'down'
        ? 'text-destructive'
        : 'text-muted';

  return (
    <Card className="p-4" data-testid={testId}>
      {/* Below `sm` the bubble sits above the label so the words keep the full
          card width instead of breaking mid-word. */}
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span
          className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', iconClass)}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 text-label leading-4 text-muted">{label}</span>
      </div>

      <p
        className={cn('mt-2 text-2xl font-bold tabular-nums text-foreground', valueClass)}
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </p>

      {trend ? (
        <p
          className={cn('mt-1 flex items-center gap-1 text-[12px] font-medium', trendClass)}
          data-testid={testId ? `${testId}-trend` : undefined}
          data-direction={direction}
        >
          <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {/* dir="ltr": in Arabic the leading sign must stay in front. */}
          <span className="tabular-nums" dir="ltr">
            {trendText(t, trend)}
          </span>
          {showTrendHint ? <span className="font-normal text-muted">{hint}</span> : null}
        </p>
      ) : hint ? (
        <p
          className={cn('mt-1 text-[12px] tabular-nums text-muted', hintClass)}
          data-testid={testId ? `${testId}-hint` : undefined}
        >
          {hint}
        </p>
      ) : null}
    </Card>
  );
}

export default KpiCard;
