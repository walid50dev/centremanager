import { useId, useRef, useState } from 'react';
import { CURRENCY_SYMBOL, cn } from '../../utils/format';

export interface MoneyInputProps {
  /** Value in centimes (1 DH = 100). */
  valueCents: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  label?: string;
  error?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** `15000` → `"150"`, `15050` → `"150.50"` (the raw number shown while typing). */
function rawAmount(cents: number): string {
  const value = Number.isFinite(cents) ? cents : 0;
  return (value / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

/**
 * Amount field working in dirhams while the app stores centimes.
 *
 * * idle → `300.00` (two decimals),
 * * focused → the raw number (`300`), so the caret does not sit after zeros,
 * * only digits and a single decimal point, at most 2 decimals,
 * * right-aligned, with the `DH` suffix outside the input (RTL-safe).
 *
 * The displayed text is derived (`focused ? typed : formatted`), so an external
 * change of `valueCents` is reflected immediately without an effect sync.
 */
export function MoneyInput({
  valueCents,
  onChange,
  disabled = false,
  className,
  id,
  label,
  error,
  autoFocus = false,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // `typed` is `null` until the field is focused; the ref mirror lets the focus
  // handler seed it exactly once, even if an input event lands first.
  const [typed, setTypedState] = useState<string | null>(null);
  const typedRef = useRef<string | null>(null);
  const setTyped = (next: string | null) => {
    typedRef.current = next;
    setTypedState(next);
  };
  const [focused, setFocused] = useState(false);

  const display = focused
    ? typed ?? rawAmount(valueCents)
    : ((Number.isFinite(valueCents) ? valueCents : 0) / 100).toFixed(2);

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
    const [whole = '', ...rest] = cleaned.split('.');
    const decimals = rest.join('').slice(0, 2);
    const next = rest.length > 0 ? `${whole}.${decimals}` : whole;
    setTyped(next);
    const parsed = Number.parseFloat(next);
    onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
  };

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-label text-muted">
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border bg-white px-3',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
          disabled && 'bg-background',
          error ? 'border-destructive' : 'border-border',
        )}
      >
        <input
          id={inputId}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-invalid={Boolean(error)}
          value={display}
          onFocus={() => {
            setFocused(true);
            // Seed the raw value once so the caret does not sit after zeros.
            if (typedRef.current === null) setTyped(rawAmount(valueCents));
          }}
          onBlur={() => {
            setFocused(false);
            setTyped(null);
          }}
          onChange={(event) => handleChange(event.target.value)}
          className={cn(
            'h-full w-full bg-transparent text-end text-body tabular-nums text-foreground',
            'focus:outline-none disabled:cursor-not-allowed disabled:text-muted',
          )}
        />
        <span className="shrink-0 text-[13px] font-medium text-muted" aria-hidden="true">
          {CURRENCY_SYMBOL}
        </span>
      </div>
      {error && <p className="mt-1 text-[13px] text-destructive">{error}</p>}
    </div>
  );
}

export default MoneyInput;
