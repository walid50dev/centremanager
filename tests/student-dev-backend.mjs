// Run with: node tests/student-dev-backend.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
globalThis.window = { setTimeout };
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const data = {
    full_name: 'Salma El Mansouri', first_name: 'Salma', last_name: 'El Mansouri',
    birth_date: '2011-05-03', phone: '06 61 23 45 67', guardian_phone: '06 61 23 45 67',
    guardian_name: 'Rachid El Mansouri', guardian_relation: 'father',
    secondary_contact_name: 'Amina', secondary_contact_phone: '07-12-34-56-78',
    school_name: 'Lycée Moulay Youssef', enrollment_date: '2026-11-03',
    level_id: 1, branch_id: null, address: 'Rabat', notes: 'RAS', status: 'actif',
  };
  const id = await devInvoke('cmd_create_student', { data });
  const detail = await devInvoke('cmd_get_student_detail', { id });
  assert.equal(detail.student.guardian_phone, '0661234567');
  assert.equal(detail.student.phone, '0661234567');
  assert.equal(detail.student.secondary_contact_phone, '0712345678');
  assert.equal(detail.student.guardian_relation, 'father');
  assert.equal(detail.student.enrollment_date, '2026-11-03');
  for (const key of ['father_name', 'home_address', 'email']) assert.equal(key in detail.student, false);
  for (const search of ['Rachid El Mansouri', '06 61 23 45 67', 'Salma']) {
    const list = await devInvoke('cmd_get_students', { search });
    assert.ok(list.data.some((student) => student.id === id), search);
  }
  await assert.rejects(devInvoke('cmd_create_student', { data: { ...data, guardian_phone: '0512345678' } }), /invalide/);
  await assert.rejects(devInvoke('cmd_create_student', { data: { ...data, guardian_name: '' } }), /obligatoire/);
  await devInvoke('cmd_update_student', { id, data: { ...data, status: 'inactif', school_name: 'École' } });
  const updated = await devInvoke('cmd_get_student_detail', { id });
  assert.equal(updated.student.status, 'inactif');
  assert.equal(updated.student.school_name, 'École');
  assert.ok(updated.audit_log.some((entry) => entry.action === 'UPDATE'));
  const key = 'centremanager.dev.settings_store_v1';
  const oldStore = JSON.parse(values.get(key));
  oldStore.students[0] = { ...oldStore.students[0], first_name: undefined, last_name: undefined,
    guardian_name: undefined, guardian_phone: undefined, guardian_relation: undefined,
    secondary_contact_name: undefined, secondary_contact_phone: undefined, school_name: undefined,
    enrollment_date: undefined, birth_date: undefined, address: undefined,
    father_name: 'Ancien tuteur', home_address: 'Ancien quartier', parent_phone: '0712345678', date_of_birth: '2009-01-02' };
  values.set(key, JSON.stringify(oldStore));
  const migrated = await devInvoke('cmd_get_student_detail', { id: oldStore.students[0].id });
  assert.equal(migrated.student.guardian_name, 'Ancien tuteur');
  assert.equal(migrated.student.address, 'Ancien quartier');
  assert.equal(migrated.student.birth_date, '2009-01-02');
  assert.equal(migrated.student.secondary_contact_phone, '0712345678');
  assert.equal('father_name' in migrated.student, false);
  console.log('Student development backend: create, validation, search, update, audit and legacy migration passed');
} finally {
  await server.close();
}
