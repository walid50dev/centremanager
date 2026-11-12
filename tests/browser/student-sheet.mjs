// Run against the clean Vite server. All data lives in the isolated test browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const opts = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') opts.args = ['--no-sandbox'];
const browser = await chromium.launch(opts);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
const id = name => page.getByTestId(name);
const call = (cmd, args = {}) => page.evaluate(async ({ cmd, args }) => (await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd, args), { cmd, args });
try {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00'));
  await page.goto(process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420');
  await page.locator('input[type=password]').first().waitFor();
  await page.evaluate(async () => (await import('/src/services/auth.ts')).authApi.setup('Centre test', 'admin123'));
  const year = await call('cmd_get_active_school_year');
  const group = await call('cmd_create_group', { data: { name: 'Groupe Atlas', subject_id: 1, level_id: 1, school_year_id: year.id, monthly_fee_cents: 30000, capacity: 20, schedules: [] } });
  const student = await call('cmd_create_student', { data: { first_name: 'Salma', last_name: 'Essai', phone: '0661070809', guardian_name: 'Parent Essai', guardian_phone: '0712345678', level_id: 1, enrollment_date: '2026-10-01', status: 'actif', notes: 'Remarque test' } });
  const lateStudent = await call('cmd_create_student', { data: { first_name: 'Amine', last_name: 'Essai', phone: '0661111111', guardian_name: 'Parent Amine', guardian_phone: '0711111111', level_id: 1, enrollment_date: '2026-10-01', status: 'actif' } });
  const noGroupStudent = await call('cmd_create_student', { data: { first_name: 'Nadia', last_name: 'Essai', phone: '0662222222', guardian_name: 'Parent Nadia', guardian_phone: '0722222222', level_id: 1, enrollment_date: '2026-10-01', status: 'actif' } });
  await call('cmd_enroll_student_batch', { enrollments: [{ student_id: student, group_id: group, start_date: '2026-10-01', custom_monthly_fee_cents: 17500 }, { student_id: lateStudent, group_id: group, start_date: '2026-10-01' }] });
  const invoice = (await call('cmd_get_student_invoices', { studentId: student })).find(i => i.kind === 'invoice');
  const payment = await call('cmd_record_payment', { studentId: student, invoiceIds: [invoice.id], amountCents: 5000, method: 'espèces' });
  await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click(); await id('nav-students').click();
  const row = page.getByRole('row').filter({ hasText: 'Salma Essai' }); await row.waitFor();
  assert.match(await row.innerText(), /Partiel/); assert.match(await row.innerText(), /Actif/); assert.match(await row.innerText(), /Groupe Atlas/);
  assert.match(await id(`view-student-${noGroupStudent}`).locator('xpath=ancestor::tr').innerText(), /Non défini/);
  await id(`view-student-${student}`).click();
  const sheet = id('student-sheet'); await sheet.waitFor(); await sheet.getByRole('tab', { name: 'Informations personnelles' }).waitFor();
  assert.equal(await sheet.getByRole('tab').count(), 4);
  assert.match(await sheet.innerText(), /06 61 07 08 09/); assert.match(await sheet.innerText(), /07 12 34 56 78/); assert.match(await sheet.innerText(), /Remarque test/);
  // Neither backdrop nor Escape dismisses a modal.
  await page.locator('[role=dialog][aria-label="Fiche élève"]').click({ position: { x: 2, y: 2 } }); await page.keyboard.press('Escape'); assert.ok(await sheet.isVisible());
  await sheet.getByRole('tab', { name: 'Groupes et tarifs' }).click();
  const enrollmentTable = id('active-enrollments'); await enrollmentTable.waitFor();
  assert.match(await enrollmentTable.innerText(), /Groupe Atlas/); assert.match(await enrollmentTable.innerText(), /300[.,]00/); assert.match(await enrollmentTable.innerText(), /175[.,]00/); assert.match(await enrollmentTable.innerText(), /Réduction/);
  await sheet.getByRole('tab', { name: 'Historique des paiements' }).click();
  const history = id('student-payments'); await history.waitFor();
  assert.match(await history.innerText(), /Groupe Atlas/); assert.match(await history.innerText(), /50[.,]00/); assert.match(await history.innerText(), /octobre/i);
  await id(`student-receipt-${payment}`).click();
  await id('receipt-template-thermal').waitFor(); await id('receipt-template-thermal58').click();
  const receiptDialog = page.getByRole('dialog').last(); await receiptDialog.getByRole('button', { name: 'Fermer' }).first().click(); await id('receipt-template-thermal58').waitFor({ state: 'hidden' });
  await sheet.getByRole('tab', { name: 'Absences et suivi' }).click(); assert.match(await sheet.innerText(), /Module de suivi des absences : Prochainement disponible/);
  // Edit within the sheet and verify real persisted data.
  await sheet.getByRole('button', { name: 'Modifier' }).click(); await id('student-first-name').fill('Sara'); await id('student-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="student-sheet"]')?.textContent.includes('Sara Essai'));
  await sheet.getByRole('button', { name: 'Fermer' }).first().click(); await row.waitFor({ state: 'hidden' });
  const updated = page.getByRole('row').filter({ hasText: 'Sara Essai' }); await updated.waitFor();
  await call('cmd_record_payment', { studentId: student, invoiceIds: [invoice.id], amountCents: 12500, method: 'espèces' });
  await page.clock.setFixedTime(new Date('2026-10-03T12:00:00'));
  await page.reload(); await page.locator('input[type=password]').fill('admin123'); await page.locator('form button[type=submit]').click(); await id('nav-students').click(); await page.getByRole('row').filter({ hasText: 'Sara Essai' }).getByText('Payé', { exact: true }).waitFor();
  await id(`view-student-${lateStudent}`).locator('xpath=ancestor::tr').getByText('En retard', { exact: true }).waitFor();
  console.log('Browser: student sheet, payment status, real enrollment and payment history, receipt formats, edit and explicit modal dismissal passed.');
} finally { await browser.close(); }
