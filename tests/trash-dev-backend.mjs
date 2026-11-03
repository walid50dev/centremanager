// Run: node tests/trash-dev-backend.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
globalThis.window = { setTimeout };
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const key = 'centremanager.dev.settings_store_v1';
  const list = () => devInvoke('cmd_list_trash');
  const remove = (entityType, entityId) => devInvoke('cmd_delete_to_trash', { entityType, entityId });
  const restore = (entityType, entityId) => devInvoke('cmd_restore_from_trash', { entityType, entityId });
  const students = await devInvoke('cmd_get_students', {});
  const studentId = students.data[0].id;
  await remove('student', studentId);
  assert.ok(!(await devInvoke('cmd_get_students', {})).data.some(s => s.id === studentId));
  assert.ok((await list()).some(s => s.entity_type === 'student' && s.entity_id === studentId));
  await restore('student', studentId);
  assert.ok((await devInvoke('cmd_get_students', {})).data.some(s => s.id === studentId));
  let store = JSON.parse(values.get(key));
  const student = store.students.find(s => s.id === studentId);
  store.payments.push({ id: 987, student_id: studentId, invoice_id: null, amount_cents: 100, payment_method: 'cash', notes: null, created_at: '2026-01-01' });
  values.set(key, JSON.stringify(store));
  await remove('student', studentId);
  store = JSON.parse(values.get(key)); store.students.find(s => s.id === studentId).deleted_at = '2020-01-01T00:00:00.000Z'; values.set(key, JSON.stringify(store));
  await devInvoke('cmd_purge_trash');
  const protectedStudent = (await list()).find(s => s.entity_type === 'student' && s.entity_id === studentId);
  assert.equal(protectedStudent.permanent, true);
  await assert.rejects(devInvoke('cmd_delete_permanently', { entityType: 'student', entityId: studentId }));
  await devInvoke('cmd_empty_trash');
  store = JSON.parse(values.get(key));
  assert.ok(store.payments.some(p => p.id === 987)); assert.ok(store.students.some(s => s.id === studentId));
  await restore('student', studentId);
  store = JSON.parse(values.get(key)); const expenseId = store.expenses[0].id;
  await remove('expense', expenseId);
  store = JSON.parse(values.get(key)); store.expenses.find(e => e.id === expenseId).deleted_at = '2020-01-01T00:00:00.000Z'; values.set(key, JSON.stringify(store));
  assert.equal(await devInvoke('cmd_purge_trash'), 1);
  assert.ok(!JSON.parse(values.get(key)).expenses.some(e => e.id === expenseId));
  for (const type of ['teacher', 'group']) {
    store = JSON.parse(values.get(key)); const row = store[type === 'teacher' ? 'teachers' : 'groups'][0];
    await remove(type, row.id); assert.ok((await list()).some(i => i.entity_type === type && i.entity_id === row.id));
    await restore(type, row.id);
  }
  console.log('Trash: soft delete, restore, expiry, financial protection, empty and all entity types passed');
} finally { await server.close(); }
