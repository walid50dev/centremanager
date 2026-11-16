import { Check } from 'lucide-react';
import { cn } from '../../utils/format';

/** Shared visual progress indicator; navigation remains controlled by the wizard. */
export default function WizardProgress({
  labels,
  current,
  ariaLabel,
}: {
  labels: string[];
  current: number;
  ariaLabel: string;
}) {
  return (
    <ol
      className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white p-3 sm:grid-cols-4"
      aria-label={ariaLabel}
    >
      {labels.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const done = number < current;
        return (
          <li key={index} className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                active && 'bg-primary text-white shadow-[0_0_0_4px_rgba(37,99,235,0.12)]',
                done && 'bg-primary/10 text-primary',
                !active && !done && 'bg-slate-200/80 text-muted',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}
            </span>
            <span className={cn('min-w-0 text-[12px] font-medium leading-4', active ? 'text-foreground' : 'text-muted')}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
