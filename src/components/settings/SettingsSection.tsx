import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/format';

export interface SettingsSectionProps {
  icon: ReactNode;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible settings card: icon + title + chevron header, content below. */
export function SettingsSection({
  icon,
  title,
  description,
  defaultOpen = false,
  children,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-start transition-colors hover:bg-background"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-h2 font-semibold text-foreground">{title}</span>
          {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </section>
  );
}

export default SettingsSection;
