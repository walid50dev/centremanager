// Browser backend: real group labels from reference ids, including fee-only rows.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const storage = new Map();
globalThis.localStorage = {getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,String(v))};
globalThis.window = {setTimeout};
const server = await createServer({optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {devInvoke:call} = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
  const year = await call('cmd_get_active_school_year');
  const student = await call('cmd_create_student', {data:{full_name:'Groupe Test',first_name:'Groupe',last_name:'Test',phone:'0661234567',guardian_name:'Parent',guardian_phone:'0661234567',enrollment_date:'2024-09-01',level_id:1,status:'actif'}});
  const base={subject_id:1,level_id:1,branch_id:null,teacher_id:null,school_year_id:year.id,room:null,monthly_fee_cents:10000,capacity:10,schedules:[]};
  const group1=await call('cmd_create_group',{data:base});
  const group2=await call('cmd_create_group',{data:{...base,subject_id:2}});
  await call('cmd_enroll_student',{studentId:student,groupId:group1,startDate:'2024-09-01'});
  await call('cmd_enroll_student',{studentId:student,groupId:group2,startDate:'2024-09-01'});
  let alerts=await call('cmd_get_payment_alerts',{month:9,year:2024});
  let row=alerts.late.find(row=>row.student_id===student);
  assert.ok(row); assert.match(row.groups,/Mathématiques 1ère année/); assert.match(row.groups,/Physique-Chimie 1ère année/);
  const key='centremanager.dev.settings_store_v1';
  const state=JSON.parse(storage.get(key));
  // Fee-only month: fall back to current active enrollments, not other-year,
  // ended or deleted groups. Values deliberately contain no denormalized names.
  state.invoices=state.invoices.filter(i=>i.period_month!==8 || i.period_year!==2024);
  state.invoices.push({id:9000,enrollment_id:null,fee_student_id:student,fee_school_year_id:year.id,period_month:8,period_year:2024,amount_cents:10000,paid_amount_cents:0,status:'impayé',due_date:'2024-08-01',created_at:'2024-08-01'});
  state.schoolYears.push({id:99,label:'Autre',start_date:'2030-09-01',end_date:'2031-06-30',is_active:false});
  state.groups.push({...state.groups.find(g=>g.id===group1),id:999,school_year_id:99,subject_id:3});
  state.enrollments.push({id:999,student_id:student,group_id:999,status:'actif',start_date:'2030-09-01',end_date:null});
  storage.set(key,JSON.stringify(state));
  row=(await call('cmd_get_payment_alerts',{month:8,year:2024})).late.find(row=>row.student_id===student);
  assert.match(row.groups,/Mathématiques 1ère année/); assert.match(row.groups,/Physique-Chimie 1ère année/); assert.doesNotMatch(row.groups,/SVT|—/);
  const updated=JSON.parse(storage.get(key)); updated.enrollments.find(e=>e.group_id===group2 && e.student_id===student).status='terminé'; storage.set(key,JSON.stringify(updated));
  row=(await call('cmd_get_payment_alerts',{month:8,year:2024})).late.find(row=>row.student_id===student);
  assert.equal(row.groups,'Mathématiques 1ère année');
  const empty=JSON.parse(storage.get(key)); empty.enrollments.find(e=>e.group_id===group1 && e.student_id===student).status='terminé'; storage.set(key,JSON.stringify(empty));
  row=(await call('cmd_get_payment_alerts',{month:8,year:2024})).late.find(row=>row.student_id===student);
  assert.equal(row.groups,'', 'a student without active groups keeps the UI empty-state dash');
  console.log('Overdue: joined newly-created group names, multiple groups, fee fallback and year isolation passed.');
} finally {await server.close();}
