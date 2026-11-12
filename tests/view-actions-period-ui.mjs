import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url:'http://localhost/' });
Object.assign(globalThis, { window:dom.window, document:dom.window.document, localStorage:dom.window.localStorage, Element:dom.window.Element, HTMLElement:dom.window.HTMLElement, Event:dom.window.Event, CustomEvent:dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT:true });
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useLocation } = await import('react-router-dom');
const server = await createServer({ optimizeDeps:{ noDiscovery:true }, server:{ middlewareMode:true, hmr:false }, appType:'custom' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const query = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
const click = async element => act(async () => { element.click(); await wait(150); });
const changeMonth = async (selector, value) => act(async () => {
  const input = query(selector);
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
  await wait(150);
});
let path = '';
function Tracker() { path = useLocation().pathname; return null; }
try {
  const i18n = (await server.ssrLoadModule('/src/i18n/index.ts')).default;
  await i18n.changeLanguage('fr');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const { useAppStore } = await server.ssrLoadModule('/src/stores/appStore.ts');
  await useAppStore.getState().loadSchoolYears();
  const activeYear = await devInvoke('cmd_get_active_school_year');
  const student = (await devInvoke('cmd_get_students', {})).data.find(row => row.status === 'actif');
  const teacher = (await devInvoke('cmd_get_teachers'))[0];
  const groups = await devInvoke('cmd_get_groups');
  let group;
  for (const candidate of groups) {
    const found = await devInvoke('cmd_get_group_detail', { id:candidate.id });
    if (found.students.length) { group = candidate; break; }
  }
  assert.ok(student && teacher && group);
  // Explicitly outside the school's dates, but linked to the active year.
  const expenseId = await devInvoke('cmd_create_expense', { data:{ label:'Dépense hors période', category:'loyer', amount_cents:12345, month:1, year:2001, notes:'Première ligne\nNotes complètes ici' } });
  const root = createRoot(query('#root'));
  let key = 0;
  async function render(component) {
    await act(async () => { root.render(React.createElement(MemoryRouter, { key:++key, initialEntries:['/'], future:{ v7_startTransition:true, v7_relativeSplatPath:true } }, React.createElement(Tracker), React.createElement(component))); });
    await act(async () => { await wait(400); });
  }
  const StudentPage = (await server.ssrLoadModule('/src/pages/StudentsPage.tsx')).default;
  const GroupsPage = (await server.ssrLoadModule('/src/pages/GroupsPage.tsx')).default;
  const TeachersPage = (await server.ssrLoadModule('/src/pages/TeachersPage.tsx')).default;
  const ExpensesPage = (await server.ssrLoadModule('/src/pages/ExpensesPage.tsx')).default;
  const PaymentsPage = (await server.ssrLoadModule('/src/pages/PaymentsPage.tsx')).default;
  const DashboardPage = (await server.ssrLoadModule('/src/pages/DashboardPage.tsx')).default;
  const TimetablePage = (await server.ssrLoadModule('/src/pages/TimetablePage.tsx')).default;
  const Backup = (await server.ssrLoadModule('/src/components/settings/BackupSection.tsx')).default;
  const noYearDropdown = () => assert.equal(document.querySelectorAll('select[aria-label*="année" i], select[aria-label*="year" i], [data-testid$="-year"]').length, 0);
  await render(StudentPage); noYearDropdown();
  let button = query(`[data-testid="view-student-${student.id}"]`);
  assert.equal(button.title, 'Voir la fiche'); assert.match(button.getAttribute('aria-label'), /Voir la fiche/);
  await click(button); assert.equal(path, '/');
  await act(async () => { await wait(250); });
  assert.match(query('[data-testid="student-sheet"]').textContent, new RegExp(student.full_name));
  await render(TeachersPage); noYearDropdown();
  button = query(`[data-testid="view-teacher-${teacher.id}"]`);
  await act(async () => { button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:'Enter', bubbles:true })); });
  assert.equal(path, '/', 'keyboard event must not activate surrounding card');
  await click(button); assert.equal(path, `/teachers/${teacher.id}`);
  await render(GroupsPage); noYearDropdown();
  button = query(`[data-testid="view-group-${group.id}"]`);
  await click(button);
  await act(async () => { await wait(250); });
  assert.ok(document.querySelector('[role="dialog"]'));
  await render(ExpensesPage); noYearDropdown();
  await changeMonth('[data-testid="expenses-period"]', '2001-01');
  assert.equal(query('[data-testid="expenses-period"]').value, '2001-01');
  await click(query(`[data-testid="view-expense-${expenseId}"]`));
  let dialog = query('[data-testid="expense-detail"]');
  assert.match(dialog.textContent, /Dépense hors période/); assert.match(dialog.textContent, /Notes complètes ici/); assert.match(dialog.textContent, /2001/);
  assert.equal(dialog.querySelectorAll('input, textarea').length, 0, 'details are read-only');
  await click([...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fermer'));
  assert.ok(query(`[data-testid="expense-edit-${expenseId}"]`)); assert.ok(query(`[data-testid="expense-delete-${expenseId}"]`));
  await render(TimetablePage); noYearDropdown();
  for (const [page, id] of [[PaymentsPage,'payments-period'],[DashboardPage,'dashboard-period']]) {
    await render(page); noYearDropdown();
    await changeMonth(`[data-testid="${id}"]`, '2001-01');
    assert.equal(query(`[data-testid="${id}"]`).value, '2001-01');
    if (id === 'payments-period') {
      await click(document.querySelectorAll('[role="tab"]')[1]);
      await act(async () => { await wait(500); });
      assert.equal(document.querySelector('[data-testid="payments-period"]'), null, 'teacher payments are scoped to the active school year, not the student billing month');
      assert.match(document.body.textContent, /année scolaire active/i);
    }
  }
  assert.equal((await devInvoke('cmd_get_active_school_year')).id, activeYear.id, 'calendar periods must not switch school years');
  await render(Backup); await click(query('section button[aria-expanded]'));
  assert.equal(document.querySelector('[data-testid="seed-demo-data"]'), null);
  assert.doesNotMatch(document.body.textContent, /Charger données de démonstration/i);
  await assert.rejects(devInvoke('cmd_seed_demo_data'), /Commande inconnue/);
  await act(async () => { await i18n.changeLanguage('ar'); }); await render(StudentPage);
  assert.equal(query(`[data-testid="view-student-${student.id}"]`).title, 'عرض البطاقة');
  await act(async () => root.unmount());
  console.log('View actions, read-only expense detail, calendar periods, translations and demo removal passed');
} finally { await server.close(); dom.window.close(); }
