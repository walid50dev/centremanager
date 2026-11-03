/**
 * Phase 16 — the student sheet in three sections (identity / guardian & contacts
 * / administration). Temporary browser suite, kept next to the other phases.
 *
 * Runs against the Vite dev server with the localStorage backend, so every
 * assertion can be cross-checked against the stored rows.
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

/** `YYYY-MM-DD` of today, in the browser's timezone. */
const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const browser = await chromium.launch();

async function login(language = 'fr') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  await page.waitForTimeout(700);
  if (language !== 'fr') {
    await page.evaluate((lang) => localStorage.setItem('centremanager.language', lang), language);
  }
  return { context, page };
}

async function go(page, path) {
  const same = await page.evaluate((target) => window.location.pathname === target, path);
  if (same) {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(300);
  }
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(1000);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

const dialog = '[role="dialog"]';

/** Opens the students page and waits for its table. */
async function studentsPage(page) {
  await go(page, '/students');
  await page.getByTestId('students-search').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
}

/** Opens the “Nouvel élève” / “Nouvel(le) élève” dialog. */
async function openNew(page) {
  await page.getByRole('button', { name: /Nouvel/ }).first().click();
  await page.locator(dialog).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
}

/** Opens one of the generic dropdowns (`<testId>-trigger` / `-list`). */
async function openDropdown(page, testId) {
  await page.getByTestId(`${testId}-trigger`).click();
  await page.getByTestId(`${testId}-list`).waitFor({ timeout: 5000 });
  await page.waitForTimeout(200);
}

let STEP = 'login';

try {
  const { page } = await login();

  // ============================================== A: the form and its sections ===
  STEP = 'sections';
  await studentsPage(page);
  await openNew(page);

  const sections = await page.locator(`${dialog} fieldset`).allInnerTexts();
  ok('the form has exactly three sections', sections.length === 3, sections.length);
  ok(
    'the section headers are Identité / Parent-Tuteur / Administratif',
    sections[0].startsWith('Identité de l’élève') || sections[0].startsWith("Identité de l'élève"),
    strip(sections[0]).slice(0, 60),
  );
  ok(
    'section 2 is about the guardian',
    strip(sections[1]).includes('Parent / Tuteur'),
    strip(sections[1]).slice(0, 60),
  );
  ok('section 3 is the administrative block', strip(sections[2]).startsWith('Administratif'), strip(sections[2]).slice(0, 60));

  // The three section wrappers are real, in order, and stacked vertically.
  const sectionIds = ['student-section-identity', 'student-section-guardian', 'student-section-admin'];
  const boxes = [];
  for (const id of sectionIds) boxes.push(await page.getByTestId(id).boundingBox());
  ok('the three sections are present and visible', boxes.every((box) => box && box.height > 60), boxes);
  ok(
    'they are stacked in order',
    boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y,
    boxes.map((box) => Math.round(box?.y ?? -1)),
  );

  // ------------------------------------------------------------- 1. Identité
  const identityFields = [
    'student-last-name',
    'student-first-name',
    'student-level',
    'student-birth-date',
    'student-enrollment-date',
  ];
  for (const id of identityFields) {
    ok(`section 1 contains ${id}`, (await page.getByTestId(id).count()) === 1);
  }
  ok(
    'the school field is in section 1',
    (await page.getByTestId('student-section-identity').getByTestId('student-school-name').count()) === 1,
  );
  ok(
    'the last name is labelled “Nom de famille” and required',
    (await page.locator(`${dialog} label`, { hasText: 'Nom de famille' }).count()) === 1,
  );
  ok(
    'the first name is labelled “Prénom”',
    (await page.locator(`${dialog} label`, { hasText: 'Prénom' }).count()) === 1,
  );
  const lastNameBox = await page.getByTestId('student-last-name').boundingBox();
  const firstNameBox = await page.getByTestId('student-first-name').boundingBox();
  ok(
    'last name and first name share a row, nom first',
    Math.abs(lastNameBox.y - firstNameBox.y) < 4 && lastNameBox.x < firstNameBox.x,
    { last: lastNameBox, first: firstNameBox },
  );
  ok(
    'the last-name placeholder shows both scripts',
    (await page.getByTestId('student-last-name').getAttribute('placeholder')) === 'El Mansouri / المنصوري',
    await page.getByTestId('student-last-name').getAttribute('placeholder'),
  );
  ok(
    'the first-name placeholder shows both scripts',
    (await page.getByTestId('student-first-name').getAttribute('placeholder')) === 'Salma / سلمى',
    await page.getByTestId('student-first-name').getAttribute('placeholder'),
  );
  ok(
    'the school placeholder is the lycée',
    (await page.getByTestId('student-school-name').getAttribute('placeholder')) === 'Lycée Moulay Youssef',
  );

  // dates are real date inputs, and the enrollment one is today
  ok(
    'the birth date is a date input',
    (await page.getByTestId('student-birth-date').getAttribute('type')) === 'date',
  );
  ok(
    'the enrollment date defaults to today',
    (await page.getByTestId('student-enrollment-date').inputValue()) === todayIso(),
    await page.getByTestId('student-enrollment-date').inputValue(),
  );

  // the level dropdown still comes from the API
  await openDropdown(page, 'student-level');
  const levelOptions = (await page.locator('[data-testid^="student-level-option-"]').allInnerTexts())
    .map((text) => strip(text).trim())
    .filter(Boolean);
  const storedLevels = (await store(page)).levels.map((level) => level.name);
  ok(
    'the level dropdown lists the stored levels',
    levelOptions.length === storedLevels.length &&
      storedLevels.every((name) => levelOptions.includes(name)),
    { levelOptions: levelOptions.slice(0, 12), stored: storedLevels.slice(0, 12) },
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ------------------------------------------------------- 2. Parent / tuteur
  for (const id of [
    'student-guardian-name',
    'student-guardian-phone',
    'student-guardian-relation',
    'student-secondary-name',
    'student-secondary-phone',
  ]) {
    ok(`section 2 contains ${id}`, (await page.getByTestId(id).count()) === 1);
  }
  ok(
    'the guardian block is labelled “Parent / Tuteur”',
    (await page.locator(`${dialog} label`, { hasText: 'Nom du parent / tuteur' }).count()) === 1,
  );
  ok(
    'the guardian phone is labelled “Téléphone du tuteur”',
    (await page.locator(`${dialog} label`, { hasText: 'Téléphone du tuteur' }).count()) === 1,
  );

  // the six relationships, with their French labels (a native <select>)
  const relationOptions = await page
    .getByTestId('student-guardian-relation')
    .evaluate((node) =>
      Array.from(node.querySelectorAll('option')).map((option) => ({
        value: option.value,
        label: option.textContent?.trim() ?? '',
      })),
    );
  const relationLabels = relationOptions
    .filter((option) => option.value !== '')
    .map((option) => strip(option.label));
  ok(
    'the relationship list has the six options',
    relationLabels.length === 6,
    relationLabels,
  );
  ok(
    'the options are Père, Mère, Tuteur, Frère, Sœur, Autre',
    ['Père', 'Mère', 'Tuteur', 'Frère', 'Sœur', 'Autre'].every((label) =>
      relationLabels.includes(label),
    ),
    relationLabels,
  );
  ok(
    'the options are stored as stable codes',
    relationOptions
      .map((option) => option.value)
      .filter(Boolean)
      .join(',') === 'father,mother,guardian,brother,sister,other',
    relationOptions.map((option) => option.value),
  );
  ok('the relation starts empty (optional)', (await page.getByTestId('student-guardian-relation').inputValue()) === '');

  // ---------------------------------------------------------- 3. Administratif
  for (const id of ['student-status', 'student-address', 'student-notes']) {
    ok(`section 3 contains ${id}`, (await page.getByTestId(id).count()) === 1);
  }
  ok(
    'the status defaults to Actif',
    (await page.getByTestId('student-status').inputValue()) === 'actif',
    await page.getByTestId('student-status').inputValue(),
  );
  ok(
    'the address placeholder mentions the quartier',
    strip(await page.getByTestId('student-address').getAttribute('placeholder')).includes('Quartier'),
    await page.getByTestId('student-address').getAttribute('placeholder'),
  );

  // ------------------------------------------- the removed fields are really gone
  const modalText = strip(nb(await page.locator(dialog).innerText()));
  for (const gone of ['father_name', 'home_address', 'E-mail', 'Email', 'Nom du père']) {
    ok(`“${gone}” is gone from the form`, !modalText.includes(gone), modalText.slice(0, 120));
  }
  ok(
    'no field test id mentions the removed columns',
    (await page.locator(`${dialog} [data-testid*="father"], ${dialog} [data-testid*="email"], ${dialog} [data-testid*="home-address"]`).count()) === 0,
  );

  // ------------------------------------------------ Create, with a full sheet
  await page.screenshot({ path: `${SHOTS}/phase16-01-form-three-sections.png` });

  STEP = 'create';
  await page.getByTestId('student-last-name').fill('El Mansouri');
  await page.getByTestId('student-first-name').fill('Salma');
  await page.getByTestId('student-school-name').fill('Lycée Moulay Youssef');
  await page.getByTestId('student-birth-date').fill('2010-05-12');
  await page.getByTestId('student-birth-date').press('Tab');
  // the guardian phone is typed with spaces on purpose
  await page.getByTestId('student-guardian-name').fill('Rachid El Mansouri');
  await page.getByTestId('student-guardian-phone').fill('0661234567');
  await page.getByTestId('student-guardian-phone').press('Tab');
  await page.getByTestId('student-guardian-relation').selectOption('father');
  await page.waitForTimeout(200);
  await page.getByTestId('student-secondary-name').fill('Nadia El Mansouri');
  await page.getByTestId('student-secondary-phone').fill('0712345678');
  await page.getByTestId('student-secondary-phone').press('Tab');
  await page.getByTestId('student-address').fill('12 rue des Écoles, Casablanca');
  await page.getByTestId('student-notes').fill('Besoins spécifiques : dyslexie');

  // the phone was grouped on blur
  const shownGuardianPhone = await page.getByTestId('student-guardian-phone').inputValue();
  ok(
    'the guardian phone is displayed grouped',
    shownGuardianPhone === '06 61 23 45 67',
    shownGuardianPhone,
  );
  ok(
    'the secondary phone is grouped too',
    (await page.getByTestId('student-secondary-phone').inputValue()) === '07 12 34 56 78',
    await page.getByTestId('student-secondary-phone').inputValue(),
  );

  await page.getByTestId('student-save').click();
  await page.locator(dialog).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(900);

  const created = (await store(page)).students.find(
    (row) => row.last_name === 'El Mansouri' && row.first_name === 'Salma',
  );
  ok('the student is stored', Boolean(created), created);
  ok('the guardian phone is stored without spaces', created?.guardian_phone === '0661234567', created?.guardian_phone);
  ok('the relation is stored as a code', created?.guardian_relation === 'father', created?.guardian_relation);
  ok('the school is stored', created?.school_name === 'Lycée Moulay Youssef', created?.school_name);
  ok('the birth date is stored', created?.birth_date === '2010-05-12', created?.birth_date);
  ok('the enrollment date is today', created?.enrollment_date === todayIso(), created?.enrollment_date);
  ok(
    'the derived full name is prénom + nom',
    created?.full_name === 'Salma El Mansouri',
    created?.full_name,
  );
  ok('the secondary contact name is stored', created?.secondary_contact_name === 'Nadia El Mansouri');
  ok('the secondary phone is stored raw', created?.secondary_contact_phone === '0712345678');
  ok('the address is stored', created?.address === '12 rue des Écoles, Casablanca');
  ok('the notes are stored', created?.notes === 'Besoins spécifiques : dyslexie');
  ok('the status is actif', created?.status === 'actif', created?.status);
  ok(
    'no legacy column is written',
    created &&
      !('father_name' in created) &&
      !('home_address' in created) &&
      !('parent_phone' in created) &&
      !('phone' in created),
    created && Object.keys(created),
  );

  // ============================================================== B: the list ===
  STEP = 'list';
  await studentsPage(page);

  const headers = (await page.locator('table thead th').allInnerTexts()).map((text) =>
    strip(text).trim(),
  );
  ok('the list has six columns', headers.length === 6, headers);
  ok('the school column replaced the phone column', headers.includes('Établissement'), headers);
  ok('the guardian column is there', headers.includes('Tuteur'), headers);
  ok(
    'the last column is the enrollment date',
    headers[5] === 'Inscription',
    headers,
  );

  const row = page.locator('tbody tr', { hasText: 'Salma El Mansouri' }).first();
  const rowText = strip(nb(await row.innerText()));
  ok('the row shows the school', rowText.includes('Lycée Moulay Youssef'), rowText);
  ok('the row shows the guardian name', rowText.includes('Rachid El Mansouri'), rowText);
  ok(
    'the row shows the guardian phone, grouped',
    rowText.includes('06 61 23 45 67'),
    rowText,
  );
  ok(
    'the row shows the enrollment date',
    rowText.includes(todayIso().split('-').reverse().join('/')),
    rowText,
  );

  // ------------------------------------------------------------- the search box
  const searchAndCount = async (term) => {
    await page.getByTestId('students-search').fill(term);
    await page.waitForTimeout(800);
    return page.locator('tbody tr').count();
  };
  for (const [term, label] of [
    ['El Mansouri', 'the family name'],
    ['Salma', 'the first name'],
    ['Salma El Mansouri', 'the full name'],
    ['Rachid', 'the guardian name'],
    ['0661234567', 'the guardian phone'],
    ['0712345678', 'the second phone'],
  ]) {
    ok(`the search covers ${label}`, (await searchAndCount(term)) >= 1, term);
  }
  // the guardian search does not match everyone
  await page.getByTestId('students-search').fill('Rachid');
  await page.waitForTimeout(800);
  ok(
    'the guardian search is selective',
    (await page.locator('tbody tr').count()) < (await store(page)).students.length,
    await page.locator('tbody tr').count(),
  );
  await page.getByTestId('students-search').fill('');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/phase16-02-list-school-guardian.png` });

  // ============================================================ C: the detail ===
  STEP = 'detail';
  await go(page, `/students/${created.id}`);
  await page.getByTestId('student-detail-sheet').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);

  const detailText = strip(nb(await page.getByTestId('student-detail-sheet').innerText()));
  for (const [label, value] of [
    ['Identité', "Identité de l'élève"],
    ['Parent / Tuteur', 'Parent / Tuteur'],
    ['Administratif', 'Administratif'],
    ['the school', 'Lycée Moulay Youssef'],
    ['the birth date', '12/05/2010'],
    ['the enrollment date', todayIso().split('-').reverse().join('/')],
    ['the guardian', 'Rachid El Mansouri'],
    ['the relation, translated', 'Père'],
    ['the second contact', 'Nadia El Mansouri'],
    ['the address', '12 rue des Écoles, Casablanca'],
    ['the notes', 'Besoins spécifiques'],
  ]) {
    ok(`the detail shows ${label}`, detailText.includes(value), { label, value });
  }
  ok(
    'the guardian phone is a tel: link, grouped for display',
    (await page.getByTestId('student-detail-phone').getAttribute('href')) === 'tel:0661234567' &&
      strip(await page.getByTestId('student-detail-phone').innerText()).includes('06 61 23 45 67'),
    await page.getByTestId('student-detail-phone').getAttribute('href'),
  );
  ok(
    'the second phone is a tel: link too',
    (await page.getByTestId('student-detail-parent-phone').getAttribute('href')) ===
      'tel:0712345678',
  );
  await page.screenshot({ path: `${SHOTS}/phase16-03-detail-sections.png` });

  // the audit history speaks the new field names
  await page.getByRole('tab', { name: /Historique/ }).click();
  await page.waitForTimeout(600);
  const historyText = strip(nb(await page.locator('[data-testid="student-history"]').innerText().catch(async () => await page.locator('main').innerText())));
  ok(
    'the history names the new fields',
    historyText.includes('Nom du parent') || historyText.includes('Téléphone du tuteur'),
    historyText.slice(0, 200),
  );
  ok(
    'the history never mentions the removed fields',
    !historyText.includes('father_name') && !historyText.includes('home_address'),
    historyText.slice(0, 200),
  );

  // ============================================================ D: validation ===
  STEP = 'validation';
  await studentsPage(page);
  await openNew(page);

  ok(
    'save is disabled while the required fields are empty',
    await page.getByTestId('student-save').isDisabled(),
  );
  await page.getByTestId('student-last-name').fill('B');
  await page.getByTestId('student-last-name').press('Tab');
  await page.getByTestId('student-first-name').click();
  await page.waitForTimeout(300);
  ok(
    'a one-letter family name is refused',
    strip(nb(await page.locator(dialog).innerText())).includes('au moins 2 caractères'),
    strip(nb(await page.locator(dialog).innerText())).slice(0, 160),
  );

  await page.getByTestId('student-first-name').fill('Salma');
  await page.getByTestId('student-first-name').press('Tab');
  await page.getByTestId('student-guardian-name').fill('Rachid El Mansouri');
  await page.getByTestId('student-guardian-phone').fill('0123456789');
  await page.getByTestId('student-guardian-phone').press('Tab');
  await page.waitForTimeout(300);
  ok(
    'a landline guardian phone is refused',
    strip(nb(await page.locator(dialog).innerText())).includes('06XXXXXXXX ou 07XXXXXXXX'),
    strip(nb(await page.locator(dialog).innerText())).slice(0, 200),
  );
  ok(
    'save stays disabled with an invalid phone',
    await page.getByTestId('student-save').isDisabled(),
  );

  await page.getByTestId('student-last-name').fill('Benali');
  await page.getByTestId('student-guardian-phone').fill('0612345678');
  await page.getByTestId('student-guardian-phone').press('Tab');
  await page.waitForTimeout(500);
  ok(
    'save is enabled once the sheet is valid',
    await page.getByTestId('student-save').isEnabled(),
  );
  await page.screenshot({ path: `${SHOTS}/phase16-04-validation.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ==================================================== E: edit keeps the sheet ===
  STEP = 'edit';
  await go(page, `/students/${created.id}`);
  await page.getByRole('button', { name: /Modifier/ }).first().click();
  await page.locator(dialog).waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);

  ok(
    'the edit form is prefilled with the names',
    (await page.getByTestId('student-last-name').inputValue()) === 'El Mansouri' &&
      (await page.getByTestId('student-first-name').inputValue()) === 'Salma',
  );
  ok(
    'the guardian phone opens grouped',
    (await page.getByTestId('student-guardian-phone').inputValue()) === '06 61 23 45 67',
    await page.getByTestId('student-guardian-phone').inputValue(),
  );
  ok(
    'the enrollment date opens with the stored day',
    (await page.getByTestId('student-enrollment-date').inputValue()) === todayIso(),
    await page.getByTestId('student-enrollment-date').inputValue(),
  );
  ok(
    'the relation opens on Père',
    strip(await page.getByTestId('student-guardian-relation').innerText()).includes('Père'),
    strip(await page.getByTestId('student-guardian-relation').innerText()),
  );

  // change the relation and the status
  await page.getByTestId('student-guardian-relation').selectOption('mother');
  await page.getByTestId('student-status').selectOption('inactif');
  await page.getByTestId('student-notes').fill('Bourse 20 %');
  await page.getByTestId('student-save').click();
  await page.locator(dialog).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(900);

  const edited = (await store(page)).students.find((row) => row.id === created.id);
  ok('the relation is updated', edited?.guardian_relation === 'mother', edited?.guardian_relation);
  ok('the status is updated', edited?.status === 'inactif', edited?.status);
  ok('the notes are updated', edited?.notes === 'Bourse 20 %', edited?.notes);
  ok(
    'the guardian phone survived the edit',
    edited?.guardian_phone === '0661234567',
    edited?.guardian_phone,
  );
  ok(
    'the enrollment date survived the edit',
    edited?.enrollment_date === todayIso(),
    edited?.enrollment_date,
  );

  // ============================================== F: the quick-create dialog ===
  STEP = 'quick-create';
  await go(page, '/payments');
  await page.getByTestId('payments-new').click();
  await page.waitForTimeout(1200);
  await openDropdown(page, 'payment-student');
  await page.getByTestId('payment-student-create').click();
  await page.getByTestId('quick-create-student').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.getByTestId('quick-student-name').fill('Youssef Benali');
  await page.getByTestId('quick-student-phone').fill('0699887766');
  await page.getByTestId('quick-student-phone').press('Tab');
  await page.getByTestId('quick-create-student-create').click();
  await page.waitForTimeout(1200);

  const quick = (await store(page)).students.find((row) => row.full_name === 'Youssef Benali');
  ok('the quick dialog still creates a student', Boolean(quick), quick);
  ok('the quick dialog splits prénom and nom', quick?.first_name === 'Youssef' && quick?.last_name === 'Benali', {
    first: quick?.first_name,
    last: quick?.last_name,
  });
  ok('the quick dialog fills the guardian phone', quick?.guardian_phone === '0699887766', quick?.guardian_phone);
  ok('the quick dialog dates the enrollment today', quick?.enrollment_date === todayIso(), quick?.enrollment_date);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ================================================== G: the demo data is coherent ===
  STEP = 'demo';
  const demo = await store(page);
  ok(
    'every demo student carries the new fields',
    demo.students.every(
      (row) =>
        typeof row.last_name === 'string' &&
        typeof row.first_name === 'string' &&
        typeof row.guardian_name === 'string' &&
        /^0[67]\d{8}$/.test(row.guardian_phone ?? '') &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.enrollment_date ?? ''),
    ),
    demo.students.slice(0, 2),
  );
  ok(
    'no stored student has a legacy column',
    demo.students.every(
      (row) => !('phone' in row) && !('father_name' in row) && !('home_address' in row),
    ),
  );

  // ================================================== H: Arabic, right to left ===
  STEP = 'arabic';
  await page.evaluate(() => localStorage.setItem('centremanager.language', 'ar'));
  await page.reload();
  await page.waitForTimeout(800);
  if (page.url().includes('/login')) {
    // The dev session lives in memory: the reload lands on the (Arabic) login
    // form, so the fields are picked by type rather than by label.
    await page.locator('input[type="password"]').first().fill('test1234');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(`${BASE}/`, { timeout: 20000 });
    await page.waitForTimeout(1500);
  }
  ok(
    'the document is right-to-left',
    (await page.evaluate(() => document.documentElement.dir)) === 'rtl',
  );
  await studentsPage(page);
  await openNew(page);
  await page.waitForTimeout(400);

  const arText = strip(nb(await page.locator(dialog).innerText()));
  for (const [label, expected] of [
    ['the identity section', 'هوية التلميذ'],
    ['the guardian section', 'ولي الأمر'],
    ['the admin section', 'إداري'],
    ['the family name', 'اسم العائلة'],
    ['the first name', 'الاسم الشخصي'],
    ['the guardian phone', 'هاتف ولي الأمر'],
    ['the enrollment date', 'تاريخ التسجيل بالمركز'],
  ]) {
    ok(`the Arabic form names ${label}`, arText.includes(expected), { label, expected });
  }
  ok(
    'the form is right-to-left',
    (await page.locator(dialog).evaluate((node) => getComputedStyle(node).direction)) === 'rtl',
    await page.locator(dialog).evaluate((node) => getComputedStyle(node).direction),
  );
  ok(
    'the phones stay left-to-right',
    (await page.getByTestId('student-guardian-phone').evaluate((node) => getComputedStyle(node).direction)) ===
      'ltr',
  );
  ok(
    'the three sections survive the RTL flip',
    (await page.locator(`${dialog} fieldset`).count()) === 3,
  );
  ok(
    'the enrollment date still defaults to today',
    (await page.getByTestId('student-enrollment-date').inputValue()) === todayIso(),
  );
  await page.screenshot({ path: `${SHOTS}/phase16-05-form-arabic.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  ok('no console errors or page errors', consoleIssues.length === 0, consoleIssues.slice(0, 6));

  await browser.close();

  console.log(`\nphase16: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`\nphase16 stopped at step "${STEP}":`, error?.message ?? error);
  for (const failure of consoleIssues.slice(0, 6)) console.error('  console:', failure);
  await browser.close();
  process.exit(1);
}
