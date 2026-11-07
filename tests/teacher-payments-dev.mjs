// Run: node tests/teacher-payments-dev.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = { getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,String(v)) };
globalThis.window = { setTimeout };
const server = await createServer({ optimizeDeps:{ noDiscovery:true }, server:{ middlewareMode:true }, appType:'custom' });
try {
  const { devInvoke:call } = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const first = await call('cmd_get_active_school_year');
  { const key = 'centremanager.dev.settings_store_v1'; const state = JSON.parse(storage.get(key)); state.teacherSettlements = []; storage.set(key, JSON.stringify(state)); }
  const teacher = await call('cmd_create_teacher', { data:{ full_name:'Sans configuration', phone:null, email:null, notes:null, subject_ids:[] } });
  const make = overrides => ({ teacherId:teacher, amountCents:12000, paymentDate:'2026-11-07', method:'virement', notes:'Novembre', ...overrides });
  for (const overrides of [{amountCents:0}, {amountCents:-1}, {paymentDate:''}, {paymentDate:'2026-02-30'}, {method:''}, {method:'autre'}]) await assert.rejects(call('cmd_create_teacher_payment', make(overrides)));
  const id = await call('cmd_create_teacher_payment', make());
  let payments = await call('cmd_list_teacher_payments', {teacherId:teacher});
  assert.deepEqual(payments.map(p => [p.id,p.amount_cents,p.payment_date,p.payment_method,p.notes]), [[id,12000,'2026-11-07','virement','Novembre']]);
  assert.equal((await call('cmd_export_year_summary', {yearId:first.id})).salaries_cents, 12000);
  const kpis = await call('cmd_get_dashboard_kpis', {month:11,year:2026});
  assert.equal(kpis.total_compensation_cents, 12000, 'manual payment appears in monthly actuals');
  const second = await call('cmd_create_school_year', {label:'2025-2026',startDate:'2025-09-01',endDate:'2026-06-30'});
  const key = 'centremanager.dev.settings_store_v1';
  let state = JSON.parse(storage.get(key));
  state.teacherYears[teacher].push(second);
  // Historical period falls in year 2, independent of its creation date.
  state.teacherSettlements.push({id:999,teacher_id:teacher,amount_cents:9000,payment_method:'chèque',notes:'ancien',month:10,year:2025,created_at:'2025-11-01 10:00:00'}, {id:998,teacher_id:teacher,amount_cents:3000,payment_method:'espèces',notes:'indéterminé',month:null,year:null,created_at:'2020-01-01'});
  storage.set(key,JSON.stringify(state));
  await call('cmd_switch_school_year', {yearId:second});
  payments = await call('cmd_list_teacher_payments', {teacherId:teacher});
  assert.deepEqual(payments.map(p => p.id), [999]);
  assert.deepEqual((await call('cmd_list_unattributed_teacher_payments', {teacherId:teacher})).map(p => p.id), [998]);
  assert.equal((await call('cmd_export_year_summary', {yearId:second})).salaries_cents, 9000);
  assert.equal((await call('cmd_get_dashboard_kpis', {month:11,year:2026})).total_compensation_cents, 0);
  const otherId = await call('cmd_create_teacher_payment', make({amountCents:23000,paymentDate:'2026-11-07',method:'espèces',notes:null}));
  assert.deepEqual((await call('cmd_list_teacher_payments',{teacherId:teacher})).map(p=>p.id), [otherId,999]);
  assert.equal((await call('cmd_export_year_summary', {yearId:second})).salaries_cents, 32000);
  await call('cmd_switch_school_year', {yearId:first.id});
  assert.deepEqual((await call('cmd_list_teacher_payments',{teacherId:teacher})).map(p=>p.id), [id]);
  // Delete year 2: its explicitly owned payment is removed despite its out-of-year date.
  await call('cmd_delete_school_year', {yearId:second});
  state = JSON.parse(storage.get(key));
  assert.ok(state.teacherSettlements.some(p=>p.id===id)); assert.ok(!state.teacherSettlements.some(p=>p.id===otherId));
  console.log('Teacher payments: no config, validation, legacy history, date, dashboard, export and year isolation passed.');
} finally { await server.close(); }
