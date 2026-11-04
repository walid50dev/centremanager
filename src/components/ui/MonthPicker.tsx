import type { ChangeEvent } from 'react';

export interface CalendarPeriod {
  month: number;
  year: number;
}

/** Calendar billing period, not a school-year selector. */
export default function MonthPicker({ value, onChange, label, testId }: {
  value: CalendarPeriod;
  onChange: (value: CalendarPeriod) => void;
  label: string;
  testId: string;
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
    <input
      type="month"
      min="2000-01"
      max="2100-12"
      value={formatted}
      onChange={handleChange}
      aria-label={label}
      data-testid={testId}
      className="h-9 rounded-md border border-border bg-white px-3 text-body text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    />
  );
}
