// Run with: node tests/duplicates-dev-backend.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
globalThis.window = { setTimeout };
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const check = (entityType, data) => devInvoke('cmd_check_duplicates', { entityType, data });
  const data = { id: null, first_name: 'Salma', last_name: 'Oukacha', phone: '0699112233' };
  assert.deepEqual(await check('student', data), []);
  const payload = { full_name: 'Salma Oukacha', first_name: 'Salma', last_name: 'Oukacha', phone: data.phone,
    guardian_phone: data.phone, guardian_name: 'Rachid Oukacha', guardian_relation: null, secondary_contact_name: null,
    secondary_contact_phone: null, school_name: null, birth_date: null, enrollment_date: '2026-11-03',
    level_id: 1, branch_id: null, address: null, notes: null, status: 'actif' };
  const id = await devInvoke('cmd_create_student', { data: payload });
  assert.deepEqual(await check('student', { ...data, id }), [], 'self is excluded');
  let found = await check('student', { ...data, first_name: '  SALMA  ', last_name: ' OUkaCHA ', phone: null });
  assert.deepEqual(found.map(x => [x.entity_id, x.match_type]), [[id, 'name']]);
  found = await check('student', { ...data, first_name: '', last_name: '', phone: '0 0699-112233' });
  assert.deepEqual(found.map(x => [x.entity_id, x.match_type]), [[id, 'phone']]);
  found = await check('student', { ...data, phone: '06 99 11 22 33' });
  assert.deepEqual(found.map(x => [x.entity_id, x.match_type]), [[id, 'both']]);
  assert.deepEqual(await check('student', { ...data, first_name: '', last_name: '', phone: '99112233' }), []);
  // The warning is advisory: the backend still accepts a second record.
  const secondId = await devInvoke('cmd_create_student', { data: payload });
  assert.notEqual(id, secondId);
  await devInvoke('cmd_delete_to_trash', { entityType: 'student', entityId: secondId });
  assert.deepEqual((await check('student', data)).map(x => x.entity_id), [id]);
  await devInvoke('cmd_delete_to_trash', { entityType: 'student', entityId: id });
  assert.deepEqual(await check('student', data), []);

  const teacherId = await devInvoke('cmd_create_teacher', { data: { full_name: 'ÉLODIE   Lahlou', phone: '06 87 65 43 21', email: null, notes: null, subject_ids: [] } });
  const teacherData = { id: null, first_name: 'élodie', last_name: 'lahlou', phone: '06-87-65-43-21' };
  found = await check('teacher', teacherData);
  assert.deepEqual(found.map(x => [x.entity_id, x.match_type]), [[teacherId, 'both']]);
  assert.deepEqual(await check('teacher', { ...teacherData, id: teacherId }), []);
  assert.equal((await check('teacher', { ...teacherData, first_name: '', last_name: '', phone: '0687654321' }))[0].match_type, 'phone');
  await devInvoke('cmd_delete_to_trash', { entityType: 'teacher', entityId: teacherId });
  assert.deepEqual(await check('teacher', teacherData), []);
  await assert.rejects(check('payments', data), /invalide/);
  console.log('Duplicate checks: names, numbers, both, self, trash, teacher and non-blocking creation passed');
} finally { await server.close(); }
