import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
globalThis.window={setTimeout};
const server=await createServer({optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {devInvoke:call}=await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const {seedLoadTest}=await server.ssrLoadModule('/scripts/load-test-fixture.mjs');
  const now=new Date();
  assert.equal(await seedLoadTest({now}),true);
  const key='centremanager.dev.settings_store_v1';
  const store=JSON.parse(storage.get(key));
  assert.equal(store.students.length,200); assert.equal(store.groups.length,14); assert.equal(store.teachers.length,6); assert.equal(store.expenses.length,12); assert.equal(store.teacherSettlements.length,6);
  assert.equal(store.enrollments.length,300); assert.equal(store.groups.filter(g=>!g.schedules.length).length,2);
  assert.equal(store.invoices.filter(i=>i.fee_student_id).length,180);
  assert.ok(store.students.some(s=>/[\u0600-\u06ff]/.test(s.full_name)));
  assert.ok(store.students.every(s=>/^0[67]\d{8}$/.test(s.guardian_phone)));
  assert.ok(store.groups.every(g=>g.enrolled_count<=g.capacity));
  const month=now.getMonth()+1, year=now.getFullYear();
  const selected=store.invoices.filter(i=>!i.fee_student_id && i.period_month===month && i.period_year===year);
  for (let i=1;i<=200;i++) {
    const ids=new Set(store.enrollments.filter(e=>e.student_id===i).map(e=>e.id));
    const rows=selected.filter(x=>ids.has(x.enrollment_id));
    const expected=(i-1)%20<14?'payé':(i-1)%20<17?'partiel':'impayé';
    assert.ok(rows.length>=1 && rows.every(x=>x.status===expected));
  }
  const before=storage.get(key); assert.equal(await seedLoadTest({now}),false); assert.equal(storage.get(key),before,'existing profiles are not overwritten');
  const list=await call('cmd_get_students',{page:1,limit:20}); assert.equal(list.total,200); assert.equal(list.data.length,20);
  const page2=await call('cmd_get_students',{page:2,limit:20}); assert.notEqual(list.data[0].id,page2.data[0].id);
  assert.ok((await call('cmd_get_students',{search:'Bennani'})).total>0);
  const start=performance.now();
  const kpi=await call('cmd_get_dashboard_kpis',{month,year});
  const elapsed=performance.now()-start;
  assert.equal(kpi.total_active_students,200); assert.equal(kpi.active_groups,14); assert.ok(kpi.monthly_revenue_cents>0);
  const alerts=await call('cmd_get_payment_alerts',{month,year});
  assert.equal(alerts.current.length,140); assert.equal(alerts.late.length,60);
  assert.ok(alerts.late.every(row=>row.groups && row.total_due_cents>0));
  assert.ok((await call('cmd_get_expenses',{month,year})).length>=1);
  assert.equal((await call('cmd_get_timetable')).length,12);
  assert.deepEqual(await call('cmd_list_trash'),[]);
  await call('cmd_delete_to_trash',{entityType:'student',entityId:1}); assert.ok((await call('cmd_list_trash')).some(x=>x.entity_id===1));
  await call('cmd_restore_from_trash',{entityType:'student',entityId:1}); assert.equal((await call('cmd_get_students',{})).total,200);
  await call('cmd_switch_school_year',{yearId:2}); assert.equal((await call('cmd_get_students',{})).total,0);
  await call('cmd_switch_school_year',{yearId:1}); assert.equal((await call('cmd_get_students',{})).total,200);
  console.log(`Load fixture: 200 students, 300 enrollments, 14 groups, 70/15/15, fees, dashboard, search, trash and year switch passed; KPI ${elapsed.toFixed(0)} ms incl. simulated backend latency.`);
} finally { await server.close(); }
