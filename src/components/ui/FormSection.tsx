import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/format';

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Number of columns from `sm` and up. Default `2`. Pass `1` for a stacked block. */
  columns?: 1 | 2;
  children: ReactNode;
}

/** Logical card used to group fields inside a form or a modal. */
export function FormSection({
  title,
  description,
  columns = 2,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
        className,
      )}
      {...props}
    >
      {title || description ? (
        <header className="mb-4">
          {title ? (
            <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          ) : null}
          {description ? <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p> : null}
        </header>
      ) : null}
      <div className={cn('grid grid-cols-1 gap-4', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    </section>
  );
}

export default FormSection;
