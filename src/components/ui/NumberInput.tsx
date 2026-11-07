import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../utils/format';

export interface NumberInputProps {
  /** Numeric value; `NaN` is treated as an empty field. */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment used by the +/- buttons and by the arrow keys. Default `1`. */
  step?: number;
  /** Decimal places accepted and displayed. Default `0` (integer). */
  decimals?: number;
  /** Unit shown inside the field, after the number (e.g. `DH`, `%`, `h`). */
  suffix?: string;
  prefix?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
  allowNegative?: boolean;
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** Emitted when the field is left, after clamping. */
  onBlur?: () => void;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** `1234567.5` with `decimals = 2` → `1 234 567.50` (narrow no-break spaces). */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '';
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = value < 0 ? '-' : '';
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/** Parse what the user typed (spaces, commas, Arabic separators tolerated). */
export function parseNumber(input: string): number {
  const cleaned = input
    .replace(/[\u00A0\u202F\u2009]/g, '') // all the spaces we may have written
    .replace(/[,\u066B]/g, '.') // decimal comma / Arabic decimal separator
    .replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return NaN;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 100;

/**
 * Numeric field used everywhere in the app.
 *
 * A native `<input type="number">` is rejected on purpose: it renders spinners
 * that do not match the design system, changes value on an accidental wheel
 * scroll, and shows no thousands separator. This component is a `type="text"`
 * field with `inputMode="decimal"` that:
 *
 * * accepts digits, one decimal separator and (optionally) a minus sign, and
 *   enforces the decimal count while typing,
 * * shows the **raw** number while focused (easy to edit) and the **grouped**
 *   number on blur (`1 234 567`, `1 234.50`),
 * * clamps to `min` / `max` on blur,
 * * offers +/- buttons inside the field (hidden when `disabled` or `step <= 0`),
 *   with hold-to-repeat every 100 ms,
 * * keeps the digits **LTR** even in Arabic: the wrapper carries `dir="ltr"`,
 *   so in RTL the buttons and the suffix simply move to the left edge.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = 0,
  suffix,
  prefix,
  placeholder,
  disabled = false,
  className,
  containerClassName,
  allowNegative = false,
  id,
  label,
  hint,
  error,
  required = false,
  autoFocus = false,
  onBlur,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: NumberInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  /** What the user is typing right now; `null` when the field is idle. */
  const [typed, setTyped] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectOnMouseUp = useRef(false);
  const selectionAfterRender = useRef<{ start: number; end: number } | null>(null);

  // Focus changes the formatted value to the raw draft. Select after that render,
  // otherwise React's value update can collapse the browser's selection.
  useLayoutEffect(() => {
    if (!focused || !inputRef.current) return;
    if (selectionAfterRender.current) {
      const { start, end } = selectionAfterRender.current;
      inputRef.current.setSelectionRange(start, end);
      selectionAfterRender.current = null;
    }
  }, [focused, typed]);

  // A disabled field must not keep a stale draft.
  useEffect(() => {
    if (disabled) setTyped(null);
  }, [disabled]);

  const clamp = useCallback(
    (next: number): number => {
      if (!Number.isFinite(next)) return next;
      let result = next;
      if (min !== undefined && result < min) result = min;
      if (max !== undefined && result > max) result = max;
      return result;
    },
    [min, max],
  );

  const display = useMemo(() => {
    if (focused && typed !== null) return typed;
    if (!Number.isFinite(value)) return '';
    // Idle: grouped and fixed to the requested precision.
    return formatNumber(value, decimals);
  }, [focused, typed, value, decimals]);

  const emit = (next: number) => {
    onChange(Number.isFinite(next) ? next : 0);
  };

  /** Keep only what a number may contain, honouring the decimal count. */
  const sanitise = (raw: string): string => {
    let text = raw.replace(/[\u00A0\u202F\u2009]/g, '').replace(/[,\u066B]/g, '.');
    text = allowNegative ? text.replace(/[^\d.-]/g, '') : text.replace(/[^\d.]/g, '');

    const negative = allowNegative && text.startsWith('-');
    text = text.replace(/-/g, '');

    const [wholeRaw = '', ...rest] = text.split('.');
    const whole = wholeRaw.replace(/^0+(?=\d)/, ''); // `007` → `7`
    const fraction = rest.join('').slice(0, decimals); // extra decimals dropped
    const body = rest.length > 0 && decimals > 0 ? `${whole}.${fraction}` : whole;
    return `${negative ? '-' : ''}${body}`;
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const clean = sanitise(raw);
    if (clean !== raw) {
      const start = event.currentTarget.selectionStart ?? raw.length;
      const end = event.currentTarget.selectionEnd ?? start;
      const selection = { start: sanitise(raw.slice(0, start)).length, end: sanitise(raw.slice(0, end)).length };
      if (clean === typed) {
        // An ignored character may leave the draft unchanged, so React will not
        // render. Restore the caret after it restores the controlled input value.
        const input = event.currentTarget;
        selectionAfterRender.current = null;
        queueMicrotask(() => {
          if (document.activeElement === input && input.value === clean) input.setSelectionRange(selection.start, selection.end);
        });
      } else {
        selectionAfterRender.current = selection;
      }
    }
    setTyped(clean);
    const parsed = parseNumber(clean);
    // Emit while typing (parents need live feedback for validation), `0` for an
    // empty field — the blur handler clamps and re-emits.
    emit(Number.isFinite(parsed) ? parsed : 0);
  };

  const commit = () => {
    const parsed = focused && typed !== null ? parseNumber(typed) : value;
    const next = Number.isFinite(parsed) ? clamp(parsed) : (min ?? 0);
    setFocused(false);
    setTyped(null);
    if (next !== value) emit(next);
    onBlur?.();
  };

  const nudge = (direction: 1 | -1) => {
    const base = Number.isFinite(value) ? value : 0;
    const next = clamp(Number((base + direction * step).toFixed(decimals + 2)));
    setTyped(null);
    emit(next);
  };

  // ------------------------------------------------------------ hold-repeat
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);

  const stopHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdInterval.current !== null) {
      window.clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
  }, []);

  const startHold = (direction: 1 | -1) => {
    nudge(direction);
    stopHold();
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => nudge(direction), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  useEffect(() => stopHold, [stopHold]);

  const showButtons = !disabled && step > 0;
  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-label text-muted">
          {label}
          {required && <span className="ms-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}

      {/* `dir="ltr"` keeps digits and the +/− column in reading order in Arabic;
          the wrapper itself mirrors because it is a normal flex row. */}
      <div
        dir="ltr"
        className={cn(
          'flex h-9 w-full items-center rounded-md border bg-white',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
          disabled && 'bg-background',
          error ? 'border-destructive' : 'border-border',
        )}
        data-number-input=""
      >
        {prefix && (
          <span className="shrink-0 ps-3 text-[13px] text-muted" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          data-testid={testId}
          type="text"
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          // No native spinner, no wheel hijack, no autocomplete noise.
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="spinbutton"
          aria-valuenow={Number.isFinite(value) ? value : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={ariaLabel ?? label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          value={display}
          onMouseDown={() => { selectOnMouseUp.current = document.activeElement !== inputRef.current; }}
          onMouseUp={(event) => {
            if (selectOnMouseUp.current) event.currentTarget.select();
            selectOnMouseUp.current = false;
          }}
          onFocus={(event) => {
            const raw = Number.isFinite(value) ? String(value) : '';
            selectionAfterRender.current = { start: 0, end: raw.length };
            setFocused(true);
            setTyped(raw);
            event.currentTarget.select();
          }}
          onBlur={commit}
          onChange={handleChange}
          onWheel={(event) => {
            // Scrolling the page must never change a fee or a capacity.
            if (document.activeElement === inputRef.current) {
              event.currentTarget.blur();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(-1);
            } else if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-end text-body tabular-nums text-foreground',
            'placeholder:text-muted/70 focus:outline-none',
            'disabled:cursor-not-allowed disabled:text-muted',
            'ps-3',
            showButtons || suffix ? 'pe-1' : 'pe-3',
            className,
          )}
        />

        {suffix && (
          <span
            className="shrink-0 select-none pe-1 text-[13px] font-medium text-muted"
            aria-hidden="true"
          >
            {suffix}
          </span>
        )}

        {showButtons && (
          <span className="flex h-full shrink-0 flex-col border-s border-border">
            <button
              type="button"
              tabIndex={-1}
              data-testid={testId ? `${testId}-up` : undefined}
              aria-label="+"
              disabled={atMax}
              onMouseDown={(event) => {
                event.preventDefault(); // keep the input focused
                startHold(1);
              }}
              onMouseUp={stopHold}
              onMouseLeave={stopHold}
              onTouchStart={(event) => {
                event.preventDefault();
                startHold(1);
              }}
              onTouchEnd={stopHold}
              className={cn(
                'flex h-1/2 w-7 items-center justify-center text-muted transition-colors',
                'hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              data-testid={testId ? `${testId}-down` : undefined}
              aria-label="-"
              disabled={atMin}
              onMouseDown={(event) => {
                event.preventDefault();
                startHold(-1);
              }}
              onMouseUp={stopHold}
              onMouseLeave={stopHold}
              onTouchStart={(event) => {
                event.preventDefault();
                startHold(-1);
              }}
              onTouchEnd={stopHold}
              className={cn(
                'flex h-1/2 w-7 items-center justify-center border-t border-border text-muted transition-colors',
                'hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export default NumberInput;
