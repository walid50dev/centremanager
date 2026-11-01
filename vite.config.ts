import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed port and does not want the screen cleared on error.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || '0.0.0.0',
    // Allow proxied preview hosts (Arena sandbox) in addition to localhost.
    allowedHosts: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: 'chrome105',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // One desktop bundle, loaded from disk: the default 500 kB hint no longer
    // makes sense once the payroll screens are in (Phase 6 ~ 508 kB).
    // The PDF engine (@react-pdf/renderer) is a deliberate lazy chunk of
    // ~1.2 MB: it is only fetched when a receipt is opened (Phase 8).
    chunkSizeWarningLimit: 1400,
  },
}));
