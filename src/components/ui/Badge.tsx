import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/format';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'muted';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  muted: 'bg-slate-100 text-muted',
};

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('badge', variantClasses[variant], className)} {...props}>
      {children}
    </span>
  );
}

/** Maps a backend status string to a badge variant. */
export function statusVariant(status?: string | null): BadgeVariant {
  switch ((status ?? '').toLowerCase()) {
    case 'actif':
    case 'payé':
    case 'paye':
    case 'paid':
    case 'termine':
    case 'terminé':
      return 'success';
    case 'partiel':
    case 'pending':
      return 'warning';
    case 'impayé':
    case 'impaye':
    case 'annulé':
    case 'annule':
      return 'destructive';
    case 'inactif':
      return 'muted';
    default:
      return 'default';
  }
}

export interface StatusBadgeProps {
  status?: string | null;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <Badge variant={statusVariant(status)} className={className}>
      {label ?? status ?? '—'}
    </Badge>
  );
}

export default Badge;
