import { Check } from 'lucide-react';
import { cn } from '../../utils/format';

/** Shared visual progress indicator; navigation remains controlled by the wizard. */
export default function WizardProgress({ labels, current, ariaLabel }: { labels: string[]; current: number; ariaLabel: string }) {
  return (
    <ol className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-border bg-slate-50/70 p-3 sm:grid-cols-4" aria-label={ariaLabel}>
      {labels.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const done = number < current;
        return (
          <li key={index} className="flex min-w-0 items-center gap-2">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', active ? 'bg-primary text-white' : done ? 'bg-primary/10 text-primary' : 'bg-slate-200/80 text-muted')} aria-current={active ? 'step' : undefined}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}
            </span>
            <span className={cn('min-w-0 text-[12px] font-medium leading-4', active ? 'text-foreground' : 'text-muted')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
