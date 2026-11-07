import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/format';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

/** Multi-line twin of `Input` (same label / error / hint behaviour). */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, containerClassName, id, required, rows = 3, ...props },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label htmlFor={textareaId} className="mb-1.5 block text-label text-muted">
          {label}
          {required && <span className="ms-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
        className={cn(
          'w-full resize-y rounded-md border bg-white px-3 py-2 text-body text-foreground',
          'placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          'disabled:cursor-not-allowed disabled:bg-background disabled:text-muted',
          error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border',
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${textareaId}-error`} className="mt-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${textareaId}-hint`} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Textarea;
