// Run: node tests/entity-modal-integration.mjs
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, Element: dom.window.Element, MutationObserver: dom.window.MutationObserver, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollIntoView = function() {};
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = selector => { const el = document.querySelector(selector); assert.ok(el, `missing ${selector}`); return el; };
const click = async el => { await act(async () => { el.click(); await wait(30); }); };
const change = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await wait(30); }); };
try {
  await server.ssrLoadModule('/src/i18n/index.ts');
  const { default: GroupModal } = await server.ssrLoadModule('/src/components/groups/GroupModal.tsx');
  const { default: PaymentModal } = await server.ssrLoadModule('/src/components/payments/PaymentModal.tsx');
  const { default: StudentModal } = await server.ssrLoadModule('/src/components/students/StudentModal.tsx');
  const { default: EnrollmentModal } = await server.ssrLoadModule('/src/components/enrollments/EnrollmentModal.tsx');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const root = createRoot(q('#root'));
  let parentSaved = 0;
  await act(async () => { root.render(React.createElement(GroupModal, { open: true, onClose() {}, onSaved() { parentSaved++; } })); await wait(250); });
  await click(q('[data-testid="group-teacher-trigger"]'));
  assert.equal(q('[data-testid="group-teacher-list"]').style.zIndex, '51');
  await change(q('[data-testid="group-teacher-search"]'), 'Nom qui ne doit pas préremplir');
  assert.match(q('[data-testid="group-teacher-create"]').textContent, /Nom qui ne doit pas préremplir/);
  await click(q('[data-testid="group-teacher-create"]'));
  const teacherDialog = q('[data-modal-z="60"]');
  const name = teacherDialog.querySelector('input[placeholder="Prénom et nom"]');
  assert.ok(name); assert.equal(name.value, '', 'typed query is not copied into full teacher form');
  assert.ok(teacherDialog.querySelector('input[type="email"]')); assert.ok(teacherDialog.querySelector('textarea'));
  await change(name, 'Nouveau Professeur');
  await click(q('[data-testid="teacher-subject-create"]'));
  assert.ok(q('[data-modal-z="70"]'));
  assert.equal(q('[data-testid="quick-subject-name"]').value, '');
  await change(q('[data-testid="quick-subject-name"]'), 'Matière Imbriquée');
  await act(async () => { q('#quick-subject-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(250); });
  assert.ok([...teacherDialog.querySelectorAll('label')].some(label => label.textContent.includes('Matière Imbriquée') && label.querySelector('input:checked')));
  assert.equal(name.value, 'Nouveau Professeur');
  assert.equal(parentSaved, 0);
  const teacherSave = [...teacherDialog.querySelectorAll('button')].find(button => button.textContent.trim() === 'Enregistrer');
  assert.ok(teacherSave); await click(teacherSave);
  await act(async () => { await wait(350); });
  assert.match(q('[data-testid="group-teacher-trigger"]').textContent, /Nouveau Professeur/);
  assert.equal(parentSaved, 0, 'creating a teacher never submits the group');
  assert.equal(document.querySelector('[data-modal-z="60"]'), null);
  // Changing a name keeps only matching options and a create action; exact
  // matches must not offer another creation action.
  await click(q('[data-testid="group-teacher-trigger"]'));
  await change(q('[data-testid="group-teacher-search"]'), 'Nouveau Professeur');
  assert.equal(document.querySelector('[data-testid="group-teacher-create"]'), null);
  await click(q('[data-testid="group-teacher-trigger"]'));

  // Creating a level from a student leaves the student form untouched.
  await act(async () => { root.render(React.createElement(StudentModal, { open: true, onClose() {}, onSaved() { parentSaved++; } })); await wait(220); });
  await change(q('[data-testid="student-first-name"]'), 'Élève en cours');
  await click(q('[data-testid="student-level-trigger"]'));
  await change(q('[data-testid="student-level-search"]'), 'Texte non repris');
  await click(q('[data-testid="student-level-create"]'));
  assert.equal(q('[data-testid="quick-level-name"]').value, '');
  assert.ok(q('[data-modal-z="60"]'));
  await change(q('[data-testid="quick-level-name"]'), 'Niveau Imbriqué');
  await act(async () => { const category = q('[data-testid="quick-level-category"]'); category.value = 'lycee'; category.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await act(async () => { q('#quick-level-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(250); });
  assert.match(q('[data-testid="student-level-trigger"]').textContent, /Niveau Imbriqué/);
  assert.equal(q('[data-testid="student-first-name"]').value, 'Élève en cours');
  await click(q('[data-testid="student-branch-trigger"]'));
  await click(q('[data-testid="student-branch-create"]'));
  assert.equal(q('[data-testid="branch-name"]').value, '');
  assert.equal(q('[data-testid="branch-level"]').value, '', 'branch level is not prefilled');
  await change(q('[data-testid="branch-name"]'), 'Branche Imbriquée');
  const select = q('[data-testid="branch-level"]');
  const level = [...select.options].find(option => option.textContent.includes('Niveau Imbriqué'));
  assert.ok(level);
  await act(async () => { select.value = level.value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await act(async () => { q('#branch-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(250); });
  assert.match(q('[data-testid="student-branch-trigger"]').textContent, /Branche Imbriquée/);
  assert.equal(q('[data-testid="student-first-name"]').value, 'Élève en cours');
  assert.equal(parentSaved, 0, 'creating a level does not submit the student');
  await act(async () => { await wait(400); });


  // it can open the full teacher modal one level higher.
  const students = await devInvoke('cmd_get_students', {});
  const studentId = students.data[0].id;
  await act(async () => { root.render(React.createElement(EnrollmentModal, { open: true, mode: 'from_student', studentId, onClose() {}, onSaved() { parentSaved++; } })); });
  await act(async () => { await wait(280); });
  await click(q('[data-testid="enrollment-create-group"]'));
  await act(async () => { await wait(250); });
  assert.ok(q('[data-modal-z="60"] [data-testid="group-week"]'), 'real full group modal');
  await click(q('[data-testid="group-teacher-trigger"]'));
  assert.equal(q('[data-testid="group-teacher-list"]').style.zIndex, '61');
  await click(q('[data-testid="group-teacher-create"]'));
  const nested = q('[data-modal-z="70"]');
  assert.ok(nested.querySelector('input[type="email"]')); assert.equal(nested.querySelector('input[placeholder="Prénom et nom"]').value, '');
  assert.equal(nested.querySelector('[data-testid="teacher-subject-create"]').disabled, true, 'fourth level prohibited');
  await change(nested.querySelector('input[placeholder="Prénom et nom"]'), 'Professeur Imbriqué');
  await click([...nested.querySelectorAll('button')].find(button => button.textContent.trim() === 'Enregistrer'));
  await act(async () => { await wait(300); });
  assert.match(q('[data-testid="group-teacher-trigger"]').textContent, /Professeur Imbriqué/);
  assert.equal(parentSaved, 0);
  // Select real subject and level, then enter the full group's fee and save.
  for (const type of ['subject', 'level']) {
    await click(q(`[data-testid="group-${type}-trigger"]`));
    const list = q(`[data-testid="group-${type}-list"]`);
    const option = list.querySelector('button[data-testid*="-option-"]'); assert.ok(option);
    await click(option);
  }
  await change(q('[data-testid="group-fee"]'), '300');
  const groupForm = q('#group-form');
  await act(async () => { groupForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(450); });
  assert.equal(document.querySelector('[data-modal-z="60"]'), null, 'group saved and closed');
  assert.equal(parentSaved, 0, 'creating group does not submit the enrollment');
  assert.ok(q('[data-modal-z="50"]').querySelector('input[type="checkbox"]:checked'), 'new group is selected');
  await act(async () => { root.unmount(); });
  console.log('Entity modals: full teacher/group forms, blank query, selection, nesting and non-submission passed');
} finally { await server.close(); dom.window.close(); }
