// Run with: node tests/schedule-conflicts-ui.mjs
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
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.ts');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const { default: GroupModal } = await server.ssrLoadModule('/src/components/groups/GroupModal.tsx');
  const { default: ScheduleConflictWarnings } = await server.ssrLoadModule('/src/components/groups/ScheduleConflictWarnings.tsx');
  const group = (await devInvoke('cmd_get_groups', {}))[0];
  await devInvoke('cmd_create_group', { data: { subject_id: group.subject_id, level_id: group.level_id, branch_id: group.branch_id, teacher_id: group.teacher_id, school_year_id: group.school_year_id, day_of_week: group.day_of_week, start_time: group.start_time, end_time: group.end_time, room: group.room, monthly_fee_cents: group.monthly_fee_cents, capacity: group.capacity, schedules: group.schedules } });
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(GroupModal, { open: true, group, onClose: () => {}, onSaved: () => {} })); });
  assert.equal(document.querySelector('[data-testid="schedule-conflicts"]'), null, 'scheduling controls moved out of group modal');
  const warnings = (overrides = {}) => React.createElement(ScheduleConflictWarnings, { open: true, groupId: group.id, teacherId: group.teacher_id, room: group.room, schoolYearId: group.school_year_id, schedules: [{ day: group.day_of_week, start_time: group.start_time, end_time: group.end_time }], ...overrides });
  await act(async () => { root.render(warnings()); });
  await act(async () => { await wait(650); });
  assert.equal(document.querySelectorAll('[data-testid="schedule-conflicts"] li').length, 2);
  await act(async () => { await i18n.changeLanguage('ar'); });
  assert.match(document.querySelector('[data-testid="schedule-conflicts"]').textContent, /القاعة/);
  assert.match(document.querySelector('[data-testid="schedule-conflicts"]').textContent, /الأستاذ/);
  await act(async () => { root.render(warnings({ schoolYearId: 999 })); });
  await act(async () => { await wait(650); });
  assert.equal(document.querySelector('[data-testid="schedule-conflicts"]'), null, 'switching years clears conflicts');
  await act(async () => { root.render(warnings()); });
  await act(async () => { await wait(520); });
  await act(async () => { root.render(warnings({ room: '', teacherId: null })); });
  await act(async () => { await wait(180); });
  assert.equal(document.querySelector('[data-testid="schedule-conflicts"]'), null, 'stale responses discarded');
  await act(async () => { root.unmount(); });
  console.log('Schedule conflict UI: modal debounce, multiple warnings, save, ignore, Arabic, year and stale responses passed');
} finally { await server.close(); dom.window.close(); }
