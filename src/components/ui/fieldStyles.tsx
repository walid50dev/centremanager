import type { ReactNode } from 'react';
import { cn } from '../../utils/format';

/** Shared chrome for every text-like control (input, select, number, textarea). */
export function fieldShellClass(opts: {
  error?: boolean;
  disabled?: boolean;
  labeled?: boolean;
  multiline?: boolean;
  /** Skip the default 44/52px height so the caller can pass `h-8`, etc. */
  autoHeight?: boolean;
} = {}) {
  return cn(
    'group/field relative flex w-full border text-body text-foreground',
    'rounded-[14px] bg-gradient-to-b from-white to-slate-50/80',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(15,23,42,0.04)]',
    'transition-[border-color,box-shadow,background-color,transform] duration-150 ease-out',
    'hover:border-slate-300 hover:from-white hover:to-white',
    'focus-within:border-primary/70 focus-within:from-white focus-within:to-white',
    'focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_0_0_4px_rgba(37,99,235,0.14)]',
    opts.error
      ? 'border-destructive/55 hover:border-destructive/70 focus-within:border-destructive focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_0_0_4px_rgba(220,38,38,0.12)]'
      : 'border-slate-200/90',
    opts.disabled && 'pointer-events-none bg-slate-100/80 from-slate-50 to-slate-100/80 opacity-70',
    opts.multiline
      ? 'min-h-[96px] items-stretch'
      : opts.autoHeight
        ? 'items-center'
        : opts.labeled
          ? 'h-[52px] items-center'
          : 'h-11 items-center',
  );
}

export function fieldLabelClass(opts: {
  float: boolean;
  error?: boolean;
  focused?: boolean;
  icon?: boolean;
  multiline?: boolean;
}) {
  return cn(
    'pointer-events-none absolute z-[1] max-w-[calc(100%-1.75rem)] truncate font-medium',
    'transition-all duration-150 ease-out',
    opts.icon ? 'start-10' : 'start-3.5',
    opts.float
      ? 'top-[7px] text-[11px] leading-4'
      : opts.multiline
        ? 'top-3.5 text-[13px] leading-4'
        : 'top-1/2 -translate-y-1/2 text-[13px] leading-4',
    opts.error
      ? 'text-destructive'
      : opts.focused && opts.float
        ? 'text-primary'
        : 'text-muted',
  );
}

export function fieldControlClass(opts: {
  labeled?: boolean;
  icon?: boolean;
  trailing?: boolean;
} = {}) {
  return cn(
    'h-full min-w-0 flex-1 bg-transparent text-body text-foreground',
    'placeholder:text-muted/45 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
    opts.labeled ? 'px-3.5 pb-[9px] pt-[22px]' : 'px-3.5 py-2.5',
    opts.icon && (opts.labeled ? 'ps-10' : 'ps-10'),
    opts.trailing && 'pe-10',
  );
}

export function fieldHintClass(error?: boolean) {
  return cn('mt-1.5 text-[12px] leading-4', error ? 'text-destructive' : 'text-muted');
}

export function FieldMessage({
  id,
  error,
  hint,
  testId,
}: {
  id: string;
  error?: string;
  hint?: string;
  testId?: string;
}) {
  if (error) {
    return (
      <p id={`${id}-error`} className={fieldHintClass(true)} data-testid={testId} role="alert">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className={fieldHintClass(false)}>
        {hint}
      </p>
    );
  }
  return null;
}

export function FieldRequiredMark() {
  return (
    <span className="ms-0.5 text-destructive/80" aria-hidden="true">
      *
    </span>
  );
}

export function FieldAdornment({
  children,
  side,
  labeled,
}: {
  children: ReactNode;
  side: 'start' | 'end';
  labeled?: boolean;
}) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-[1] flex items-center text-muted',
        side === 'start' ? 'start-3' : 'end-3',
        labeled ? 'top-[26px]' : 'inset-y-0',
        !labeled && 'inset-y-0',
      )}
    >
      {children}
    </span>
  );
}
