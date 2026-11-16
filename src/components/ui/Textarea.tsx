import { forwardRef, useId, useState, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/format';
import {
  FieldMessage,
  FieldRequiredMark,
  fieldLabelClass,
  fieldShellClass,
} from './fieldStyles';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

/** Multi-line twin of `Input` (floating label, same error / hint behaviour). */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    error,
    hint,
    className,
    containerClassName,
    id,
    required,
    rows = 3,
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
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const [focused, setFocused] = useState(false);
  const rawValue = value ?? defaultValue;
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).length > 0;
  const labeled = Boolean(label);
  const float = labeled && (focused || hasValue);

  return (
    <div className={cn('w-full', containerClassName)}>
      <div className={fieldShellClass({ error: Boolean(error), disabled, labeled, multiline: true })}>
        {label ? (
          <label
            htmlFor={textareaId}
            className={fieldLabelClass({ float, error: Boolean(error), focused, multiline: true })}
          >
            {label}
            {required ? <FieldRequiredMark /> : null}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          placeholder={labeled ? (focused ? placeholder : undefined) : placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cn(
            'min-h-[96px] w-full resize-y bg-transparent px-3.5 text-body text-foreground',
            'placeholder:text-muted/45 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
            labeled ? 'pb-3 pt-6' : 'py-3',
            className,
          )}
          {...props}
        />
      </div>
      <FieldMessage id={textareaId} error={error} hint={hint} />
    </div>
  );
});

export default Textarea;
