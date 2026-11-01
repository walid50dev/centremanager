import type { ReactNode } from 'react';
import { cn } from '../../utils/format';

export interface EmptyStateProps {
  /** Illustration/icon rendered inside a tinted circle. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action (usually a Button). */
  action?: ReactNode;
  className?: string;
}

/** Centred “nothing here yet” block used by tables and placeholder tabs. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && (
        <span
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <p className="text-btn font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-[13px] leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;
