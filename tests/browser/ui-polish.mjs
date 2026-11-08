// Start Vite, then run node tests/browser/ui-polish.mjs.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const launch={headless:true};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX==='1') launch.args=['--no-sandbox'];
const browser=await chromium.launch(launch);
const page=await browser.newPage({viewport:{width:1280,height:800},locale:'fr-FR'});
const id=name=>page.getByTestId(name);
const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>(await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd,args),{cmd,args});
async function checkPlaceholders(where) {
  const clipped=await page.evaluate(() => {
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
    const visible=e=>!!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
    const issues=[];
    for(const el of document.querySelectorAll('input[placeholder]')) {
      if(!visible(el) || el.value || el.type==='date' || el.type==='time') continue;
      const css=getComputedStyle(el), ph=getComputedStyle(el,'::placeholder');
      ctx.font=`${ph.fontStyle} ${ph.fontWeight} ${ph.fontSize} ${ph.fontFamily}`;
      const width=ctx.measureText(el.placeholder).width + Math.max(0,el.placeholder.length-1)*(parseFloat(ph.letterSpacing)||0);
      const space=el.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
      if(width>space+2) issues.push(`${el.dataset.testid || el.name || el.outerHTML.slice(0,50)}: ${el.placeholder} (${width.toFixed(0)} > ${space.toFixed(0)})`);
    }
    for(const select of document.querySelectorAll('select')) {
      if(!visible(select) || select.value || !select.selectedOptions[0]) continue;
      const css=getComputedStyle(select); ctx.font=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const text=select.selectedOptions[0].textContent, width=ctx.measureText(text).width;
      const space=select.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
      if(width>space+2) issues.push(`select ${select.dataset.testid}: ${text} (${width.toFixed(0)} > ${space.toFixed(0)})`);
    }
    for(const el of document.querySelectorAll('[role=combobox] > span.text-muted')) {
      if(visible(el) && el.scrollWidth>el.clientWidth+1) issues.push(`combobox: ${el.textContent}`);
    }
    return issues;
  });
  assert.deepEqual(clipped,[],`${where}: placeholders doivent être lisibles`);
}
async function closeDialog(){const dialog=page.getByRole('dialog').last(); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(100); await dialog.getByRole('button',{name:/^(Fermer|إغلاق)$/}).first().click(); await dialog.waitFor({state:'hidden'});}
try {
  await page.goto(process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420');
  await page.locator('input[type=password]').first().waitFor();
  await page.evaluate(async()=>{const {authApi}=await import('/src/services/auth.ts'); await authApi.setup('Centre test','admin123');});
  const student=await call('cmd_create_student',{data:{full_name:'Test Groupe',first_name:'Test',last_name:'Groupe',phone:'0661234567',guardian_name:'Parent',guardian_phone:'0661234567',enrollment_date:'2024-09-01',level_id:1,status:'actif'}});
  const group=await call('cmd_create_group',{data:{subject_id:1,level_id:1,branch_id:null,teacher_id:null,school_year_id:1,room:null,monthly_fee_cents:10000,capacity:10,schedules:[]}});
  await call('cmd_enroll_student',{studentId:student,groupId:group,startDate:'2024-09-01'});
  const year2=await call('cmd_create_school_year',{label:'2030-2031',startDate:'2030-09-01',endDate:'2031-06-30'});
  await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click();
  assert.equal((await id('dashboard-greeting').innerText()).trim(),'Bonjour');
  await id('nav-payments').click(); await id('section-late').waitFor(); await id('payments-period').fill('2024-09');
  const late=id('section-late'); await late.getByText('Test Groupe').waitFor();
  let row=late.getByRole('row').filter({hasText:'Test Groupe'});
  assert.match(await row.innerText(),/Mathématiques 1ère année/);
  await page.getByRole('button',{name:'العربية',exact:true}).click();
  assert.match(await row.innerText(),/Mathématiques 1ère année/);
  assert.match(await late.innerText(),/متأخرون/); assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  await id('nav-dashboard').click(); assert.equal((await id('dashboard-greeting').innerText()).trim(),'مرحبًا');
  await page.emulateMedia({colorScheme:'dark'}); assert.equal((await id('dashboard-greeting').innerText()).trim(),'مرحبًا');
  await page.emulateMedia({colorScheme:'light'});
  await page.getByRole('button',{name:'Français',exact:true}).click();
  await id('sidebar-school-year').selectOption(String(year2));
  await page.getByRole('dialog').getByRole('button',{name:'Changer',exact:true}).click();
  await page.waitForFunction(year=>document.querySelector('[data-testid="sidebar-school-year"]')?.value===String(year),year2);
  await id('nav-payments').click(); await id('section-late').waitFor(); await id('payments-period').fill('2024-09');
  assert.equal(await id('section-late').getByText('Test Groupe').count(),0);
  await id('sidebar-school-year').selectOption('1'); await page.getByRole('dialog').getByRole('button',{name:'Changer',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="sidebar-school-year"]')?.value==='1');
  for (const lang of ['fr','ar']) {
    await page.getByRole('button',{name:lang==='fr'?'Français':'العربية',exact:true}).click();
    for (const width of [1280,1024,768,360,320]) {
      await page.setViewportSize({width,height:800});
      await id('nav-students').click(); await id('students-search').waitFor(); await checkPlaceholders(`${lang} ${width} élèves`);
      await page.getByRole('button',{name:lang==='fr'?/Nouvel élève/:/تلميذ جديد/}).first().click(); await id('student-last-name').waitFor(); await checkPlaceholders(`${lang} ${width} formulaire élève`); await closeDialog();
      await id('nav-groups').click(); await page.getByRole('button',{name:lang==='fr'?'Nouveau groupe':'مجموعة جديدة'}).first().click(); await id('group-subject-trigger').waitFor(); await checkPlaceholders(`${lang} ${width} formulaire groupe`); await closeDialog();
      await id('nav-teachers').click(); await id('teacher-new').click(); await page.getByRole('dialog').last().getByText('Mathématiques',{exact:true}).waitFor(); await checkPlaceholders(`${lang} ${width} formulaire enseignant`); await closeDialog();
      await id('nav-payments').click(); await id('payments-new').click(); await page.getByRole('dialog').last().waitFor(); await checkPlaceholders(`${lang} ${width} paiement`); await closeDialog();
      await id('nav-timetable').click(); await id('timetable-filters').waitFor(); await checkPlaceholders(`${lang} ${width} emploi du temps`);
      await id('nav-expenses').click(); await id('expenses-filter').waitFor(); await checkPlaceholders(`${lang} ${width} dépenses`);
      await id('expense-new').click(); await id('expense-label').waitFor(); await checkPlaceholders(`${lang} ${width} formulaire dépense`); await closeDialog();
      await id('nav-settings').click(); await page.locator('input[placeholder]').first().waitFor(); await checkPlaceholders(`${lang} ${width} paramètres`);
    }
  }
  console.log('UI polish: FR/AR greeting and overdue groups, year switch, navigation, color schemes and placeholder geometry passed.');
} finally {await browser.close();}
