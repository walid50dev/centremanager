import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './index.css';
import { useAppStore } from './stores/appStore';

// Apply the persisted language (direction + <html lang>) before the first paint.
useAppStore.getState().applyLanguage(useAppStore.getState().language);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
