import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Globe, Lock } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/format';
import { settingsApi } from '../../services/settings';
import { toast } from '../ui/Toast';

/** Route -> i18n page-title key. */
const PAGE_TITLE_KEYS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^\/$/, key: 'pages.dashboard.title' },
  { pattern: /^\/students\/[^/]+$/, key: 'pages.studentDetail.title' },
  { pattern: /^\/students$/, key: 'pages.students.title' },
  { pattern: /^\/groups$/, key: 'pages.groups.title' },
  { pattern: /^\/teachers$/, key: 'pages.teachers.title' },
  { pattern: /^\/payments$/, key: 'pages.payments.title' },
  { pattern: /^\/settings$/, key: 'pages.settings.title' },
  { pattern: /^\/login$/, key: 'pages.login.title' },
];

export function usePageTitle(): string {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const match = PAGE_TITLE_KEYS.find((entry) => entry.pattern.test(pathname));
  return match ? t(match.key) : '';
}

export function Header() {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const centerName = useAuthStore((state) => state.centerName);
  const lock = useAuthStore((state) => state.lock);
  const title = usePageTitle();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-6">
      {/* Breadcrumb-style page title (the page itself renders the <h1>). */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[13px] text-muted" title={t('header.center')}>
          {centerName}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/60 rtl:rotate-180" aria-hidden="true" />
        <span className="truncate text-[15px] font-semibold text-foreground">{title}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Language toggle FR / AR */}
        <div className="flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label={t('header.language')}>
          <span className="flex items-center px-2 text-muted">
            <Globe className="h-4 w-4" aria-hidden="true" />
          </span>
          {(['fr', 'ar'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                if (lang === language) return;
                setLanguage(lang);
                // Keep the persisted preference in sync with the quick toggle.
                void settingsApi.set('language', lang).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : t('common.error'));
                });
              }}
              aria-pressed={language === lang}
              aria-label={lang === 'fr' ? 'Français' : 'العربية'}
              title={t('header.toggleLanguage')}
              className={cn(
                'h-8 px-2.5 text-[13px] font-medium uppercase transition-colors',
                language === lang ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-background hover:text-foreground',
              )}
            >
              {lang}
            </button>
          ))}
        </div>

        {/* Manual session lock (idle auto-lock is handled by AppLayout) */}
        <button
          type="button"
          onClick={lock}
          title={t('header.lock')}
          aria-label={t('header.lock')}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
        >
          <Lock className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export default Header;
