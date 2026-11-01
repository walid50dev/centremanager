import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { settingsApi } from '../../services/settings';
import { useAppStore } from '../../stores/appStore';
import { cn } from '../../utils/format';
import type { Language } from '../../types';

const OPTIONS: Array<{
  value: Language;
  flag: string;
  labelKey: string;
  preview: string;
  previewFont: string;
}> = [
  {
    value: 'fr',
    flag: '🇫🇷',
    labelKey: 'settings.language.french',
    preview: 'Gestion de centre de soutien',
    previewFont: "'Inter', sans-serif",
  },
  {
    value: 'ar',
    flag: '🇲🇦',
    labelKey: 'settings.language.arabic',
    preview: 'مرحبا',
    previewFont: "'Noto Sans Arabic', 'Inter', sans-serif",
  },
];

/** Section 5 — interface language (applied immediately and persisted). */
export function LanguageSection() {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);

  const handleSelect = async (next: Language) => {
    if (next === language) return;

    setLanguage(next);
    try {
      await settingsApi.set('language', next);
      toast.success(t('settings.language.updated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  return (
    <SettingsSection
      icon={<Languages className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.language')}
      description={t('settings.language.description')}
    >
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('settings.section.language')}>
        {OPTIONS.map((option) => {
          const selected = language === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void handleSelect(option.value)}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-4 text-start transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-white hover:bg-background',
              )}
            >
              <span className="text-2xl" aria-hidden="true">
                {option.flag}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-btn font-medium text-foreground">
                  {t(option.labelKey)}
                </span>
                <span
                  className="block truncate text-[13px] text-muted"
                  style={{ fontFamily: option.previewFont, direction: option.value === 'ar' ? 'rtl' : 'ltr' }}
                >
                  {option.preview}
                </span>
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
      <p className="mt-3 text-[12px] text-muted">{t('settings.language.note')}</p>
    </SettingsSection>
  );
}

export default LanguageSection;
