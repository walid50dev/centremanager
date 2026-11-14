// Additional UI capture journey. All writes are confined to Playwright's fresh context.
export async function captureModalScreens({ page, step, nav }) {
  const tid = name => page.getByTestId(name);
  async function closeAll() {
    for (let i = 0; i < 5 && await page.getByRole('dialog').count(); i++) {
      // Some nested controls stop Escape propagation: use the top dialog's X.
      await page.getByRole('dialog').last().getByRole('button', { name: 'Fermer', exact: true }).first().click();
      await page.waitForTimeout(300);
    }
    if (await page.getByRole('dialog').count()) throw new Error('Une fenêtre est encore ouverte.');
  }
  async function modalStep(name, action) {
    await step(name, async () => { await closeAll(); await action(); });
  }
  async function studentForm() {
    await nav('students');
    await page.getByRole('button', { name: /nouvel élève/i }).first().click();
    await tid('student-last-name').fill('El Mansouri');
    await tid('student-first-name').fill('Salma');
    await tid('student-level-trigger').click();
    await tid('student-level-option-12').click();
    await tid('duplicate-student-1').waitFor();
    await tid('duplicate-student-1').getByRole('button', { name: 'Ignorer' }).click();
  }
  async function groupForm() {
    await nav('groups');
    await page.getByRole('button', { name: /nouveau groupe/i }).first().click();
    await tid('group-subject-trigger').click();
    await tid('group-subject-option-1').click();
    await tid('group-level-trigger').click();
    await tid('group-level-option-12').click();
  }
  async function teacherDetail() {
    await nav('teachers');
    await tid('teacher-card-1').click();
    await page.getByRole('heading', { name: 'Prof. Amrani' }).waitFor();
  }
  async function studentDetail() {
    await nav('students');
    await page.getByText('Salma El Mansouri').first().click();
    await page.getByRole('heading', { name: 'Salma El Mansouri' }).waitFor();
  }
  const scroll = locator => locator.evaluate(element => element.scrollIntoView({ block: 'start' }));

  await modalStep('22-modal-add-student-step1', async () => { await studentForm(); });
  await modalStep('23-modal-add-student-step2', async () => { await studentForm(); await scroll(tid('student-guardian-name'));  });
  await modalStep('24-modal-add-student-step3', async () => { await studentForm(); await tid('student-complementary-toggle').click(); await scroll(tid('student-complementary-toggle')); });
  await modalStep('25-modal-edit-student', async () => { await studentDetail(); await page.getByRole('button', { name: 'Modifier', exact: true }).click(); await tid('student-first-name').waitFor(); });
  await modalStep('26-modal-add-group', async () => { await groupForm(); });
  await modalStep('27-modal-add-group-schedules', async () => { await nav('timetable'); await tid('timetable-manage').click(); await tid('timetable-group').selectOption('1'); await tid('timetable-slot').first().waitFor(); });
  await modalStep('28-modal-edit-group', async () => { await nav('groups'); await tid('group-card-1').click(); await page.getByRole('dialog').getByRole('button', { name: 'Modifier', exact: true }).click(); await tid('group-fee').waitFor(); });
  await modalStep('29-modal-add-teacher', async () => { await nav('teachers'); await tid('teacher-new').click(); await page.getByRole('dialog').getByLabel(/nom complet/i).fill('Prof. Alaoui'); });
  await modalStep('30-modal-edit-teacher', async () => { await teacherDetail(); await page.getByRole('button', { name: 'Modifier', exact: true }).click(); await page.getByRole('dialog').getByLabel(/nom complet/i).waitFor(); });
  await modalStep('31-teacher-payment-history', async () => { await teacherDetail(); await page.getByRole('tab', { name: 'Paiements', exact: true }).click(); await tid('comp-settle').waitFor(); });
  // The compensation configuration is an inline card, not a modal in this app.
  await modalStep('32-modal-add-teacher-compensation', async () => { await teacherDetail(); await tid('comp-mode').selectOption('fixed_monthly'); await tid('comp-amount').fill('2500'); await tid('comp-bonus-toggle').check(); await tid('comp-bonus-pct').fill('5'); await scroll(tid('compensation-config')); });
  await modalStep('33-modal-add-teacher-settlement', async () => { await tid('comp-save').click(); await page.getByRole('tab', { name: 'Paiements', exact: true }).click(); await tid('comp-settle').waitFor({ state: 'visible' }); await tid('comp-settle').click(); await tid('settlement-amount').waitFor(); });
  await modalStep('34-modal-add-payment', async () => { await nav('payments'); await tid('payments-new').click(); await tid('payment-student-trigger').click(); await tid('payment-student-option-2').click(); await tid('payment-invoices').locator('input[type=checkbox]').first().check(); await tid('payment-next').click(); await tid('payment-amount').waitFor(); });
  await modalStep('35-modal-add-expense', async () => { await nav('expenses'); await tid('expense-new').click(); await page.getByRole('dialog').waitFor(); });
  await modalStep('36-modal-edit-expense', async () => { await nav('expenses'); await tid('expense-edit-1').click(); await page.getByRole('dialog').waitFor(); });
  await modalStep('37-modal-enroll-student', async () => { await studentDetail(); await page.getByRole('tab', { name: 'Inscriptions' }).click(); await page.getByRole('button', { name: 'Inscrire à un groupe' }).first().click(); await page.getByRole('dialog').getByText('Salma El Mansouri').waitFor(); });
  await modalStep('38-modal-import-students', async () => { await nav('students'); await tid('import-students').click(); await tid('import-search').waitFor(); });
  await modalStep('39-modal-import-groups', async () => {
    // Add a historical group only in the disposable context, to exercise a non-empty import.
    await page.evaluate(async () => {
      const { devInvoke } = await import('/src/services/settingsDevBackend.ts');
      await devInvoke('cmd_create_group', { data: { subject_id: 2, level_id: 12, branch_id: null, teacher_id: null, school_year_id: 1, day_of_week: 'Jeudi', start_time: '16:00', end_time: '18:00', room: 'A3', monthly_fee_cents: 40000, capacity: 18 } });
    });
    await nav('groups'); await tid('import-groups').click(); await tid('import-search').waitFor(); });
  await modalStep('40-modal-creatable-teacher', async () => { await groupForm(); await tid('group-teacher-trigger').click(); await tid('group-teacher-search').fill('Prof. Alaoui'); await tid('group-teacher-create').click(); const dialog = page.getByRole('dialog').last(); await dialog.getByLabel(/nom complet/i).fill('Prof. Alaoui'); await dialog.getByTestId('teacher-subject-1').waitFor(); });
  await modalStep('41-modal-delete-confirm', async () => { await nav('students'); await tid('trash-student-1').click(); await page.getByRole('dialog').waitFor(); });
  await modalStep('42-modal-trash-empty-confirm', async () => { await nav('trash'); await page.getByText('Anciennes fournitures').waitFor(); await page.getByRole('button', { name: 'Vider la corbeille' }).click(); await page.getByRole('dialog').waitFor(); });
  await modalStep('43-modal-duplicate-warning', async () => { await nav('students'); await page.getByRole('button', { name: /nouvel élève/i }).first().click(); await tid('student-first-name').fill('Salma'); await tid('student-last-name').fill('El Mansouri'); await tid('student-guardian-phone').fill('0661010101'); await tid('duplicate-student-1').waitFor(); await scroll(tid('duplicate-student-1')); });
  await closeAll();
}
