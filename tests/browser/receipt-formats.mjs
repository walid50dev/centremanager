import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const options={headless:true}; if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) options.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if(process.env.PLAYWRIGHT_NO_SANDBOX==='1') options.args=['--no-sandbox'];
const browser=await chromium.launch(options); const page=await browser.newPage({viewport:{width:1280,height:800},locale:'fr-FR'}); const id=x=>page.getByTestId(x);
const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>(await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd,args),{cmd,args});
try {
 await page.goto(process.env.SCREENSHOT_BASE_URL||'http://localhost:1420'); await page.locator('input[type=password]').fill('test1234'); await page.locator('form button[type=submit]').click();
 const student=await call('cmd_create_student',{data:{first_name:'Recu',last_name:'FormatTest',phone:'0712345678',guardian_phone:'0612345678',guardian_name:'Parent',level_id:1,enrollment_date:'2026-09-01',status:'actif',enrollment_fee_cents:5000}});
 const group=(await call('cmd_get_groups'))[0]; await call('cmd_enroll_student',{studentId:student,groupId:group.id,startDate:'2026-09-01'});
 await id('nav-payments').click(); await id('payments-new').click();
 await id('payment-student-trigger').click(); await id('payment-student-search').fill('FormatTest'); await id(`payment-student-option-${student}`).click();
 await id('payment-invoices').locator('input[type=checkbox]').first().check(); await id('payment-next').click();
 assert.equal(await page.locator('#payment-notes').getAttribute('required'),null);
 await id('payment-next').click();
 await id('payment-confirm-print').click(); await id('receipt-preview').waitFor();
 assert.equal(await id('receipt-preview').getAttribute('data-template'),'thermal');
 for(const format of ['thermal58','thermal']) { await id(`receipt-template-${format}`).click(); assert.equal(await id('receipt-preview').getAttribute('data-template'),format); }
 await page.getByRole('dialog').last().getByRole('button',{name:'Fermer',exact:true}).first().click();
 await id('nav-settings').click(); await page.getByRole('button',{name:/Impression/}).first().click();
 assert.equal(await page.getByRole('radiogroup').getByRole('radio').count(),2);
 await page.getByRole('radio',{name:/58 mm/}).click(); assert.equal(await call('cmd_get_setting',{key:'receipt_format'}),'thermal58');
 console.log('Browser receipt: optional payment note, two preview formats, thermal default and persistent settings passed.');
} finally {await browser.close();}
