import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const opts = {headless:true}; if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') opts.args=['--no-sandbox'];
const browser = await chromium.launch(opts); const page = await browser.newPage({viewport:{width:1280,height:900},locale:'fr-FR'});
const id=x=>page.getByTestId(x), call=(cmd,args={})=>page.evaluate(async({cmd,args})=>(await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd,args),{cmd,args});
try {
 await page.goto(process.env.SCREENSHOT_BASE_URL||'http://localhost:1420'); await page.locator('input[type=password]').first().waitFor();
 await page.evaluate(async()=>(await import('/src/services/auth.ts')).authApi.setup('Centre test','admin123'));
 const year=await call('cmd_create_school_year',{label:'2020-2021',startDate:'2020-09-01',endDate:'2021-08-31'}); await call('cmd_switch_school_year',{yearId:year});
 const group=await call('cmd_create_group',{data:{name:'Atlas',subject_id:1,level_id:1,school_year_id:year,monthly_fee_cents:10000,capacity:10,schedules:[]}});
 const group2=await call('cmd_create_group',{data:{name:'Rif',subject_id:1,level_id:1,school_year_id:year,monthly_fee_cents:20000,capacity:10,schedules:[]}});
 await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click(); await id('nav-students').click(); await page.getByRole('button',{name:/nouvel élève/i}).first().click();
 await id('student-last-name').fill('Essai'); await id('student-first-name').fill('Salma'); await id('student-level-trigger').click(); await id('student-level-option-1').click(); await id('student-phone').fill('0612345678'); await id('student-guardian-name').fill('Parent Essai'); await id('student-guardian-phone').fill('0712345678'); await id('student-complementary-toggle').click(); await id('student-cin').fill('AB123'); await id('student-enrollment-date').fill('2020-09-01'); await id('student-save').click(); await page.getByRole('dialog').waitFor({state:'hidden'});
 const student=(await call('cmd_get_students',{search:'Salma'})).data[0]; assert.equal(student.cin_tuteur,'AB123');
 await call('cmd_enroll_student_batch',{enrollments:[{student_id:student.id,group_id:group,start_date:'2020-09-01'},{student_id:student.id,group_id:group2,start_date:'2020-09-01'}]});
 const invoices=await call('cmd_get_student_invoices',{studentId:student.id});
 const payment=await call('cmd_record_payment',{studentId:student.id,invoiceIds:invoices.map(i=>i.id),amountCents:15000,method:'espèces',paymentDate:'2020-09-15'});
 await id(`view-student-${student.id}`).click(); const sheet=id('student-sheet'); await sheet.getByRole('tab',{name:'Informations personnelles'}).waitFor();
 for (const language of ['fr','ar','fr']) {
  await page.evaluate(async lang=>(await import('/src/stores/appStore.ts')).useAppStore.getState().setLanguage(lang),language); await page.waitForFunction(lang=>document.documentElement.lang===lang,language); await page.setViewportSize({width:375,height:900});
  for(const [kind,phone] of [['student','/212612345678'],['guardian','/212712345678']]) { const link=id(`sheet-whatsapp-${kind}`); assert.equal(new URL(await link.getAttribute('href')).pathname,phone); assert.ok((await link.getAttribute('aria-label')).length>0); }
  for(const phoneId of ['student-detail-phone','student-detail-guardian-phone']) { const span=id(phoneId); assert.equal(await span.evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap'); assert.equal(await span.evaluate(el=>el.tagName),'SPAN'); }
  assert.equal(await sheet.locator('a[href*="wa.me"]').count(),2);
  assert.equal(await id('sheet-whatsapp-student').innerText(),language==='fr'?'WhatsApp Élève':'واتساب التلميذ'); assert.equal(await id('sheet-whatsapp-guardian').innerText(),language==='fr'?'WhatsApp Tuteur':'واتساب ولي الأمر');
 }
 await page.setViewportSize({width:1280,height:900}); assert.match(await sheet.innerText(),/AB123/); assert.doesNotMatch(await sheet.innerText(),/Nom du père|Nom de la mère/);
 await sheet.getByRole('tab',{name:'Absences et suivi'}).click(); await id('absence-add').click(); await id('absence-group').selectOption(String(group)); await id('absence-date').fill('2020-09-12'); await id('absence-reason').fill('Malade'); await id('absence-justified').check(); await id('absence-save').click(); await id('student-absences').getByText('Malade').waitFor(); assert.match(await id('student-absences').innerText(),/Atlas/); assert.match(await id('student-absences').innerText(),/Oui/);
 const absence=(await call('cmd_get_student_absences',{studentId:student.id}))[0]; await id(`absence-delete-${absence.id}`).click(); let dialog=page.getByRole('dialog').last(); await dialog.getByRole('button',{name:'Annuler'}).click(); assert.equal((await call('cmd_get_student_absences',{studentId:student.id})).length,1);
 await id(`absence-delete-${absence.id}`).click(); dialog=page.getByRole('dialog').last(); await dialog.getByRole('button',{name:'Supprimer l’absence',exact:true}).click(); await id('student-absences').waitFor({state:'hidden'}); assert.equal((await call('cmd_get_student_absences',{studentId:student.id})).length,0);
 await sheet.getByRole('button',{name:'Fermer'}).first().click(); await id('nav-payments').click(); await id('payments-period').fill('2020-09');
 const late=id(`late-whatsapp-${student.id}`); await late.waitFor(); let url=new URL(await late.getAttribute('href')); assert.equal(url.pathname,'/212612345678'); assert.match(url.searchParams.get('text'),/Salma Essai/); assert.match(url.searchParams.get('text'),/ton paiement/);
 const guardian=new URL(await id(`late-guardian-whatsapp-${student.id}`).getAttribute('href')); assert.equal(guardian.pathname,'/212712345678'); assert.match(guardian.searchParams.get('text'),/Salma Essai/);
 let row=late.locator('xpath=ancestor::tr'); assert.match(await row.innerText(),/06 12 34 56 78/); assert.match(await row.innerText(),/WhatsApp Tuteur/);
 for(const [language,width] of [['fr',375],['ar',375],['fr',1280]]) {
  await page.evaluate(async lang=>(await import('/src/stores/appStore.ts')).useAppStore.getState().setLanguage(lang),language); await page.waitForFunction(lang=>document.documentElement.lang===lang,language); await page.setViewportSize({width,height:900}); await late.waitFor();
  const geometry=await row.evaluate(el=>{ const cell=el.cells[1], phone=cell.querySelector('[dir=ltr]'), icon=cell.querySelector('a'); const p=phone.getBoundingClientRect(),a=icon.getBoundingClientRect(); return {nowrap:getComputedStyle(phone).whiteSpace,overlap:p.top<a.bottom&&p.bottom>a.top,iconWidth:a.width,overflow:getComputedStyle(el.closest('table').parentElement).overflowX}; });
  assert.equal(geometry.nowrap,'nowrap'); assert.ok(geometry.overlap); assert.equal(geometry.iconWidth,28); assert.equal(geometry.overflow,'auto');
  const studentMessage=new URL(await late.getAttribute('href')).searchParams.get('text'); const guardianMessage=new URL(await id(`late-guardian-whatsapp-${student.id}`).getAttribute('href')).searchParams.get('text');
  assert.match(studentMessage,/Salma Essai/); assert.match(studentMessage,/Atlas/); assert.match(guardianMessage,/Salma Essai/); assert.notEqual(studentMessage,guardianMessage); if(language==='ar') {assert.match(studentMessage,/مرحباً/); assert.match(guardianMessage,/مرحباً/);}

 }
 await row.getByTestId('payment-collect').click(); await id('payment-invoices').waitFor(); await page.getByRole('dialog').last().getByRole('button',{name:'Fermer'}).first().click();
 await page.getByRole('tab',{name:'Historique',exact:true}).click(); const history=id('payments-history'); await history.waitFor(); assert.match(await history.innerText(),/Atlas/); assert.match(await history.innerText(),/Rif/); assert.match(await history.innerText(),/septembre/i);
 await id(`history-receipt-${payment}`).click(); await id('receipt-template-thermal').waitFor(); await id('receipt-template-thermal58').click(); const receipt=page.getByRole('dialog').last(); await receipt.getByRole('button',{name:'Fermer'}).first().click(); await id('receipt-template-thermal58').waitFor({state:'hidden'});
 await id(`history-delete-${payment}`).click(); dialog=page.getByRole('dialog').last(); assert.match(await dialog.innerText(),/toute la transaction/); await dialog.getByRole('button',{name:'Annuler'}).click(); assert.equal((await call('cmd_get_payments_history',{studentId:student.id})).total,2);
 await id(`history-delete-${payment}`).click(); dialog=page.getByRole('dialog').last(); await dialog.getByRole('button',{name:'Supprimer le paiement',exact:true}).click(); await history.waitFor({state:'hidden'});
 assert.equal((await call('cmd_get_payments_history',{studentId:student.id})).total,0); assert.ok((await call('cmd_get_student_invoices',{studentId:student.id})).every(i=>i.paid_amount_cents===0));
 // Legacy invalid numbers must never silently redirect the student's link to the guardian (or vice versa).
 const patchPhone = async (phone,guardianPhone) => { await page.evaluate(({studentId,phone,guardianPhone})=>{ const key='centremanager.dev.settings_store_v1',store=JSON.parse(localStorage.getItem(key)); const record=store.students.find(s=>s.id===studentId); record.phone=phone; record.guardian_phone=guardianPhone; localStorage.setItem(key,JSON.stringify(store)); },{studentId:student.id,phone,guardianPhone}); await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click(); };
 await patchPhone('', '0712345678'); await id('nav-students').click(); await id(`view-student-${student.id}`).waitFor(); assert.equal(await id(`student-whatsapp-${student.id}`).count(),0);
 await id(`view-student-${student.id}`).click(); await id('sheet-whatsapp-guardian').waitFor(); assert.equal(await id('sheet-whatsapp-student').count(),0); await id('student-sheet').getByRole('button',{name:'Fermer'}).first().click();
 await id('nav-payments').click(); await id('payments-period').fill('2020-09'); await id(`late-guardian-whatsapp-${student.id}`).waitFor(); assert.equal(await id(`late-whatsapp-${student.id}`).count(),0);
 await patchPhone('0612345678', ''); await id('nav-students').click(); await id(`student-whatsapp-${student.id}`).waitFor(); await id(`view-student-${student.id}`).click(); await id('sheet-whatsapp-student').waitFor(); assert.equal(await id('sheet-whatsapp-guardian').count(),0); assert.equal(await sheet.locator('a[href*="wa.me"]').count(),1);
 console.log('Browser: student and guardian contacts, absence CRUD, responsive WhatsApp, receipt and confirmed batch deletion passed.');
} finally {await browser.close();}
