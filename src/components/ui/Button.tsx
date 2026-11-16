import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/format';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white shadow-[0_1px_2px_rgba(37,99,235,0.35)] hover:bg-primary/90 hover:shadow-[0_6px_16px_rgba(37,99,235,0.28)]',
  secondary:
    'bg-white text-foreground border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:bg-slate-50',
  destructive:
    'bg-destructive text-white shadow-[0_1px_2px_rgba(220,38,38,0.3)] hover:bg-destructive/90',
  ghost: 'bg-transparent text-muted hover:bg-slate-100 hover:text-foreground',
  outline: 'border border-primary/30 text-primary bg-primary/[0.03] hover:bg-primary/10',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg',
  md: 'h-11 px-4 text-btn rounded-xl',
  lg: 'h-12 px-5 text-btn rounded-xl',
  icon: 'h-10 w-10 p-0 rounded-xl',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn('btn btn-press', variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
