// Run with: node tests/group-optional-schedule-dev.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k, String(v)) };
globalThis.window = { setTimeout };
const server = await createServer({ optimizeDeps:{ noDiscovery:true }, server:{ middlewareMode:true, hmr:false }, appType:'custom' });
try {
  const { devInvoke: call } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const base = { subject_id:1, level_id:1, branch_id:null, teacher_id:null, school_year_id:1, day_of_week:'Lundi', start_time:'16:00', end_time:'18:00', room:null, monthly_fee_cents:10000, capacity:10 };
  const id = await call('cmd_create_group', { data:{ ...base, schedules:[] } });
  let row = (await call('cmd_get_groups')).find(g => g.id === id);
  assert.deepEqual(row.schedules, []); assert.equal(row.day_of_week, ''); assert.equal(row.room, null);
  assert.ok(!(await call('cmd_get_timetable', {})).some(g => g.group_id === id));
  const slot = { day_of_week:'Lundi', start_time:'04:00', end_time:'05:00' };
  await call('cmd_update_group', { id, data:{ ...base, schedules:[slot] } });
  assert.ok((await call('cmd_get_timetable', {})).some(g => g.group_id === id));
  await call('cmd_update_group', { id, data:{ ...base, schedules:[] } });
  assert.ok(!(await call('cmd_get_timetable', {})).some(g => g.group_id === id));
  assert.equal((await call('cmd_get_groups')).find(g => g.id === id).day_of_week, '');
  await call('cmd_set_group_schedules', { groupId:id, schedules:[slot] });
  assert.deepEqual(await call('cmd_set_group_schedules', { groupId:id, schedules:[] }), []);
  assert.equal((await call('cmd_get_groups')).find(g => g.id === id).start_time, '');
  const { day_of_week, start_time, end_time, ...withoutLegacy } = base;
  const omitted = await call('cmd_create_group', { data:withoutLegacy });
  assert.deepEqual((await call('cmd_get_groups')).find(g => g.id === omitted).schedules, []);
  await assert.rejects(call('cmd_create_group', { data:{ ...withoutLegacy, start_time:'04:00' } }));
  const legacy = await call('cmd_create_group', { data:base });
  assert.equal((await call('cmd_get_groups')).find(g => g.id === legacy).schedules.length, 1);
  await assert.rejects(call('cmd_create_group', { data:{ ...base, schedules:[{ ...slot, end_time:'03:00' }] } }), /fin/);
  console.log('Optional schedules: create, edit, clearing, timetable and legacy payload passed.');
} finally { await server.close(); }
