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
  /** Native tooltip (`title`) — used for the net-income breakdown. */
  tooltip?: string;
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
  tooltip,
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
    <Card
      className="flex h-full min-h-[144px] min-w-0 flex-col rounded-xl border-slate-200/90 bg-white p-5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-slate-300 hover:shadow-sm motion-reduce:transition-none"
      data-testid={testId}
      title={tooltip}
      data-tooltip={tooltip}
    >
      <div className="flex min-h-[36px] min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 pt-1 text-[13px] font-medium leading-5 text-muted">{label}</span>
        <span
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconClass)}
          aria-hidden="true"
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>

      <div className="mt-auto min-w-0 pt-3">
        <p
          className={cn('break-words text-[26px] font-semibold leading-tight tracking-tight tabular-nums', valueClass || 'text-foreground')}
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {value}
        </p>

        {trend ? (
          <p
            className={cn('mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] font-medium leading-4', trendClass)}
            data-testid={testId ? `${testId}-trend` : undefined}
            data-direction={direction}
          >
            <TrendIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* dir="ltr": in Arabic the leading sign must stay in front. */}
            <span className="tabular-nums" dir="ltr">{trendText(t, trend)}</span>
            {showTrendHint ? <span className="font-normal text-muted">{hint}</span> : null}
          </p>
        ) : hint ? (
          <p
            className={cn('mt-2 break-words text-[12px] leading-4 tabular-nums text-muted', hintClass)}
            data-testid={testId ? `${testId}-hint` : undefined}
          >
            {hint}
          </p>
        ) : <span aria-hidden="true" className="mt-2 block h-4" />}
      </div>
    </Card>
  );
}

export default KpiCard;
