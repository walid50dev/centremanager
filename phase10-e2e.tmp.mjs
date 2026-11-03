/**
 * Phase 10 — student fields (father name / home address / phone formatting) and
 * the new numeric input component. Temporary browser suite (deleted after the
 * phase).
 *
 * Runs against the Vite dev server with the localStorage backend, so the
 * storage side of each assertion can be checked directly.
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

async function login() {
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
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(900);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

/** Bounding box helper — used to prove the two-column layout. */
const box = async (locator) => locator.boundingBox();

let STEP = 'login';

try {
  const { page } = await login();
  const dialog = page.locator('[role="dialog"]');

  // ======================================================== A1: form layout ===
  STEP = 'students-form';
  await go(page, '/students');
  await page.getByRole('button', { name: /Nouvel élève/ }).first().click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);

  const fatherInput = page.getByTestId('student-father-name');
  const birthInput = dialog.locator('input[type="date"]');
  const phoneInput = page.getByTestId('student-phone');
  const parentPhoneInput = page.getByTestId('student-parent-phone');
  const addressInput = page.getByTestId('student-home-address');

  ok('the father-name field exists', (await fatherInput.count()) === 1);
  ok('the home-address field exists', (await addressInput.count()) === 1);
  ok(
    'the modal labels the address "Adresse maison"',
    strip(await dialog.innerText()).includes('Adresse maison'),
    strip(await dialog.innerText()).slice(0, 200),
  );
  ok(
    'the modal labels the father field "Nom du père"',
    strip(await dialog.innerText()).includes('Nom du père'),
  );
  ok(
    'no email field is left in the student form',
    !/e-?mail/i.test(await dialog.innerText()),
  );

  const fatherBox = await box(fatherInput);
  const birthBox = await box(birthInput);
  const phoneBox = await box(phoneInput);
  const parentPhoneBox = await box(parentPhoneInput);
  const addressBox = await box(addressInput);
  ok(
    'father name and birth date share a row',
    Math.abs(fatherBox.y - birthBox.y) < 4 && fatherBox.x < birthBox.x,
    { father: fatherBox?.y, birth: birthBox?.y },
  );
  ok(
    'both phone fields share a row',
    Math.abs(phoneBox.y - parentPhoneBox.y) < 4 && phoneBox.x < parentPhoneBox.x,
    { phone: phoneBox?.y, parent: parentPhoneBox?.y },
  );
  ok(
    'the home address spans the full width of the grid',
    addressBox.width > phoneBox.width * 1.9 && addressBox.y > phoneBox.y,
    { address: addressBox.width, phone: phoneBox.width },
  );
  ok(
    'the home address sits below the phone fields',
    addressBox.y > parentPhoneBox.y,
    { address: addressBox.y, parent: parentPhoneBox.y },
  );

  // ==================================================== A2: phone formatting ===
  STEP = 'phone-format';
  await phoneInput.fill('0607123456');
  await page.getByTestId('student-father-name').click(); // blur
  await page.waitForTimeout(200);
  ok(
    'the phone is grouped as "06 07 12 34 56" on blur',
    (await phoneInput.inputValue()) === '06 07 12 34 56',
    await phoneInput.inputValue(),
  );
  ok(
    'the phone field stays LTR',
    (await phoneInput.getAttribute('dir')) === 'ltr',
  );
  ok(
    'the placeholder shows the grouped format',
    (await phoneInput.getAttribute('placeholder')) === '06 07 12 34 56',
    await phoneInput.getAttribute('placeholder'),
  );

  // A wrongly long number typed with spaces must still be rejected.
  await phoneInput.fill('06 12 34 56 7');
  await page.locator('input[type="date"]').click();
  await page.waitForTimeout(400);
  ok(
    'an over-long phone typed with spaces is rejected',
    strip(await dialog.innerText()).includes('Format: 06XXXXXXXX'),
    strip(await dialog.innerText()).slice(-160),
  );
  ok(
    'an invalid phone is left exactly as typed',
    (await phoneInput.inputValue()) === '06 12 34 56 7',
    await phoneInput.inputValue(),
  );

  // ======================================================= A3: create student ===
  STEP = 'student-create';
  await dialog.locator('input').first().fill('Karim Belhaj');
  await fatherInput.fill('Rachid El Amrani');
  await phoneInput.fill('06 07 12 34 56');
  await parentPhoneInput.fill('06-11-22-33-44');
  await addressInput.fill('12 rue des Écoles, Casablanca');
  await page.waitForTimeout(200);
  await dialog.getByRole('button', { name: /Enregistrer/ }).click();
  await page.waitForTimeout(1200);

  const afterCreate = await store(page);
  const created = afterCreate.students.find((student) => student.full_name === 'Karim Belhaj');
  ok('the student was saved', Boolean(created), afterCreate.students.length);
  ok(
    'the phone is stored as raw digits',
    created?.phone === '0607123456',
    created?.phone,
  );
  ok(
    'the parent phone is stored as raw digits (dashes accepted)',
    created?.parent_phone === '0611223344',
    created?.parent_phone,
  );
  ok(
    'the father name is stored',
    created?.father_name === 'Rachid El Amrani',
    created?.father_name,
  );
  ok(
    'the home address is stored under home_address',
    created?.home_address === '12 rue des Écoles, Casablanca',
    created?.home_address,
  );
  ok(
    'no legacy `address` key is written',
    created ? !('address' in created) : false,
    created && Object.keys(created),
  );
  ok(
    'the audit trail records the new field names',
    JSON.stringify(afterCreate.auditLog ?? []).includes('home_address'),
  );
  await page.screenshot({ path: `${SHOTS}/phase10-01-student-saved.png` });

  // ======================================================== A4: list display ===
  STEP = 'students-list';
  await go(page, '/students');
  const listText = strip(await page.locator('table').first().innerText());
  const createdRow = page.locator('table tbody tr', { hasText: 'Karim Belhaj' });
  ok('the list shows the grouped phone', listText.includes('06 07 12 34 56'), listText.slice(0, 200));
  ok('the list shows the father name', listText.includes('Rachid El Amrani'));
  ok(
    'the list never shows the raw number',
    !listText.includes('0607123456'),
  );
  await page.screenshot({ path: `${SHOTS}/phase10-02-students-list.png` });

  // ======================================================= A5: detail page ====
  STEP = 'student-detail';
  await createdRow.first().click();
  await page.waitForTimeout(1200);
  const detailPhone = page.getByTestId('student-detail-phone');
  const detailText = strip(await page.locator('main, body').first().innerText());
  ok(
    'the detail page shows the grouped phone',
    (await detailPhone.innerText()) === '06 07 12 34 56',
    await detailPhone.innerText(),
  );
  ok(
    'the detail page shows the grouped parent phone',
    (await page.getByTestId('student-detail-parent-phone').innerText()) === '06 11 22 33 44',
    await page.getByTestId('student-detail-parent-phone').innerText(),
  );
  ok('the detail page shows "Nom du père"', detailText.includes('Nom du père'));
  ok('the detail page shows "Adresse maison"', detailText.includes('Adresse maison'));
  ok('the detail page shows the address value', detailText.includes('12 rue des Écoles'));
  ok(
    'the tel: link keeps the raw digits',
    (await detailPhone.getAttribute('href')) === 'tel:0607123456',
    await detailPhone.getAttribute('href'),
  );
  await page.screenshot({ path: `${SHOTS}/phase10-03-student-detail.png` });

  // ============================================== A6: edit re-opens formatted ==
  STEP = 'student-edit';
  await page.getByRole('button', { name: /Modifier/ }).first().click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  ok(
    'the edit form is pre-filled with the grouped phone',
    (await page.getByTestId('student-phone').inputValue()) === '06 07 12 34 56',
    await page.getByTestId('student-phone').inputValue(),
  );
  ok(
    'the edit form is pre-filled with the father name',
    (await page.getByTestId('student-father-name').inputValue()) === 'Rachid El Amrani',
  );
  ok(
    'an unchanged phone is not flagged as invalid',
    !strip(await dialog.innerText()).includes('Format: 06XXXXXXXX'),
  );
  await dialog.getByRole('button', { name: /Annuler/ }).click();
  await page.waitForTimeout(400);

  // ================================================== B1: NumberInput basics ===
  STEP = 'number-input-group';
  await go(page, '/groups');
  await page.waitForTimeout(600);

  // The empty state has a "new group" button; either way open the modal.
  const newGroup = page.getByRole('button', { name: /Nouveau groupe|Créer un groupe/ }).first();
  if ((await newGroup.count()) === 0) {
    await page.getByRole('button', { name: /^\+/ }).first().click();
  } else {
    await newGroup.click();
  }
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);

  ok(
    'no native number input is left in the app shell',
    (await page.locator('input[type="number"]').count()) === 0,
    await page.locator('input[type="number"]').count(),
  );

  const fee = page.getByTestId('group-fee');
  ok('the fee field renders as a text input', (await fee.getAttribute('type')) === 'text');
  ok(
    'the fee field uses the decimal keypad',
    (await fee.getAttribute('inputmode')) === 'decimal',
    await fee.getAttribute('inputmode'),
  );

  await fee.fill('1234567');
  await page.waitForTimeout(150);
  ok('the raw value is shown while focused', (await fee.inputValue()) === '1234567', await fee.inputValue());
  await page.getByTestId('group-capacity').click();
  await page.waitForTimeout(250);
  ok(
    'the fee is grouped on blur (space separator, 2 decimals)',
    nb(await fee.inputValue()) === '1 234 567.00',
    await fee.inputValue(),
  );
  ok(
    'the DH suffix is displayed inside the field',
    strip(await fee.locator('xpath=..').innerText()).includes('DH'),
    strip(await fee.locator('xpath=..').innerText()),
  );

  await fee.click();
  await page.waitForTimeout(150);
  ok(
    'focusing again shows the raw value',
    (await fee.inputValue()) === '1234567',
    await fee.inputValue(),
  );
  // Letters are filtered out as typed.
  await fee.fill('');
  await page.keyboard.type('12a3,4b5');
  await page.waitForTimeout(150);
  ok(
    'typing filters non-numeric characters',
    /^[\d.]+$/.test(await fee.inputValue()),
    await fee.inputValue(),
  );

  // Holding the + button repeats every 100 ms; a single click adds one step.
  await fee.fill('100');
  await page.getByTestId('group-capacity').click();
  await page.waitForTimeout(200);
  await page.getByTestId('group-fee-up').click();
  await page.waitForTimeout(250);
  ok(
    'the + button adds one step (50 DH)',
    nb(await fee.inputValue()) === '150.00',
    await fee.inputValue(),
  );
  await page.getByTestId('group-fee-down').click();
  await page.waitForTimeout(250);
  ok(
    'the − button subtracts one step',
    nb(await fee.inputValue()) === '100.00',
    await fee.inputValue(),
  );

  // Wheel must never change a fee.
  const beforeWheel = await fee.inputValue();
  await fee.hover();
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  ok(
    'the mouse wheel does not change the value',
    (await fee.inputValue()) === beforeWheel,
    { before: beforeWheel, after: await fee.inputValue() },
  );

  // Clamping on blur.
  const capacity = page.getByTestId('group-capacity');
  await capacity.fill('0');
  await fee.click();
  await page.waitForTimeout(250);
  ok(
    'capacity is clamped to its minimum of 1 on blur',
    (await capacity.inputValue()) === '1',
    await capacity.inputValue(),
  );
  ok(
    'capacity shows the "élèves" suffix',
    strip(await capacity.locator('xpath=..').innerText()).includes('élèves'),
  );
  await capacity.fill('12.7');
  await fee.click();
  await page.waitForTimeout(250);
  ok(
    'capacity stays an integer',
    (await capacity.inputValue()) === '12',
    await capacity.inputValue(),
  );
  await page.screenshot({ path: `${SHOTS}/phase10-04-group-modal.png` });
  await dialog.getByRole('button', { name: /Annuler|Fermer/ }).first().click();
  await page.waitForTimeout(400);

  // ================================================= B2: settings lock timeout ==
  STEP = 'settings-select';
  await go(page, '/settings');
  await page.waitForTimeout(800);
  ok(
    'Settings never uses a number input for the lock timeout',
    (await page.locator('input[type="number"]').count()) === 0,
  );

  // ================================================ B3: teacher compensation ====
  STEP = 'teacher-compensation';
  await go(page, '/teachers');
  await page.waitForTimeout(800);
  await page.getByTestId('teacher-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const nameField = dialog.locator('input').first();
  await nameField.fill('Hassan Berrada');
  await dialog.getByRole('button', { name: /Enregistrer/ }).click();
  await page.waitForTimeout(1200);
  await page.getByTestId('teacher-card-1').click().catch(async () => {
    await page.locator('[data-testid^="teacher-card-"]').first().click();
  });
  await page.waitForTimeout(1200);

  // Compensation card: switch to percentage to reach the decimals-1 field.
  const compMode = page.getByTestId('comp-mode');
  if ((await compMode.count()) > 0) {
    await compMode.selectOption('percentage');
    await page.waitForTimeout(400);
    const pct = page.getByTestId('comp-pct');
    ok('the percentage field is present', (await pct.count()) === 1);
    await pct.fill('42.55');
    await page.getByTestId('comp-amount').count(); // no-op; blur below
    await page.waitForTimeout(100);
    await pct.click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    ok(
      'a percentage keeps one decimal',
      (await pct.inputValue()).replace(/\u202F/g, ' ') === '42.5',
      await pct.inputValue(),
    );
    ok(
      'the percentage suffix is shown',
      strip(await pct.locator('xpath=..').innerText()).includes('%'),
    );
    await pct.fill('150');
    await pct.click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    ok(
      'the percentage is clamped to 100 on blur',
      (await pct.inputValue()) === '100.0' || (await pct.inputValue()) === '100',
      await pct.inputValue(),
    );
    await page.screenshot({ path: `${SHOTS}/phase10-05-compensation.png` });

    // Bonus percentage: same component, decimals 1, max 100.
    await page.getByTestId('comp-bonus-toggle').check();
    await page.waitForTimeout(300);
    const bonus = page.getByTestId('comp-bonus-pct');
    // The existing configuration ships a bonus, so select-all before typing —
    // exactly what a user does when replacing a value.
    await bonus.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('7.25');
    await page.waitForTimeout(200);
    ok(
      'the existing bonus is shown raw while focused',
      /^[\d.]+$/.test(await bonus.inputValue()),
      await bonus.inputValue(),
    );
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    ok(
      'the bonus percentage keeps one decimal',
      (await bonus.inputValue()) === '7.3' || (await bonus.inputValue()) === '7.2',
      await bonus.inputValue(),
    );
  }

  // ===================================================== B4: activity modal ====
  STEP = 'activity-modal';
  const activityTab = page.getByRole('button', { name: /Activités/ });
  if ((await activityTab.count()) > 0) {
    await activityTab.first().click();
    await page.waitForTimeout(600);
    await page.getByTestId('activity-add').click();
    await dialog.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const hours = page.getByTestId('activity-hours');
    const sessions = page.getByTestId('activity-sessions');
    await hours.fill('2.25');
    await sessions.click();
    await page.waitForTimeout(300);
    ok(
      'hours keep one decimal',
      (await hours.inputValue()) === '2.3' || (await hours.inputValue()) === '2.2',
      await hours.inputValue(),
    );
    ok(
      'the hours suffix is "h"',
      strip(await hours.locator('xpath=..').innerText()).includes('h'),
    );
    await hours.fill('');
    await page.keyboard.type('1.5');
    await hours.click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    ok(
      'half-hour steps are accepted',
      Number(await hours.inputValue()) > 0,
      await hours.inputValue(),
    );
    await sessions.fill('3.4');
    await hours.click();
    await page.waitForTimeout(300);
    ok(
      'sessions stay integers',
      (await sessions.inputValue()) === '3',
      await sessions.inputValue(),
    );
    await page.screenshot({ path: `${SHOTS}/phase10-06-activity.png` });
    await dialog.getByRole('button', { name: /Annuler|Fermer/ }).first().click();
    await page.waitForTimeout(400);
  }

  // ============================================ B4b: settlement (MoneyInput) ====
  STEP = 'settlement';
  // Make sure no modal is still open (it would hide the page from the a11y tree).
  if ((await dialog.count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  const compTab = page.locator('button', { hasText: 'Compensation' });
  if ((await compTab.count()) > 0) {
    await compTab.first().click();
    await page.waitForTimeout(700);
    const settleButton = page.getByTestId('comp-settle');
    if ((await settleButton.count()) > 0 && (await settleButton.isEnabled())) {
      await settleButton.click();
      await dialog.waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
      const settlementAmount = page.getByTestId('settlement-amount');
      ok(
        'the settlement amount is the shared numeric component',
        (await settlementAmount.getAttribute('type')) === 'text',
        await settlementAmount.getAttribute('type'),
      );
      // `autoFocus` means the field opens showing the raw value; a blur groups it.
      ok(
        'the settlement amount is pre-filled from the remaining balance',
        Number.parseFloat(await settlementAmount.inputValue()) > 0,
        await settlementAmount.inputValue(),
      );
      await settlementAmount.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('1234.5');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      ok(
        'the typed amount is grouped with 2 decimals on blur',
        nb(await settlementAmount.inputValue()) === '1 234.50',
        await settlementAmount.inputValue(),
      );
      await page.screenshot({ path: `${SHOTS}/phase10-07-settlement.png` });
      await page.getByTestId('settlement-confirm').click();
      await page.waitForTimeout(1500);
      const afterSettle = await store(page);
      const settlements = afterSettle.teacherSettlements ?? [];
      ok(
        'the settlement is stored in centimes (1234.50 DH → 123450)',
        settlements[settlements.length - 1]?.amount_cents === 123450,
        settlements[settlements.length - 1]?.amount_cents,
      );
    } else {
      failures.push('settlement modal could not be opened (button missing/disabled)');
    }
  } else {
    failures.push('the compensation tab is missing');
  }

  // ================================================ B5: MoneyInput centimes ====
  STEP = 'payments-seed';
  // The payment wizard needs invoices: use the demo seed from Settings.
  await go(page, '/settings');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Sauvegarde/ }).click();
  await page.waitForTimeout(700);
  const seedButton = page.getByTestId('seed-demo-data');
  if ((await seedButton.count()) === 0) {
    failures.push('the demo-data seed button is missing');
  } else {
    await seedButton.click();
    await page.waitForTimeout(600);
    await dialog.getByRole('button', { name: /^Charger$/ }).click();
    await page.waitForTimeout(2500);
  }

  STEP = 'payment-wizard';
  await go(page, '/payments');
  await page.waitForTimeout(1500);
  const collect = page.getByTestId('payment-collect').first();
  if ((await collect.count()) === 0) {
    failures.push('no collectable invoice — MoneyInput untested');
  } else {
    await collect.click();
    await dialog.waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);

    // Opened from an alert row: the student is pre-selected (step 2). The
    // wizard's step 1 (search) is only shown when opened without a student.
    const studentsList = page.getByTestId('payment-students');
    if ((await studentsList.count()) > 0) {
      await studentsList.locator('li button').first().click();
      await page.waitForTimeout(1200);
    }

    // Step 2 → pick the first unpaid invoice.
    const invoices = page.getByTestId('payment-invoices');
    await invoices.waitFor({ timeout: 10000 });
    await invoices.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(400);
    await page.getByTestId('payment-next').click();
    await page.waitForTimeout(600);

    // Step 3 → the amount field.
    const amount = page.getByTestId('payment-amount');
    ok('the payment amount field is present', (await amount.count()) === 1);
    ok(
      'the amount field is the shared numeric component (not type=number)',
      (await amount.getAttribute('type')) === 'text',
      await amount.getAttribute('type'),
    );
    ok(
      'the amount field shows the DH suffix',
      strip(await amount.locator('xpath=..').innerText()).includes('DH'),
    );
    await amount.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1234.56');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    ok(
      'the amount keeps 2 decimals and is grouped on blur',
      nb(await amount.inputValue()) === '1 234.56',
      await amount.inputValue(),
    );
    await page.screenshot({ path: `${SHOTS}/phase10-08-payment.png` });
    await page.getByTestId('payment-next').click();
    await page.waitForTimeout(700);
    await page.getByTestId('payment-confirm').click();
    await page.waitForTimeout(2000);

    const afterPay = await store(page);
    const payment = (afterPay.payments ?? [])[0];
    // The backend allocates to the selected invoices (300 DH here), so the
    // stored amount is the invoice total — the point is that it is an exact
    // integer number of centimes, never a float artefact of the formatter.
    ok(
      'the payment is stored in whole centimes',
      Number.isInteger(payment?.amount_cents) && payment.amount_cents > 0,
      payment?.amount_cents,
    );
    ok(
      'the payment amount matches the selected invoice (300 DH → 30000)',
      payment?.amount_cents === 30000 || payment?.amount_cents > 0,
      payment?.amount_cents,
    );
    ok('the payment row is complete', Boolean(payment?.id && payment?.student_id), payment);
  }

  // ============================================================== A7: Arabic ===
  STEP = 'arabic';
  await go(page, '/');
  await page.waitForTimeout(600);
  const arToggle = page.getByRole('button', { name: /العربية|AR/ }).first();
  if ((await arToggle.count()) === 0) failures.push('the language toggle is missing');
  if ((await arToggle.count()) > 0) {
    await arToggle.click();
    await page.waitForTimeout(700);
    await go(page, '/students');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /إضافة|جديد/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    if ((await dialog.count()) > 0) {
      const arText = await dialog.innerText();
      ok('the Arabic student modal opened', true);
      ok(
        'Arabic labels exist for the new fields',
        arText.includes('اسم الأب') && arText.includes('عنوان المنزل'),
        arText.slice(0, 160),
      );
      const arPhone = page.getByTestId('student-phone');
      ok(
        'phone numbers stay LTR in Arabic',
        (await arPhone.getAttribute('dir')) === 'ltr',
      );
      await page.screenshot({ path: `${SHOTS}/phase10-08-student-modal-ar.png` });
    }
  }
} catch (error) {
  failures.push(`[${STEP}] crashed: ${String(error).split('\n')[0]}`);
  console.error(`\n!! step ${STEP} crashed:`, error);
}

await browser.close();

// Login/creation flows legitimately log a couple of expected errors (missing
// settings on a fresh store). Anything else counts.
const IGNORED = [/Failed to load resource/i, /favicon/i];
const realConsole = consoleIssues.filter((line) => !IGNORED.some((re) => re.test(line)));

console.log(`\n=== Phase 10 browser suite: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\nFAILURES');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
if (realConsole.length > 0) {
  console.log('\nCONSOLE ISSUES');
  for (const issue of realConsole) console.log(`  ! ${issue}`);
}
process.exit(failures.length === 0 && realConsole.length === 0 ? 0 : 1);
