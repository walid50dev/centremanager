// Run with: node tests/screenshot-fixture.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
globalThis.window = { setTimeout };
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { seedScreenshots } = await server.ssrLoadModule('/scripts/screenshot-fixture.mjs');
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  await seedScreenshots();
  const key = 'centremanager.dev.settings_store_v1';
  const before = storage.get(key), store = JSON.parse(before);
  assert.equal(store.students.length, 5); assert.equal(store.groups.length, 4); assert.equal(store.teachers.length, 3);
  assert.equal(store.schoolYears.find(y => y.is_active).label, '2025-2026');
  assert.equal(store.schoolYears.length, 2);
  assert.equal(await devInvoke('cmd_get_enrollment_fee'), 20000);
  for (const student of store.students) {
    assert.ok(store.enrollments.filter(e => e.student_id === student.id).length >= 1);
    const invoices = await devInvoke('cmd_get_student_invoices', { studentId: student.id });
    assert.equal(invoices.filter(i => i.kind === 'enrollment_fee').length, 1);
  }
  assert.ok(store.invoices.some(i => i.status === 'payé'));
  assert.ok(store.invoices.some(i => i.status === 'partiel'));
  assert.ok(store.invoices.some(i => i.status === 'impayé'));
  const now = new Date();
  assert.equal(store.expenses.filter(e => !e.deleted_at && e.year === now.getFullYear() && e.month === now.getMonth() + 1).length, 3);
  assert.equal((await devInvoke('cmd_list_trash')).length, 1);
  await assert.rejects(seedScreenshots(), /données dev existent/);
  assert.equal(storage.get(key), before, 'refusal must not overwrite data');
  console.log('Fixture OK : années, effectifs, frais, factures, corbeille et protection des données.');
} finally { await server.close(); }
