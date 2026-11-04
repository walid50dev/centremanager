import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const initial = await devInvoke('cmd_get_active_school_year');
  const newId = await devInvoke('cmd_create_school_year', { label: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30' });
  await devInvoke('cmd_switch_school_year', { yearId: newId });
  assert.equal((await devInvoke('cmd_get_active_school_year')).id, newId);
  await assert.rejects(devInvoke('cmd_switch_school_year', { yearId: -1 }));
  assert.equal((await devInvoke('cmd_get_active_school_year')).id, newId);
  await devInvoke('cmd_set_active_year', { id: initial.id });
  assert.equal((await devInvoke('cmd_get_active_school_year')).id, initial.id);
  console.log('Development backend: active-year commands validated');
} finally { await server.close(); dom.window.close(); }
