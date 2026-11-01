import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { cn } from '../../utils/format';

/** FR / AR switch used on the pre-authentication screens. */
export function LanguageToggle() {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);

  return (
    <div
      className="flex items-center overflow-hidden rounded-md border border-border bg-white"
      role="group"
      aria-label={t('header.language')}
    >
      <span className="flex items-center px-2 text-muted">
        <Globe className="h-4 w-4" aria-hidden="true" />
      </span>
      {(['fr', 'ar'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          aria-pressed={language === lang}
          aria-label={lang === 'fr' ? 'Français' : 'العربية'}
          title={t('header.toggleLanguage')}
          className={cn(
            'h-8 px-2.5 text-[13px] font-medium uppercase transition-colors',
            language === lang
              ? 'bg-primary text-white'
              : 'bg-white text-muted hover:bg-background hover:text-foreground',
          )}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}

export default LanguageToggle;
