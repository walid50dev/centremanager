import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { settingsApi } from '../../services/settings';
import { cn } from '../../utils/format';

type ReceiptFormat = 'a4' | 'thermal';

export interface PrintingSectionProps {
  settings: Record<string, string>;
  updateLocal: (patch: Record<string, string>) => void;
}

/** Section 6 — receipt paper format (A4 or 80 mm thermal). */
export function PrintingSection({ settings, updateLocal }: PrintingSectionProps) {
  const { t } = useTranslation();
  const current: ReceiptFormat = settings.receipt_format === 'thermal' ? 'thermal' : 'a4';

  const handleSelect = async (format: ReceiptFormat) => {
    if (format === current) return;
    try {
      await settingsApi.set('receipt_format', format);
      updateLocal({ receipt_format: format });
      toast.success(t('settings.printing.updated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  return (
    <SettingsSection
      icon={<Printer className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.printing')}
      description={t('settings.printing.description')}
    >
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('settings.section.printing')}>
        {([
          { value: 'a4' as const, labelKey: 'settings.printing.a4', hintKey: 'settings.printing.a4Hint' },
          { value: 'thermal' as const, labelKey: 'settings.printing.thermal', hintKey: 'settings.printing.thermalHint' },
        ]).map((option) => {
          const selected = current === option.value;
          const isA4 = option.value === 'a4';
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void handleSelect(option.value)}
              className={cn(
                'flex items-center gap-4 rounded-lg border p-4 text-start transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-white hover:bg-background',
              )}
            >
              {/* Paper preview */}
              <span
                className={cn(
                  'flex shrink-0 flex-col justify-between rounded-sm border border-border bg-white p-1 shadow-sm',
                  isA4 ? 'h-16 w-[46px]' : 'h-16 w-[30px]',
                )}
                aria-hidden="true"
              >
                <span className="block space-y-0.5">
                  <span className="block h-[2px] w-full rounded bg-slate-300" />
                  <span className="block h-[2px] w-3/4 rounded bg-slate-200" />
                  <span className="block h-[2px] w-2/3 rounded bg-slate-200" />
                </span>
                <span className="block h-[2px] w-1/2 self-end rounded bg-primary/40" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-btn font-medium text-foreground">{t(option.labelKey)}</span>
                <span className="block text-[13px] text-muted">{t(option.hintKey)}</span>
              </span>
              <span
                className={cn(
                  'h-4 w-4 shrink-0 rounded-full border',
                  selected ? 'border-primary bg-primary' : 'border-border bg-white',
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

export default PrintingSection;
