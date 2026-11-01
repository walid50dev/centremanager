import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr.json';
import ar from './ar.json';

export const LANGUAGES = ['fr', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'centremanager.language';

function getInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'fr' || stored === 'ar') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'fr';
}

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'ar'],
  interpolation: {
    // React already escapes values
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
