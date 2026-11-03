// Run with: node tests/schedule-conflicts-dev-backend.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
globalThis.window = { setTimeout };
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { devInvoke } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const teacherId = await devInvoke('cmd_create_teacher', { data: { full_name: 'Prof Amrani', phone: '0677665544', email: null, notes: null, subject_ids: [] } });
  const slot = (day, start_time, end_time) => ({ day, start_time, end_time });
  const args = { groupId: null, teacherId, room: 'A1', schoolYearId: 1, schedules: [slot('Lundi', '14:00', '16:00')] };
  const check = overrides => devInvoke('cmd_check_schedule_conflicts', { ...args, ...overrides });
  assert.deepEqual(await check({}), []);
  const payload = { subject_id: 1, level_id: 1, branch_id: null, teacher_id: teacherId, school_year_id: 1, day_of_week: 'Lundi', start_time: '14:00', end_time: '16:00', room: 'A1', monthly_fee_cents: 10000, capacity: 10,
    schedules: [{ day_of_week: 'Lundi', start_time: '14:00', end_time: '16:00' }, { day_of_week: 'Mercredi', start_time: '10:00', end_time: '12:00' }] };
  const id = await devInvoke('cmd_create_group', { data: payload });
  let found = await check({ teacherId: null, schedules: [slot('Lundi', '15:00', '17:00')] });
  assert.equal(found.length, 1); assert.equal(found[0].conflict_type, 'room');
  assert.equal(found[0].room, 'A1'); assert.equal(found[0].start_time, '14:00'); assert.equal(found[0].end_time, '16:00'); assert.ok(found[0].group_name);
  found = await check({ room: '', schedules: [slot('Mercredi', '11:00', '13:00')] });
  assert.equal(found.length, 1); assert.equal(found[0].conflict_type, 'teacher'); assert.equal(found[0].teacher_name, 'Prof Amrani');
  assert.equal((await check({ schedules: [slot('Lundi', '15:00', '17:00'), slot('Mercredi', '11:00', '13:00')] })).length, 4);
  assert.deepEqual(await check({ schedules: [slot('Lundi', '16:00', '18:00')] }), []);
  assert.deepEqual(await check({ schedules: [slot('Lundi', '12:00', '14:00')] }), []);
  assert.deepEqual(await check({ schedules: [slot('Mardi', '15:00', '17:00')] }), []);
  assert.deepEqual(await check({ groupId: id }), []);
  assert.deepEqual(await check({ schoolYearId: 2 }), []);
  assert.deepEqual(await check({ room: '', teacherId: null }), []);
  assert.deepEqual(await check({ schedules: [slot('Lundi', '16:00', '14:00')] }), []);
  // The command does not block create/update, even with conflicts.
  const second = await devInvoke('cmd_create_group', { data: { ...payload, subject_id: 2 } });
  assert.notEqual(second, id);
  assert.equal((await check({})).length, 4);
  await devInvoke('cmd_delete_to_trash', { entityType: 'group', entityId: second });
  assert.equal((await check({})).length, 2);
  const key = 'centremanager.dev.settings_store_v1';
  let store = JSON.parse(storage.get(key));
  store.groups.find(g => g.id === id).status = 'inactif'; storage.set(key, JSON.stringify(store));
  assert.deepEqual(await check({}), []);
  store = JSON.parse(storage.get(key)); const g = store.groups.find(g => g.id === id); g.status = 'actif'; g.schedules = []; storage.set(key, JSON.stringify(store));
  assert.equal((await check({})).length, 2, 'legacy single-slot group is checked');
  console.log('Schedule conflict backend: room, teacher, multiple slots, boundaries, exclusions, legacy, nonblocking saves passed');
} finally { await server.close(); }
