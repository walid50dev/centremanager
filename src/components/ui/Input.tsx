import {
  forwardRef,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock, Eye, EyeOff, Mail, Phone, Search } from 'lucide-react';
import { cn } from '../../utils/format';
import {
  FieldMessage,
  FieldRequiredMark,
  fieldControlClass,
  fieldLabelClass,
  fieldShellClass,
} from './fieldStyles';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
}

const DATE_TYPES = new Set(['date', 'time', 'month', 'datetime-local']);

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

function defaultIcon(type: string | undefined): ReactNode {
  switch (type) {
    case 'search':
      return <Search className="h-4 w-4" aria-hidden="true" />;
    case 'tel':
      return <Phone className="h-4 w-4" aria-hidden="true" />;
    case 'email':
      return <Mail className="h-4 w-4" aria-hidden="true" />;
    default:
      return null;
  }
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    leftIcon,
    rightIcon,
    prefix,
    suffix,
    className,
    containerClassName,
    id,
    required,
    type = 'text',
    disabled,
    value,
    defaultValue,
    placeholder,
    onFocus,
    onBlur,
    ...props
  },
  ref,
) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);

  const isDate = DATE_TYPES.has(type);
  const isPassword = type === 'password';
  const actualType = isPassword && reveal ? 'text' : type;
  const resolvedLeftIcon = leftIcon ?? defaultIcon(type);

  const rawValue = value ?? defaultValue;
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).length > 0;
  const labeled = Boolean(label);
  // Native date/time/month chrome ignores padding, so the label stays above the field.
  const floating = labeled && !isDate;
  const float = floating && (focused || hasValue);

  const trailingPad = Boolean(rightIcon || isPassword || (isDate && !leftIcon) || suffix);
  const customHeight = Boolean(!floating && className && /\bh-/.test(className));
  const labelClass = cn(
    'mb-1.5 block text-[13px] font-medium',
    error ? 'text-destructive' : 'text-muted',
  );

  return (
    <div className={cn('w-full', containerClassName)}>
      {isDate && label ? (
        <label htmlFor={inputId} className={labelClass}>
          {label}
          {required ? <FieldRequiredMark /> : null}
        </label>
      ) : null}
      <div
        className={cn(
          fieldShellClass({
            error: Boolean(error),
            disabled,
            labeled: floating,
            autoHeight: customHeight,
          }),
          !floating && className,
        )}
        data-focused={focused || undefined}
        data-filled={hasValue || undefined}
      >
        {resolvedLeftIcon ? (
          <span
            className={cn(
              'pointer-events-none absolute z-[1] flex items-center text-muted',
              'start-3',
              floating ? 'top-[26px]' : 'inset-y-0',
            )}
          >
            {resolvedLeftIcon}
          </span>
        ) : null}

        {prefix ? (
          <span
            className={cn(
              'absolute z-[1] select-none text-[12px] font-medium text-muted',
              resolvedLeftIcon ? 'start-10' : 'start-3.5',
              floating ? 'top-[26px]' : 'top-1/2 -translate-y-1/2',
            )}
            aria-hidden="true"
          >
            {prefix}
          </span>
        ) : null}

        {floating ? (
          <label
            htmlFor={inputId}
            className={fieldLabelClass({
              float,
              error: Boolean(error),
              focused,
              icon: Boolean(resolvedLeftIcon || prefix),
            })}
          >
            {label}
            {required ? <FieldRequiredMark /> : null}
          </label>
        ) : null}

        <div
          className={cn(
            'flex h-full min-w-0 flex-1 items-center',
            Boolean(resolvedLeftIcon || prefix) && 'ps-10',
            trailingPad && 'pe-10',
          )}
        >
          <input
            ref={(node) => {
              innerRef.current = node;
              assignRef(ref, node);
            }}
            id={inputId}
            type={actualType}
            required={required}
            disabled={disabled}
            value={value}
            defaultValue={defaultValue}
            placeholder={floating ? (focused ? placeholder : undefined) : placeholder}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            className={cn(
              fieldControlClass({ labeled: floating }),
              isDate && 'date-input',
              customHeight && 'py-0',
              floating && className,
            )}
            {...props}
          />
        </div>

        {suffix ? (
          <span
            className={cn(
              'absolute z-[1] select-none text-[12px] font-semibold text-muted',
              'end-3',
              floating ? 'top-[26px]' : 'top-1/2 -translate-y-1/2',
            )}
            aria-hidden="true"
          >
            {suffix}
          </span>
        ) : null}

        {isDate && !rightIcon && !leftIcon ? (
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-hidden="true"
            onClick={() => {
              const node = innerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
              node?.showPicker?.();
              node?.focus();
            }}
            className={cn(
              'absolute end-2 z-[1] flex h-8 w-8 items-center justify-center rounded-lg text-muted',
              'transition-colors hover:bg-slate-100 hover:text-foreground',
              floating ? 'top-[18px]' : 'top-1/2 -translate-y-1/2',
            )}
          >
            {type === 'time' ? (
              <Clock className="h-4 w-4" aria-hidden="true" />
            ) : (
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}

        {isPassword ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setReveal((current) => !current);
              innerRef.current?.focus();
            }}
            aria-label={reveal ? t('common.hidePassword') : t('common.showPassword')}
            className={cn(
              'absolute end-2 z-[1] flex h-8 w-8 items-center justify-center rounded-lg text-muted',
              'transition-colors hover:bg-slate-100 hover:text-foreground',
              floating ? 'top-[18px]' : 'top-1/2 -translate-y-1/2',
            )}
          >
            {reveal ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}

        {rightIcon && !isPassword ? (
          <span
            className={cn(
              'pointer-events-none absolute end-3 z-[1] flex items-center text-muted',
              floating ? 'top-[26px]' : 'inset-y-0',
            )}
          >
            {rightIcon}
          </span>
        ) : null}
      </div>
      <FieldMessage id={inputId} error={error} hint={hint} />
    </div>
  );
});

export default Input;
