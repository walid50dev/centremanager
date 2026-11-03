/**
 * Phase 12 — the CreatableSelect pattern and its quick-create dialogs.
 * Temporary browser suite (deleted after the phase).
 *
 * Runs against the Vite dev server with the localStorage backend, so every
 * creation is also checked in the store, not only on screen.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:1420';
const SHOTS = 'docs/screenshots';
const STORE_KEY = 'centremanager.dev.settings_store_v1';
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
const consoleIssues = [];

function ok(label, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const strip = (value) => String(value).replace(/[\u2066-\u2069]/g, '');
const nb = (value) => String(value).replace(/[\u00A0\u202F\u2009]/g, ' ');

const browser = await chromium.launch();

async function signIn(page) {
  await page.getByLabel('Mot de passe', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: /^Connexion$/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function login() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleIssues.push(`error: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleIssues.push(`pageerror: ${String(error)}`));

  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Nom du centre').fill('Centre Excellence Casablanca');
  await page.getByLabel('Mot de passe', { exact: true }).fill('test1234');
  await page.getByLabel('Confirmer le mot de passe').fill('test1234');
  await page.getByRole('button', { name: /Créer mon espace/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await page.getByTestId('kpi-students-value').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return { context, page };
}

async function go(page, path) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(1200);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

/** Opens the dropdown of a CreatableSelect by its test id. */
async function openDropdown(page, testId) {
  await page.getByTestId(`${testId}-trigger`).click();
  await page.getByTestId(`${testId}-list`).waitFor({ timeout: 5000 });
  await page.waitForTimeout(200);
}

const OPTION = (testId, value) => `[data-testid="${testId}-option-${value}"]`;

let STEP = 'login';

try {
  const { page } = await login();

  // ================================================== 1. the component itself ===
  STEP = 'component';
  await go(page, '/groups');
  await page.locator('button', { hasText: 'Nouveau groupe' }).first().click();
  await page.waitForTimeout(1000);

  const subjectTrigger = page.getByTestId('group-subject-trigger');
  ok('the dropdown is a combobox trigger', (await subjectTrigger.getAttribute('role')) === 'combobox');
  ok(
    'it shows the placeholder while empty',
    strip(await subjectTrigger.innerText()).includes('Choisir une matière') ||
      strip(await subjectTrigger.innerText()).includes('Sélectionner'),
    strip(await subjectTrigger.innerText()),
  );

  await openDropdown(page, 'group-subject');
  const rows = page.locator('[data-testid^="group-subject-option-"]');
  ok('the options are listed', (await rows.count()) > 0, await rows.count());

  const lastRow = page.locator('[data-testid="group-subject-list"] [role="listbox"] > li').last();
  ok(
    'the create row is the last item, after a separator',
    (await lastRow.locator('[data-testid="group-subject-create"]').count()) === 1,
    await lastRow.innerText(),
  );
  ok(
    'the create row is tinted with the primary colour',
    (await page
      .getByTestId('group-subject-create')
      .evaluate((node) => getComputedStyle(node).color)).includes('37, 99, 235'),
    await page.getByTestId('group-subject-create').evaluate((node) => getComputedStyle(node).color),
  );
  ok(
    'the create row carries a plus icon',
    (await page.getByTestId('group-subject-create').locator('svg').count()) === 1,
  );
  ok(
    'the create row is labelled "+ Nouveau…"',
    strip(await page.getByTestId('group-subject-create').innerText()).includes('Nouveau'),
    strip(await page.getByTestId('group-subject-create').innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase12-01-creatable-dropdown.png` });

  // ---- keyboard: arrows, Enter, Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape closes the dropdown', (await page.getByTestId('group-subject-list').count()) === 0);

  await subjectTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  ok('ArrowDown opens the dropdown', (await page.getByTestId('group-subject-list').count()) === 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok(
    'ArrowDown + Enter selects an option',
    !strip(await subjectTrigger.innerText()).includes('Choisir'),
    strip(await subjectTrigger.innerText()),
  );
  ok('the dropdown closed after Enter', (await page.getByTestId('group-subject-list').count()) === 0);

  // ======================================== 2. quick-create from the group form ===
  STEP = 'quick-subject';
  // Fill other fields first: they must survive the round trip.
  const feeField = page.getByTestId('group-fee');
  await feeField.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('450');
  await page.keyboard.press('Tab');
  const capacityField = page.getByTestId('group-capacity');
  await capacityField.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('14');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  await openDropdown(page, 'group-subject');
  await page.getByTestId('group-subject-create').click();
  await page.waitForTimeout(700);

  const dialog = page.locator('[role="dialog"]');
  ok(
    'the quick-create modal opens on top (z-60)',
    (await page.locator('[data-modal-z="60"]').count()) === 1,
    await page.locator('[data-modal-z]').evaluateAll((nodes) => nodes.map((n) => n.dataset.modalZ)),
  );
  ok(
    'the parent form is still mounted underneath (z-50)',
    (await page.locator('[data-modal-z="50"]').count()) === 1,
  );
  ok(
    'the quick-create modal is titled "Nouvelle matière"',
    strip(await page.getByTestId('quick-create-subject').innerText()).includes('Nouvelle matière'),
    strip(await page.getByTestId('quick-create-subject').innerText()).slice(0, 80),
  );
  ok(
    'the parent fields survive: tarif still 450',
    nb(await feeField.inputValue()).startsWith('450'),
    await feeField.inputValue(),
  );
  ok(
    'the parent fields survive: capacité still 14',
    nb(await capacityField.inputValue()).startsWith('14'),
    await capacityField.inputValue(),
  );

  // Validation first: an empty name must not create anything.
  await page.getByTestId('quick-create-subject-create').click();
  await page.waitForTimeout(400);
  ok(
    'an empty name is refused',
    strip(await page.getByTestId('quick-create-subject').innerText()).includes('obligatoire'),
    strip(await page.getByTestId('quick-create-subject').innerText()),
  );
  const beforeSubject = await store(page);
  ok(
    'nothing was created by the invalid submit',
    !(beforeSubject.subjects ?? []).some((row) => row.name === 'Robotique'),
  );

  await page.getByTestId('quick-subject-name').fill('Robotique');
  await page.screenshot({ path: `${SHOTS}/phase12-02-quick-subject.png` });
  await page.getByTestId('quick-create-subject-create').click();
  await page.waitForTimeout(1400);

  ok(
    'the quick-create modal closed',
    (await page.getByTestId('quick-create-subject').count()) === 0,
  );
  const afterSubject = await store(page);
  const newSubject = (afterSubject.subjects ?? []).find((row) => row.name === 'Robotique');
  ok('the subject exists in the store', Boolean(newSubject), afterSubject.subjects?.length);
  ok(
    'the new subject is selected in the parent form',
    strip(await subjectTrigger.innerText()).includes('Robotique'),
    strip(await subjectTrigger.innerText()),
  );

  // ============================================ 3. quick-create a level + teacher ===
  STEP = 'quick-level';
  await openDropdown(page, 'group-level');
  await page.getByTestId('group-level-create').click();
  await page.waitForTimeout(700);
  await page.getByTestId('quick-level-name').fill('Terminale STMG');
  await page.getByTestId('quick-level-category').selectOption('lycee');
  await page.getByTestId('quick-create-level-create').click();
  await page.waitForTimeout(1300);
  const afterLevel = await store(page);
  const newLevel = (afterLevel.levels ?? []).find((row) => row.name === 'Terminale STMG');
  ok('the level is stored with its category', newLevel?.category === 'lycee', newLevel);
  ok(
    'the new level is selected',
    strip(await page.getByTestId('group-level-trigger').innerText()).includes('Terminale STMG'),
    strip(await page.getByTestId('group-level-trigger').innerText()),
  );

  STEP = 'quick-teacher';
  await openDropdown(page, 'group-teacher');
  ok(
    'the teacher dropdown is searchable',
    (await page.getByTestId('group-teacher-search').count()) === 1,
  );
  const teacherOptions = await page.locator('[data-testid^="group-teacher-option-"]').count();
  await page.getByTestId('group-teacher-search').fill('zzz');
  await page.waitForTimeout(400);
  ok('typing filters the options', (await page.locator('[data-testid^="group-teacher-option-"]').count()) === 0);
  ok(
    'the create row stays visible while filtering',
    (await page.getByTestId('group-teacher-create').count()) === 1,
  );
  await page.getByTestId('group-teacher-search').fill('');
  await page.waitForTimeout(400);
  ok(
    'clearing the search restores the options',
    (await page.locator('[data-testid^="group-teacher-option-"]').count()) === teacherOptions,
  );

  await page.getByTestId('group-teacher-create').click();
  await page.waitForTimeout(700);
  await page.getByTestId('quick-teacher-name').fill('Yassine Alami');
  await page.getByTestId('quick-teacher-phone').fill('0612345678');
  await page.getByTestId('quick-teacher-phone').blur();
  await page.waitForTimeout(200);
  ok(
    'the phone is displayed grouped',
    nb(await page.getByTestId('quick-teacher-phone').inputValue()) === '06 12 34 56 78',
    await page.getByTestId('quick-teacher-phone').inputValue(),
  );
  const firstSubjectCheckbox = page.locator('[data-testid^="quick-teacher-subject-"]').first();
  await firstSubjectCheckbox.check();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/phase12-03-quick-teacher.png` });
  await page.getByTestId('quick-create-teacher-create').click();
  await page.waitForTimeout(1400);

  const afterTeacher = await store(page);
  const newTeacher = (afterTeacher.teachers ?? []).find((row) => row.full_name === 'Yassine Alami');
  ok('the teacher exists in the store', Boolean(newTeacher));
  ok('the phone is stored as raw digits', newTeacher?.phone === '0612345678', newTeacher?.phone);
  ok(
    'the teacher creation is audited',
    (afterTeacher.auditLog ?? []).some(
      (entry) => entry.entity_type === 'teacher' && entry.action === 'CREATE',
    ),
  );
  ok(
    'the teacher carries at least one subject',
    Array.isArray(newTeacher?.subject_ids) && newTeacher.subject_ids.length === 1,
    newTeacher?.subject_ids,
  );
  ok(
    'the new teacher is selected in the group form',
    strip(await page.getByTestId('group-teacher-trigger').innerText()).includes('Yassine Alami'),
    strip(await page.getByTestId('group-teacher-trigger').innerText()),
  );

  // ---- saving the group proves the ids went back into the form state.
  STEP = 'save-group';
  await page.getByRole('button', { name: /^Enregistrer$/ }).click();
  await page.waitForTimeout(1600);
  const afterGroup = await store(page);
  const createdGroup = (afterGroup.groups ?? []).find(
    (row) => row.teacher_id === newTeacher?.id && row.capacity === 14,
  );
  ok(
    'the group saved with the teacher created on the fly',
    Boolean(createdGroup),
    (afterGroup.groups ?? []).slice(-1),
  );
  ok(
    'the group saved with the subject created on the fly',
    createdGroup?.subject_id === newSubject?.id,
    { subject_id: createdGroup?.subject_id, expected: newSubject?.id },
  );
  ok('the group saved with the level', createdGroup?.level_id === newLevel?.id);
  ok('the group kept the fee typed before the detour', createdGroup?.monthly_fee_cents === 45000, createdGroup?.monthly_fee_cents);
  ok('the group kept the capacity typed before the detour', createdGroup?.capacity === 14);

  // ============================================= 4. student form: level dropdown ===
  STEP = 'student-level';
  await go(page, '/students');
  await page.locator('button', { hasText: 'Nouvel élève' }).first().click();
  await page.waitForTimeout(1000);
  await page.getByTestId('student-full-name').fill('Hamza Belkacem');
  await openDropdown(page, 'student-level');
  await page.getByTestId('student-level-create').click();
  await page.waitForTimeout(700);
  await page.getByTestId('quick-level-name').fill('CM2 (test)');
  await page.getByTestId('quick-level-category').selectOption('primaire');
  await page.getByTestId('quick-create-level-create').click();
  await page.waitForTimeout(1300);
  ok(
    'the new level is selected in the student form',
    strip(await page.getByTestId('student-level-trigger').innerText()).includes('CM2 (test)'),
    strip(await page.getByTestId('student-level-trigger').innerText()),
  );
  ok(
    'the student name typed before the detour is still there',
    (await page.getByTestId('student-full-name').inputValue()) === 'Hamza Belkacem',
    await page.getByTestId('student-full-name').inputValue(),
  );

  // ---- cancel: closing the quick-create keeps the form and creates nothing.
  STEP = 'cancel';
  await openDropdown(page, 'student-level');
  await page.getByTestId('student-level-create').click();
  await page.waitForTimeout(600);
  await page.getByTestId('quick-create-level').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(600);
  const afterCancel = await store(page);
  ok(
    'Annuler closes the quick-create',
    (await page.getByTestId('quick-create-level').count()) === 0,
  );
  ok(
    'Annuler creates nothing',
    (afterCancel.levels ?? []).length === (await store(page)).levels.length,
  );
  ok(
    'the parent form is untouched by the cancel',
    (await page.getByTestId('student-full-name').inputValue()) === 'Hamza Belkacem',
  );
  await page.locator('[role="dialog"]').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(600);

  // ==================================== 5. teacher form: "+ Nouvelle matière" link ===
  STEP = 'teacher-subjects';
  await go(page, '/teachers');
  await page.getByTestId('teacher-new').click();
  await page.waitForTimeout(1000);
  await page.getByTestId('teacher-subject-create').click();
  await page.waitForTimeout(700);
  ok(
    'the subject quick-create opens from the teacher form',
    (await page.getByTestId('quick-create-subject').count()) === 1,
  );
  await page.getByTestId('quick-subject-name').fill('Espagnol');
  await page.getByTestId('quick-create-subject-create').click();
  await page.waitForTimeout(1300);
  const afterArabic = await store(page);
  const arabic = (afterArabic.subjects ?? []).find((row) => row.name === 'Espagnol');
  ok('the subject was created from the teacher form', Boolean(arabic));
  ok(
    'and it is ticked straight away',
    await page
      .getByTestId(`teacher-subject-${arabic?.id}`)
      .isChecked()
      .catch(() => false),
    arabic?.id,
  );
  await page.locator('[role="dialog"]').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(500);

  // ================================== 6. payment step 1 → create a student ===
  STEP = 'payment-student';
  await go(page, '/payments');
  await page.getByTestId('payments-new').click();
  await page.waitForTimeout(1200);
  await openDropdown(page, 'payment-student');
  ok(
    'step 1 lists students to pay for',
    (await page.locator('[data-testid^="payment-student-option-"]').count()) > 0,
    await page.locator('[data-testid^="payment-student-option-"]').count(),
  );
  ok(
    'the quick-create row is there too',
    (await page.getByTestId('payment-student-create').count()) === 1,
  );
  await page.getByTestId('payment-student-create').click();
  await page.waitForTimeout(700);
  await page.getByTestId('quick-student-name').fill('Salma Ouazzani');
  await page.getByTestId('quick-student-phone').fill('0655443322');
  await page.screenshot({ path: `${SHOTS}/phase12-04-quick-student.png` });
  await page.getByTestId('quick-create-student-create').click();
  await page.waitForTimeout(1800);

  const afterStudent = await store(page);
  const newStudent = (afterStudent.students ?? []).find((row) => row.full_name === 'Salma Ouazzani');
  ok('the student exists in the store', Boolean(newStudent));
  ok('the phone is stored as raw digits', newStudent?.phone === '0655443322', newStudent?.phone);
  ok(
    'the wizard moved on to the new student',
    strip(await page.locator('[role="dialog"]').innerText()).includes('Salma Ouazzani'),
    strip(await page.locator('[role="dialog"]').innerText()).slice(0, 140),
  );
  // Step 2 has no "Annuler" button: Escape closes the wizard (global handler).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  ok('Escape closes the payment wizard', (await page.locator('[role="dialog"]').count()) === 0);

  // ================================== 7. expense category quick-create ===
  STEP = 'expense-category';
  await go(page, '/expenses');
  await page.getByTestId('expense-new').click();
  await page.waitForTimeout(1000);
  await openDropdown(page, 'expense-category');
  await page.getByTestId('expense-category-create').click();
  await page.waitForTimeout(700);
  await page.getByTestId('quick-category-name').fill('Sécurité');
  await page.getByTestId('quick-create-category-create').click();
  await page.waitForTimeout(1300);
  const afterCategory = await store(page);
  ok(
    'the category is appended to the settings list',
    JSON.parse(afterCategory.settings.expense_categories).includes('Sécurité'),
    afterCategory.settings.expense_categories,
  );
  ok(
    'the new category is selected in the expense form',
    strip(await page.getByTestId('expense-category-trigger').innerText()).includes('Sécurité'),
    strip(await page.getByTestId('expense-category-trigger').innerText()),
  );

  // A duplicate is refused, with the modal left open.
  await openDropdown(page, 'expense-category');
  await page.getByTestId('expense-category-create').click();
  await page.waitForTimeout(600);
  await page.getByTestId('quick-category-name').fill('sécurité');
  await page.getByTestId('quick-create-category-create').click();
  await page.waitForTimeout(900);
  ok(
    'a duplicate category is refused',
    strip(await page.getByTestId('quick-create-category').innerText()).includes('existe déjà'),
    strip(await page.getByTestId('quick-create-category').innerText()),
  );
  const categoriesAfterDuplicate = JSON.parse(
    (await store(page)).settings.expense_categories,
  ).filter((entry) => entry.toLowerCase() === 'sécurité').length;
  ok('the duplicate was not added', categoriesAfterDuplicate === 1, categoriesAfterDuplicate);
  await page.getByTestId('quick-create-category').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(500);
  await page.locator('[role="dialog"]').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(500);

  // ================== 8. the enrollment wizard: group + student quick-creates ===
  STEP = 'enrollment-group';
  await go(page, '/groups');
  await page.waitForTimeout(600);
  const firstGroupCard = page.locator('[data-testid^="group-card-"]').first();
  await firstGroupCard.click();
  await page.waitForTimeout(1200);
  await page.locator('button', { hasText: 'Ajouter élève' }).first().click();
  await page.waitForTimeout(1000);
  ok(
    'the student quick-create is offered inside the wizard',
    (await page.getByTestId('enrollment-create-student').count()) === 1,
  );
  await page.getByTestId('enrollment-create-student').click();
  await page.waitForTimeout(700);
  ok(
    'it opens above the wizard (z-60 over z-50)',
    (await page.locator('[data-modal-z="60"]').count()) === 1 &&
      (await page.locator('[data-modal-z="50"]').count()) >= 1,
    await page.locator('[data-modal-z]').evaluateAll((nodes) => nodes.map((n) => n.dataset.modalZ)),
  );
  await page.getByTestId('quick-student-name').fill('Nadia Fassi');
  await page.getByTestId('quick-student-phone').fill('0699887766');
  await page.getByTestId('quick-create-student-create').click();
  await page.waitForTimeout(1600);
  ok(
    'the new student is selected in the wizard',
    strip(await page.locator('[role="dialog"]').last().innerText()).includes('Nadia Fassi'),
    strip(await page.locator('[role="dialog"]').last().innerText()).slice(0, 160),
  );
  await page.locator('[role="dialog"]').last().getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  STEP = 'enrollment-wizard-group';
  await go(page, '/students');
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1400);
  await page.getByRole('tab', { name: /Inscriptions/ }).click();
  await page.waitForTimeout(900);
  await page.locator('button', { hasText: 'Inscrire à un groupe' }).first().click();
  await page.waitForTimeout(1200);
  ok(
    'the group quick-create is offered in the wizard',
    (await page.getByTestId('enrollment-create-group').count()) === 1,
  );
  await page.getByTestId('enrollment-create-group').click();
  await page.waitForTimeout(900);
  ok(
    'the group wizard opens at z-60',
    (await page.locator('[data-modal-z="60"]').count()) === 1,
  );

  // ---- one level of nesting: subject created from inside the group wizard.
  await openDropdown(page, 'quick-group-subject');
  await page.getByTestId('quick-group-subject-create').click();
  await page.waitForTimeout(700);
  ok(
    'the nested quick-create stacks one level deeper (z-70)',
    (await page.locator('[data-modal-z="70"]').count()) === 1,
    await page.locator('[data-modal-z]').evaluateAll((nodes) => nodes.map((n) => n.dataset.modalZ)),
  );
  ok(
    'the nested form has no further create row (no infinite nesting)',
    (await page.getByTestId('quick-subject-name').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/phase12-05-nested.png` });
  await page.getByTestId('quick-subject-name').fill('Coréen');
  await page.getByTestId('quick-create-subject-create').click();
  await page.waitForTimeout(1300);
  ok(
    'the nested modal closed back to the group wizard',
    (await page.locator('[data-modal-z="70"]').count()) === 0,
  );
  ok(
    'the subject created two levels deep is selected',
    strip(await page.getByTestId('quick-group-subject-trigger').innerText()).includes('Coréen'),
    strip(await page.getByTestId('quick-group-subject-trigger').innerText()),
  );

  // ---- step 2 and creation
  await openDropdown(page, 'quick-group-level');
  const levelOptions = page.locator('[data-testid^="quick-group-level-option-"]');
  await levelOptions.first().click();
  await page.waitForTimeout(300);
  await page.getByTestId('quick-group-next').click();
  await page.waitForTimeout(500);
  ok(
    'step 2 asks for the schedule and the fee',
    (await page.getByTestId('quick-group-fee').count()) === 1 &&
      (await page.getByTestId('quick-group-capacity').count()) === 1,
  );
  const quickFee = page.getByTestId('quick-group-fee');
  await quickFee.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('350');
  await page.keyboard.press('Tab');
  const quickCapacity = page.getByTestId('quick-group-capacity');
  await quickCapacity.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('12');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/phase12-06-quick-group.png` });
  await page.getByTestId('quick-group-create').click();
  await page.waitForTimeout(2000);

  const sessions = await store(page);
  const wizardGroup = (sessions.groups ?? []).find((row) => row.capacity === 12 && row.monthly_fee_cents === 35000);
  ok('the group was created from the wizard', Boolean(wizardGroup), (sessions.groups ?? []).length);
  ok(
    'it used the subject created two levels deep',
    (sessions.subjects ?? []).find((row) => row.id === wizardGroup?.subject_id)?.name === 'Coréen',
    wizardGroup?.subject_id,
  );
  const wizardText = strip(await page.locator('[role="dialog"]').last().innerText());
  ok(
    'the new group is ticked in the wizard',
    wizardText.includes('Coréen'),
    wizardText.slice(0, 200),
  );
  await page.locator('[role="dialog"]').last().getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ====================================== 9. empty options still show the create row
  STEP = 'empty-options';
  await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    raw.teachers = [];
    localStorage.setItem(key, JSON.stringify(raw));
  }, STORE_KEY);
  await page.reload();
  await page.waitForTimeout(1500);
  await signIn(page);
  await go(page, '/groups');
  await page.locator('button', { hasText: 'Nouveau groupe' }).first().click();
  await page.waitForTimeout(1000);
  await openDropdown(page, 'group-teacher');
  ok(
    'an empty list says so',
    (await page.getByTestId('group-teacher-empty').count()) === 1,
    await page.getByTestId('group-teacher-empty').innerText().catch(() => '—'),
  );
  ok(
    'and still offers "+ Nouveau…"',
    (await page.getByTestId('group-teacher-create').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/phase12-07-empty.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"]').getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(500);

  // ================================================ 10. Arabic / RTL parity ===
  STEP = 'arabic';
  await page.locator('button', { hasText: 'AR' }).first().click();
  await page.waitForTimeout(900);
  await go(page, '/students');
  await page.locator('button', { hasText: 'تلميذ جديد' }).first().click();
  await page.waitForTimeout(1200);
  await openDropdown(page, 'student-level');
  ok(
    'the create row is translated',
    strip(await page.getByTestId('student-level-create').innerText()).includes('جديد'),
    strip(await page.getByTestId('student-level-create').innerText()),
  );
  ok('the document is RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  const createBox = await page.getByTestId('student-level-create').evaluate((node) => {
    const icon = node.querySelector('svg');
    const label = node.querySelector('span');
    return {
      iconX: icon ? icon.getBoundingClientRect().x : -1,
      labelX: label ? label.getBoundingClientRect().x : -1,
    };
  });
  ok(
    'in RTL the plus icon sits on the right of its label',
    createBox.iconX > createBox.labelX,
    createBox,
  );
  await page.screenshot({ path: `${SHOTS}/phase12-08-arabic.png` });
  await page.getByTestId('student-level-create').click();
  await page.waitForTimeout(800);
  ok(
    'the quick-create modal is translated',
    strip(await page.getByTestId('quick-create-level').innerText()).includes('مستوى جديد'),
    strip(await page.getByTestId('quick-create-level').innerText()).slice(0, 80),
  );
  await page.screenshot({ path: `${SHOTS}/phase12-09-arabic-modal.png` });
  await page.getByTestId('quick-create-level').getByRole('button', { name: /إلغاء/ }).click();
  await page.waitForTimeout(500);
} catch (error) {
  failures.push(`[${STEP}] crashed: ${String(error).split('\n')[0]}`);
  console.error(`\n!! step ${STEP} crashed:`, error);
}

await browser.close();

const IGNORED = [/Failed to load resource/i, /favicon/i];
const realConsole = consoleIssues.filter((line) => !IGNORED.some((re) => re.test(line)));

console.log(`\n=== Phase 12 browser suite: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\nFAILURES');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
if (realConsole.length > 0) {
  console.log('\nCONSOLE ISSUES');
  for (const issue of realConsole) console.log(`  ! ${issue}`);
}
process.exit(failures.length === 0 && realConsole.length === 0 ? 0 : 1);
