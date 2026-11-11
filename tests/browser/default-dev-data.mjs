// Run with a default server on :1420 and an explicit VITE_LOAD_TEST_FIXTURE=1 server on :1422.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const opts={headless:true}; if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if(process.env.PLAYWRIGHT_NO_SANDBOX==='1') opts.args=['--no-sandbox'];
const browser=await chromium.launch(opts);
try {
 const page=await browser.newPage(); await page.goto('http://localhost:1420'); await page.locator('input[type=password]').first().waitFor();
 const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>(await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd,args),{cmd,args});
 assert.equal((await call('cmd_get_students')).total,0); assert.equal((await call('cmd_get_groups')).length,0); assert.equal((await call('cmd_get_teachers')).length,0);
 await page.evaluate(async()=>{const {authApi}=await import('/src/services/auth.ts'); await authApi.setup('Centre','admin123');});
 const student=await call('cmd_create_student',{data:{first_name:'Salma',last_name:'Test',phone:'0612345678',guardian_phone:'0712345678',guardian_name:'Parent',level_id:1,enrollment_date:'2026-09-01',status:'actif'}});
 await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click();
 await page.getByTestId('nav-students').waitFor(); assert.equal((await call('cmd_get_students')).total,1); assert.ok((await call('cmd_get_student_detail',{id:student})).student);
 assert.equal(await page.evaluate(()=>localStorage.getItem('centremanager.dev.load-test-applied-v1')),null);
 const demo=await browser.newPage(); await demo.goto('http://localhost:1422'); await demo.locator('input[type=password]').fill('test1234'); await demo.locator('form button[type=submit]').click(); await demo.getByTestId('kpi-students').getByText('200',{exact:true}).waitFor();
 console.log('Browser default: clean first start and persistent real edits; demo fixture only on explicit opt-in.');
} finally {await browser.close();}
