// Run with: node tests/duplicates-ui.mjs
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
  const { default: DuplicateWarnings } = await server.ssrLoadModule('/src/components/duplicates/DuplicateWarnings.tsx');
  const input = { full_name: 'Salma Oukacha', first_name: 'Salma', last_name: 'Oukacha', phone: '0699112233', guardian_phone: '0699112233', guardian_name: 'Rachid', guardian_relation: null, secondary_contact_name: null, secondary_contact_phone: null, school_name: null, birth_date: null, enrollment_date: '2026-11-03', level_id: 1, branch_id: null, address: null, notes: null, status: 'actif' };
  const id = await devInvoke('cmd_create_student', { data: input });
  let saves = 0;
  const root = createRoot(document.getElementById('root'));
  const render = (props) => React.createElement('form', { onSubmit: event => { event.preventDefault(); saves++; } },
    React.createElement(DuplicateWarnings, props), React.createElement('button', { type: 'submit' }, 'save'));
  const props = { open: true, type: 'student', first: 'Salma', last: 'Oukacha', phone: '0699112233' };
  await act(async () => { root.render(render(props)); });
  assert.equal(document.querySelector('[data-testid^="duplicate-student"]'), null, 'debounced');
  await act(async () => { await wait(650); });
  assert.ok(document.querySelector(`[data-testid="duplicate-student-${id}"]`));
  const warning = document.querySelector(`[data-testid="duplicate-student-${id}"]`);
  await act(async () => { warning.querySelectorAll('button')[1].click(); await wait(130); });
  assert.ok(document.querySelector(`[data-testid="duplicate-preview-${id}"]`));
  await act(async () => { document.querySelector('button[type="submit"]').click(); });
  assert.equal(saves, 1, 'warning does not block saving');
  await act(async () => { warning.querySelectorAll('button')[0].click(); });
  assert.equal(document.querySelector(`[data-testid="duplicate-student-${id}"]`), null, 'ignore dismisses warning');
  await act(async () => { root.render(render({ ...props, id })); await wait(650); });
  assert.equal(document.querySelector(`[data-testid="duplicate-student-${id}"]`), null, 'self excluded');
  await act(async () => { root.render(render({ ...props, phone: '', first: 'Someone', last: 'Else' })); });
  await act(async () => { await wait(650); });
  assert.equal(document.querySelector(`[data-testid="duplicate-student-${id}"]`), null, 'unmatched input clears warnings');
  await act(async () => { root.render(render(props)); });
  await act(async () => { await wait(650); });
  assert.ok(document.querySelector(`[data-testid="duplicate-student-${id}"]`), 'new input resets dismissed state');
  // An in-flight old request must not reappear after the user edits the form.
  await act(async () => { root.render(render({ ...props, open: false })); });
  await act(async () => { root.render(render(props)); });
  await act(async () => { await wait(520); });
  await act(async () => { root.render(render({ ...props, first: 'Different', last: 'Person', phone: '' })); });
  await act(async () => { await wait(180); });
  assert.equal(document.querySelector(`[data-testid="duplicate-student-${id}"]`), null, 'old responses are discarded');
  const teacherId = await devInvoke('cmd_create_teacher', { data: { full_name: 'Amine Alaoui', phone: '0677665544', email: null, notes: null, subject_ids: [] } });
  await act(async () => { root.render(render({ open: true, type: 'teacher', first: 'Amine', last: 'Alaoui', phone: '0677665544' })); });
  await act(async () => { await wait(650); });
  assert.ok(document.querySelector(`[data-testid="duplicate-teacher-${teacherId}"]`), 'teacher warning is displayed');
  await act(async () => { root.render(render({ ...props, open: false })); });
  assert.equal(document.querySelector(`[data-testid="duplicate-student-${id}"]`), null, 'closing hides warning');
  await act(async () => { root.unmount(); });
  console.log('Duplicate UI: debounce, preview, ignore, self-exclusion, reset, stale requests, teacher and non-blocking submit passed');
} finally { await server.close(); dom.window.close(); }
