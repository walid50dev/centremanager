// Run with: node tests/timetable-ui.mjs
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await server.ssrLoadModule('/src/i18n/index.ts');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const { default: TimetablePage } = await server.ssrLoadModule('/src/pages/TimetablePage.tsx');
  await devInvoke('cmd_get_groups', {});
  const key = 'centremanager.dev.settings_store_v1';
  const store = JSON.parse(localStorage.getItem(key));
  const template = store.groups[0];
  const group = (id, day, start, end, subject = 1) => ({ ...template, id, subject_id: subject, day_of_week: day, start_time: start, end_time: end, room: 'A1', schedules: [{ id, day_of_week: day, start_time: start, end_time: end }] });
  store.groups = [group(101, 'Lundi', '08:00', '10:00'), group(102, 'Lundi', '09:00', '11:00', 2), group(103, 'Lundi', '10:00', '12:00'), group(104, 'Lundi', '14:00', '16:00'), ...Array.from({ length: 5 }, (_, i) => group(200 + i, 'Mardi', '08:00', '10:00'))];
  localStorage.setItem(key, JSON.stringify(store));
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(TimetablePage)); });
  await act(async () => { await wait(300); });
  const block = (id, day = 'monday') => document.querySelector(`[data-testid="timetable-block-${id}-${day}"]`);
  const a = block(101), b = block(102), c = block(103), d = block(104);
  assert.ok(a && b && c && d, 'all entries rendered');
  assert.deepEqual([a, b, c, d].map(e => e.parentElement.dataset.laneCount), ['2', '2', '2', '1']);
  assert.deepEqual([a, b, c, d].map(e => e.parentElement.style.left), ['0%', '50%', '0%', '0%']);
  assert.deepEqual([a, b, c, d].map(e => e.parentElement.style.width), ['50%', '50%', '50%', '100%']);
  assert.deepEqual([a, b, c, d].map(e => e.parentElement.style.top), ['0px', '40px', '80px', '240px']);
  assert.equal(a.parentElement.style.height, '80px');
  assert.notEqual(a.style.borderColor, b.style.borderColor, 'subject colors remain distinct');
  assert.match(a.title, /Mathématiques/); assert.match(a.title, /A1/); assert.match(a.title, /08:00–10:00/);
  assert.match(a.title, /0\/10/); assert.match(a.title, /Enseignant/i); assert.match(a.title, /Groupe/i);
  assert.equal(a.querySelectorAll('.timetable-lane-details').length, 3);
  const tuesday = document.querySelector('[data-testid="timetable-day-column-tuesday"]');
  assert.ok(tuesday.className.includes('overflow-x-auto'));
  for (let i = 0; i < 5; i++) {
    const e = block(200 + i, 'tuesday');
    assert.ok(e); assert.equal(e.parentElement.dataset.laneCount, '5');
    assert.equal(e.parentElement.style.left, `${i * 20}%`);
    assert.equal(e.parentElement.style.width, '20%');
    assert.match(e.parentElement.parentElement.getAttribute('style'), /400px/);
    assert.match(e.parentElement.parentElement.getAttribute('style'), /125%/);
  }
  await act(async () => { a.click(); await wait(150); });
  assert.ok(document.querySelector('[role="dialog"]'), 'clicking a block opens details');
  await act(async () => { root.unmount(); });
  console.log('Timetable UI: all blocks, geometry, scroll constraints, colors, tooltip and details passed');
} finally { await server.close(); dom.window.close(); }
