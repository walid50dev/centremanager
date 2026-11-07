import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './index.css';
import { useAppStore } from './stores/appStore';
import { isTauri } from './services/api';

// Apply the persisted language (direction + <html lang>) before the first paint.
useAppStore.getState().applyLanguage(useAppStore.getState().language);

async function start() {
  // A one-time replacement in browser development profiles. Existing auth is
  // retained; previous browser data is saved before the test fixture is applied.
  // Production builds and Tauri use their own database paths and skip this.
  if (import.meta.env.DEV && import.meta.env.VITE_LOAD_TEST_FIXTURE !== '0' && !isTauri()) {
    const { applyBundledLoadTest } = await import('../scripts/load-test-fixture.mjs');
    await applyBundledLoadTest();
    const { authApi } = await import('./services/auth');
    if (!(await authApi.checkSetup())) await authApi.setup('Centre Test Marrakech', 'test1234');
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start().catch((error: unknown) => {
  const root = document.getElementById('root');
  if (root) root.textContent = `Impossible de charger les données de test : ${error instanceof Error ? error.message : String(error)}. Relancez avec VITE_LOAD_TEST_FIXTURE=0 pour conserver le profil existant.`;
});
