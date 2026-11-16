import type { ChangeEvent } from 'react';
import Input from './Input';
import { cn } from '../../utils/format';

export interface CalendarPeriod {
  month: number;
  year: number;
}

/** Calendar billing period, not a school-year selector. */
export default function MonthPicker({
  value,
  onChange,
  label,
  testId,
  inline = false,
}: {
  value: CalendarPeriod;
  onChange: (value: CalendarPeriod) => void;
  label: string;
  testId: string;
  /** Put the label beside the field so it can sit on a toolbar next to buttons. */
  inline?: boolean;
}) {
  const formatted = `${value.year}-${String(value.month).padStart(2, '0')}`;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const match = /^(\d{4})-(\d{2})$/.exec(event.target.value);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      onChange({ month, year });
    }
  };
  return (
    <div className={cn('flex min-w-0', inline ? 'items-center gap-2' : 'w-full')}>
      {inline ? (
        <span className="shrink-0 whitespace-nowrap text-[13px] font-medium text-muted" aria-hidden="true">
          {label}
        </span>
      ) : null}
      <Input
        type="month"
        min="2000-01"
        max="2100-12"
        value={formatted}
        onChange={handleChange}
        aria-label={label}
        label={inline ? undefined : label}
        data-testid={testId}
        containerClassName={inline ? 'w-[12rem] max-w-full shrink-0' : undefined}
      />
    </div>
  );
}
