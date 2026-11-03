import NumberInput from './NumberInput';

export interface MoneyInputProps {
  /** Value in centimes (1 DH = 100). */
  valueCents: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** Increment of the +/- buttons, in dirhams. Default `10`. */
  step?: number;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * Amount field working in dirhams while the app stores centimes.
 *
 * Since Phase 10 this is a thin wrapper around `NumberInput`, so it inherits the
 * grouped display (`1 234.50`), the `DH` suffix, the +/- buttons, the wheel
 * protection and the RTL behaviour for free. Only the conversion lives here:
 * `valueCents / 100` going in, `Math.round(value * 100)` coming out.
 */
export function MoneyInput({
  valueCents,
  onChange,
  disabled = false,
  className,
  containerClassName,
  id,
  label,
  hint,
  error,
  required,
  autoFocus = false,
  step = 10,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: MoneyInputProps) {
  const cents = Number.isFinite(valueCents) ? valueCents : 0;

  return (
    <NumberInput
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      autoFocus={autoFocus}
      disabled={disabled}
      className={className}
      containerClassName={containerClassName}
      aria-label={ariaLabel}
      data-testid={testId}
      value={cents / 100}
      decimals={2}
      min={0}
      step={step}
      suffix="DH"
      onChange={(next) => onChange(Math.round(next * 100))}
    />
  );
}

export default MoneyInput;
