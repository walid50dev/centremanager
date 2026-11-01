import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BackupSection from '../components/settings/BackupSection';
import CenterSection from '../components/settings/CenterSection';
import LanguageSection from '../components/settings/LanguageSection';
import LevelsSection from '../components/settings/LevelsSection';
import PrintingSection from '../components/settings/PrintingSection';
import SchoolYearSection from '../components/settings/SchoolYearSection';
import SecuritySection from '../components/settings/SecuritySection';
import SubjectsSection from '../components/settings/SubjectsSection';
import { toast } from '../components/ui/Toast';
import { settingsApi } from '../services/settings';

/**
 * Settings page — eight collapsible sections:
 * centre · school year · levels · subjects · language · printing · security ·
 * backup.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSettings(await settingsApi.getAll());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateLocal = useCallback((patch: Record<string, string>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1>{t('pages.settings.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('settings.intro')}</p>
      </div>

      {loading && <p className="text-[13px] text-muted">{t('common.loading')}</p>}

      <CenterSection settings={settings} updateLocal={updateLocal} />
      <SchoolYearSection />
      <LevelsSection />
      <SubjectsSection />
      <LanguageSection />
      <PrintingSection settings={settings} updateLocal={updateLocal} />
      <SecuritySection />
      <BackupSection />

      <p className="pb-2 text-center text-[12px] text-muted">{t('settings.footer')}</p>
    </div>
  );
}

export default SettingsPage;
