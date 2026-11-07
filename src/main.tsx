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
  // Opt-in preview only: never touch an existing browser profile or Tauri DB.
  if (import.meta.env.DEV && import.meta.env.VITE_LOAD_TEST_FIXTURE === '1' && !isTauri()) {
    const { seedLoadTest } = await import('../scripts/load-test-fixture.mjs');
    const seeded = await seedLoadTest();
    if (seeded) {
      const { authApi } = await import('./services/auth');
      await authApi.setup('Centre Test Marrakech', 'test1234');
    }
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start();
