import assert from 'node:assert/strict';
import {createServer} from 'vite';
const values = new Map();
globalThis.localStorage = {getItem:k => values.get(k) ?? null, setItem:(k,v) => values.set(k,String(v))};
globalThis.window = {setTimeout};
const server = await createServer({optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom'});
try {
 const {devInvoke:call} = await server.ssrLoadModule('/src/services/settingsDevBackend.ts');
 const {whatsappUrl} = await server.ssrLoadModule('/src/utils/whatsapp.ts');
 const message='Bonjour Salma El Mansouri, groupe Atlas !';
 const url = new URL(whatsappUrl('06 12 34 56 78',message));
 assert.equal(url.host,'wa.me'); assert.equal(url.pathname,'/212612345678'); assert.equal(url.searchParams.get('text'),message);
 assert.equal(whatsappUrl('06 12 34 56 78'), 'https://wa.me/212612345678'); assert.equal(whatsappUrl('212612345678', message),url.href); assert.equal(whatsappUrl('00212 6 12 34 56 78', message),url.href); assert.equal(whatsappUrl('06.12.34.56.78',message),url.href); assert.equal(whatsappUrl('not-a-phone', message),null); assert.equal(whatsappUrl('0512345678', message),null); assert.equal(whatsappUrl('', message),null); assert.equal(whatsappUrl('+212612345678', message),url.href);
 const base=(await call('cmd_get_groups'))[0];
 const group=await call('cmd_create_group',{data:{name:'Atlas',subject_id:base.subject_id,level_id:base.level_id,school_year_id:base.school_year_id,monthly_fee_cents:30000,capacity:10,schedules:[]}});
 const data={first_name:'Salma',last_name:'Test',phone:'0612345678',guardian_phone:'0712345678',guardian_name:'Parent',level_id:base.level_id,enrollment_date:'2026-09-01',status:'actif'};
 await assert.rejects(call('cmd_create_student',{data:{...data,phone:''}}));
 const first=await call('cmd_create_student',{data}), second=await call('cmd_create_student',{data:{...data,first_name:'Amine'}});
 await assert.rejects(call('cmd_enroll_student_batch',{enrollments:[{student_id:first,group_id:group,start_date:'2026-09-01',custom_monthly_fee_cents:-1}]}));
 await call('cmd_enroll_student_batch',{enrollments:[{student_id:first,group_id:group,start_date:'2026-09-01',custom_monthly_fee_cents:17500},{student_id:second,group_id:group,start_date:'2026-09-01'}]});
 assert.equal((await call('cmd_get_student_invoices',{studentId:first}))[0].amount_cents,17500);
 assert.equal((await call('cmd_get_student_invoices',{studentId:second}))[0].amount_cents,30000);
 assert.equal((await call('cmd_get_student_enrollments',{studentId:first}))[0].monthly_fee_cents,17500);
 assert.equal((await call('cmd_get_group_detail',{id:group})).financial_summary.theoretical_total_cents,47500);
 await call('cmd_generate_monthly_invoices',{month:10,year:2026});
 let invoices=await call('cmd_get_student_invoices',{studentId:first});
 assert.deepEqual(invoices.map(i=>i.amount_cents),[17500,17500]);
 assert.equal(invoices[0].group_name,'Atlas');
 // Idempotence: an existing invoice must not be rewritten.
 const key='centremanager.dev.settings_store_v1'; const store=JSON.parse(values.get(key));
 store.enrollments.find(e=>e.student_id===first).custom_monthly_fee_cents=20000; values.set(key,JSON.stringify(store));
 await call('cmd_generate_monthly_invoices',{month:10,year:2026});
 await call('cmd_generate_monthly_invoices',{month:11,year:2026});
 invoices=await call('cmd_get_student_invoices',{studentId:first});
 assert.deepEqual(invoices.map(i=>i.amount_cents),[20000,17500,17500]);
 console.log('Custom enrollment fees, historical invoices, totals, required phone and WhatsApp URL passed.');
} finally {await server.close();}
