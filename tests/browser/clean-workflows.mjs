import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const opts={headless:true}; if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if(process.env.PLAYWRIGHT_NO_SANDBOX==='1') opts.args=['--no-sandbox'];
const browser=await chromium.launch(opts), page=await browser.newPage({viewport:{width:1440,height:900},locale:'fr-FR'});
const id=x=>page.getByTestId(x), call=(cmd,args={})=>page.evaluate(async({cmd,args})=>(await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd,args),{cmd,args});
try {
 await page.goto(process.env.SCREENSHOT_BASE_URL||'http://localhost:1420');
 await page.locator('input[type=password]').first().waitFor();
 assert.equal((await call('cmd_get_students')).total,0); assert.equal((await call('cmd_get_groups')).length,0); assert.equal((await call('cmd_get_teachers')).length,0);
 await page.locator('input[autocomplete=organization]').fill('Centre test');
 await page.locator('input[type=password]').first().fill('admin123'); await page.locator('input[type=password]').last().fill('admin123'); await page.locator('form button[type=submit]').click();
 await id('nav-students').click(); await page.getByRole('button',{name:/nouvel élève/i}).first().click();
 await id('student-last-name').fill('Essai'); await id('student-first-name').fill('Salma'); await id('student-level-trigger').click(); await id('student-level-option-1').click(); await id('student-phone').fill('0612345678'); await id('student-guardian-name').fill('Parent Essai'); await id('student-guardian-phone').fill('0712345678'); await id('student-save').click(); await page.getByRole('dialog').waitFor({state:'hidden'});
 const student=(await call('cmd_get_students',{search:'Essai'})).data[0];
 const row=page.getByRole('row').filter({hasText:'Salma Essai'}); await row.waitFor(); assert.match(await row.innerText(),/Sans groupe/);
 let url=new URL(await id(`student-whatsapp-${student.id}`).getAttribute('href')); assert.equal(url.pathname,'/212612345678'); assert.match(url.searchParams.get('text'),/Salma Essai/);
 url=new URL(await id(`guardian-whatsapp-${student.id}`).getAttribute('href')); assert.equal(url.pathname,'/212712345678');
 const yr=await call('cmd_get_active_school_year'); const gid=await call('cmd_create_group',{data:{name:'Groupe Atlas',subject_id:1,level_id:2,school_year_id:yr.id,monthly_fee_cents:30000,capacity:10,schedules:[]}});
 await id(`view-student-${student.id}`).click(); await page.getByRole('tab',{name:'Inscriptions'}).click(); await page.getByRole('button',{name:'Inscrire à un groupe'}).first().click();
 let dialog=page.getByRole('dialog'); await dialog.locator('input[type=checkbox]').first().check(); await dialog.getByRole('button',{name:'Suivant'}).click();
 assert.match(await id(`level-warning-${gid}`).innerText(),/diffère/);
 await dialog.locator('input[type=date]').fill(yr.start_date); await dialog.getByRole('button',{name:'Suivant'}).click(); await dialog.getByRole('button',{name:'Suivant'}).click(); await dialog.getByRole('button',{name:"Confirmer l'inscription"}).click(); await dialog.waitFor({state:'hidden'});
 const now=new Date(); await call('cmd_generate_monthly_invoices',{month:now.getMonth()+1,year:now.getFullYear()});
 await id('nav-students').click(); await row.waitFor(); assert.match(await row.innerText(),/Groupe Atlas/); assert.match(await row.innerText(),/En retard/);
 url=new URL(await id(`student-whatsapp-${student.id}`).getAttribute('href')); assert.match(url.searchParams.get('text'),/Groupe Atlas/); assert.match(url.searchParams.get('text'),/300/);
 await id('nav-payments').click(); await id('section-late').waitFor(); const late=id(`late-whatsapp-${student.id}`); await late.waitFor(); assert.match(await late.innerText(),/WhatsApp/); assert.equal(await late.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(22, 163, 74)'); url=new URL(await late.getAttribute('href')); assert.equal(url.pathname,'/212612345678'); assert.match(url.searchParams.get('text'),/Salma Essai/); assert.match(url.searchParams.get('text'),/Groupe Atlas/); assert.match(url.searchParams.get('text'),/300/);
 // Choose an earlier month and actual date, rather than the day of entry.
 await id('payments-new').click(); await id('payment-student-trigger').click(); await id('payment-student-search').fill('Salma Essai'); await id(`payment-student-option-${student.id}`).click();
 const startYear=Number(yr.start_date.slice(0,4)), historical=`${startYear}-10`;
 await id('payment-historic-month').fill(historical); await id('payment-prepare-month').click(); await page.getByText(/Factures créées/).waitFor();
 await id('payment-next').click(); await id('payment-date').fill(`${historical}-15`); await id('payment-next').click(); await id('payment-confirm').click(); await page.getByRole('dialog').waitFor({state:'hidden'});
 const hist=await call('cmd_get_payments_history',{studentId:student.id,month:10,year:startYear}); assert.equal(hist.data.length,1); assert.match(hist.data[0].created_at,new RegExp(`^${historical}-15`));
 // Group-led enrollment warns only for a genuinely different level.
 await call('cmd_create_student',{data:{first_name:'Mouna',last_name:'Test',phone:'0611111111',guardian_phone:'0722222222',guardian_name:'Parent',level_id:1,enrollment_date:yr.start_date,status:'actif'}});
 await call('cmd_create_student',{data:{first_name:'Amine',last_name:'Test',phone:'0633333333',guardian_phone:'0744444444',guardian_name:'Parent',level_id:2,enrollment_date:yr.start_date,status:'actif'}});
 await id('nav-groups').click(); await id(`group-card-${gid}`).click(); await page.getByRole('dialog').first().getByRole('button',{name:'Ajouter élève'}).first().click();
 dialog=page.getByRole('dialog').last(); await dialog.getByRole('radio',{name:'Amine Test'}).check(); await dialog.getByRole('button',{name:'Suivant'}).click(); assert.equal(await id(`level-warning-${gid}`).count(),0);
 await dialog.getByRole('button',{name:'Précédent'}).click(); await dialog.getByRole('radio',{name:'Mouna Test'}).check(); await dialog.getByRole('button',{name:'Suivant'}).click(); assert.match(await id(`level-warning-${gid}`).innerText(),/diffère/);
 await dialog.getByRole('button',{name:'Annuler'}).click(); await page.getByRole('dialog').first().getByRole('button',{name:'Fermer'}).first().click();
 // Confirmation is cancellable; confirmed reset empties all operational data.
 await id('nav-settings').click(); await page.getByRole('button',{name:/Sauvegarde/}).first().click(); await id('reset-data').click(); dialog=page.getByRole('dialog'); await dialog.getByRole('button',{name:'Annuler'}).click(); assert.equal((await call('cmd_get_students')).total,3);
 await id('reset-data').click(); await page.getByRole('dialog').getByRole('button',{name:'Tout supprimer'}).click(); await page.getByText('Données supprimées').waitFor(); assert.equal((await call('cmd_get_students')).total,0); assert.equal((await call('cmd_get_groups')).length,0);
 console.log('Browser: clean first start, first student, mismatch warning, WhatsApp, retroactive payment and confirmed reset passed.');
} finally {await browser.close();}
