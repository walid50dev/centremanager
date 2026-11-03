/**
 * Phase 15 — the date of a monthly expense.
 * Temporary browser suite (kept next to the other phase suites).
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
const amountToCents = (text) => {
  const cleaned = strip(text).replace(/[^\d.,-]/g, '').replace(/\s/g, '');
  return Math.round(Number.parseFloat(cleaned.replace(',', '.')) * 100);
};

/** `YYYY-MM-DD` of today, in the browser's timezone. */
const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
/** `2026-11-05` → `05/11/2026` (French) and `2026/11/05` (Arabic). */
const frDate = (iso) => {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};
const arDate = (iso) => iso.split('-').join('/');

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

let STEP = 'login';

try {
  const { page } = await login();
  const dialog = page.locator('[role="dialog"]');

  // =============================================== A1: the page and its table ===
  STEP = 'expenses-page';
  await go(page, '/expenses');
  await page.getByTestId('expenses-title').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);

  const headers = await page
    .locator('[data-testid="expenses-table"] thead th')
    .allInnerTexts();
  ok(
    'the table has a Date column',
    strip(headers[0]).trim() === 'Date',
    headers.map(strip),
  );
  ok('the Date column comes first', strip(headers[0]).trim() === 'Date', headers.map(strip));
  ok(
    'the other columns are unchanged',
    strip(headers[1]).trim() === 'Catégorie' &&
      strip(headers[2]).trim() === 'Libellé' &&
      strip(headers[3]).trim() === 'Montant',
    headers.map(strip),
  );

  const seeded = await store(page);
  const now = new Date();
  const period = { month: now.getMonth() + 1, year: now.getFullYear() };
  const monthRows = (seeded.expenses ?? []).filter(
    (row) => row.month === period.month && row.year === period.year,
  );
  ok('the seeded charges all carry a date', monthRows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.expense_date ?? '')),
    monthRows.map((row) => row.expense_date));

  // Every rendered date matches the stored one, in the French order.
  const shownDates = await page
    .locator('[data-testid^="expense-date-"]')
    .allInnerTexts();
  ok(
    'each row prints DD/MM/YYYY',
    shownDates.length > 0 && shownDates.every((text) => /^\d{2}\/\d{2}\/\d{4}$/.test(strip(text).trim())),
    shownDates.map((text) => strip(text).trim()),
  );
  ok(
    'each printed day is a stored day of that month',
    monthRows.every((row) =>
      shownDates.some((text) => strip(text).trim() === frDate(row.expense_date)),
    ),
    {
      shown: shownDates.map((text) => strip(text).trim()),
      stored: monthRows.map((row) => row.expense_date),
    },
  );

  // Newest first: the rendered dates, read back as ISO, are in descending order.
  const renderedIso = shownDates.map((text) => {
    const [day, month, year] = strip(text).trim().split('/');
    return `${year}-${month}-${day}`;
  });
  ok(
    'the list is sorted by date, newest first',
    renderedIso.length === monthRows.length &&
      renderedIso.every((iso, index) => index === 0 || renderedIso[index - 1] >= iso),
    { rendered: renderedIso, stored: monthRows.map((row) => row.expense_date) },
  );

  await page.screenshot({ path: `${SHOTS}/phase15-01-expenses-date-column.png` });

  // ==================================================== A2: the form default ===
  STEP = 'form-default-date';
  await page.getByTestId('expense-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);

  const dateField = page.getByTestId('expense-date');
  ok('the form has a date field', (await dateField.count()) === 1);
  ok('it is a real date input', (await dateField.getAttribute('type')) === 'date');
  ok('it is not disabled', !(await dateField.isDisabled()));
  ok('it is not read-only', (await dateField.getAttribute('readonly')) === null);
  ok(
    'it defaults to today',
    (await dateField.inputValue()) === todayIso(),
    { value: await dateField.inputValue(), today: todayIso() },
  );
  const dateLabel = await dialog.locator('label', { hasText: 'Date de la dépense' }).count();
  ok('the field is labelled “Date de la dépense”', dateLabel === 1);
  await page.screenshot({ path: `${SHOTS}/phase15-02-expense-date-form.png` });

  // ============================================ A3: save with an explicit date ===
  STEP = 'explicit-date';
  const chosenDay = `${todayIso().slice(0, 7)}-03`; // the 3rd of this month
  await dateField.fill(chosenDay);
  await dateField.press('Tab');

  await page.getByTestId('expense-category-trigger').click();
  await page.getByTestId('expense-category-list').waitFor({ timeout: 5000 });
  await page.getByTestId('expense-category-option-Loyer').click();
  await page.getByTestId('expense-label').fill('Loyer daté du 3');
  const amount = page.getByTestId('expense-amount');
  await amount.fill('1800');
  await amount.press('Tab');
  await page.getByTestId('expense-save').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await page.waitForTimeout(1200);

  const afterSave = await store(page);
  const dated = (afterSave.expenses ?? []).find((row) => row.label === 'Loyer daté du 3');
  ok('the charge is stored', Boolean(dated), (afterSave.expenses ?? []).length);
  ok('it keeps the date that was picked', dated?.expense_date === chosenDay, dated?.expense_date);
  ok(
    'the accounting period follows the date',
    dated?.month === Number(chosenDay.slice(5, 7)) && dated?.year === Number(chosenDay.slice(0, 4)),
    { month: dated?.month, year: dated?.year },
  );
  ok('the amount is unchanged', dated?.amount_cents === 180000, dated?.amount_cents);
  ok(
    'the row shows the new date',
    strip(await page.getByTestId(`expense-date-${dated?.id}`).innerText()).trim() === frDate(chosenDay),
    strip(await page.getByTestId(`expense-date-${dated?.id}`).innerText()),
  );
  ok(
    'the audit row records the date',
    (afterSave.auditLog ?? []).some(
      (entry) => entry.entity_type === 'expense' && entry.action === 'CREATE' && String(entry.details).includes(chosenDay),
    ),
  );
  await page.screenshot({ path: `${SHOTS}/phase15-03-expense-dated-row.png` });

  // ======================================= A4: back-dating switches the period ===
  STEP = 'backdated-expense';
  // A date in the previous month, while the page is showing the current one.
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousDay = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-12`;
  await page.getByTestId('expense-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.getByTestId('expense-date').fill(previousDay);
  await page.getByTestId('expense-date').press('Tab');
  await page.getByTestId('expense-category-trigger').click();
  await page.getByTestId('expense-category-list').waitFor({ timeout: 5000 });
  await page.getByTestId('expense-category-option-Loyer').click();
  await page.getByTestId('expense-label').fill('Loyer du mois dernier');
  await page.getByTestId('expense-amount').fill('1700');
  await page.getByTestId('expense-amount').press('Tab');
  await page.getByTestId('expense-save').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await page.waitForTimeout(1500);

  const afterBackdate = await store(page);
  const backdated = (afterBackdate.expenses ?? []).find((row) => row.label === 'Loyer du mois dernier');
  ok('the back-dated charge is stored', Boolean(backdated));
  ok(
    'it lands in the month of its date',
    backdated?.month === previous.getMonth() + 1 && backdated?.year === previous.getFullYear(),
    { month: backdated?.month, year: backdated?.year },
  );
  ok(
    'the page follows the charge to that month',
    Number(await page.getByTestId('expenses-month').inputValue()) === previous.getMonth() + 1 &&
      Number(await page.getByTestId('expenses-year').inputValue()) === previous.getFullYear(),
    {
      month: await page.getByTestId('expenses-month').inputValue(),
      year: await page.getByTestId('expenses-year').inputValue(),
    },
  );
  ok(
    'the row is visible on that month',
    (await page.getByTestId(`expense-row-${backdated?.id}`).count()) === 1,
  );
  ok(
    '…with its own date',
    strip(await page.getByTestId(`expense-date-${backdated?.id}`).innerText()).trim() ===
      frDate(previousDay),
    strip(await page.getByTestId(`expense-date-${backdated?.id}`).innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase15-04-backdated-row.png` });

  // ================================================ A5: edit keeps the date ===
  STEP = 'edit-date';
  await page.getByTestId(`expense-edit-${backdated?.id}`).click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  ok(
    'the edit form opens on the stored date',
    (await page.getByTestId('expense-date').inputValue()) === previousDay,
    await page.getByTestId('expense-date').inputValue(),
  );
  const movedDay = `${previousDay.slice(0, 8)}20`;
  await page.getByTestId('expense-date').fill(movedDay);
  await page.getByTestId('expense-date').press('Tab');
  await page.getByTestId('expense-save').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await page.waitForTimeout(1200);
  const afterEdit = await store(page);
  const edited = (afterEdit.expenses ?? []).find((row) => row.id === backdated?.id);
  ok('the date can be moved', edited?.expense_date === movedDay, edited?.expense_date);
  ok(
    'the move is audited',
    (afterEdit.auditLog ?? []).some(
      (entry) =>
        entry.entity_type === 'expense' &&
        entry.action === 'UPDATE' &&
        String(entry.details).includes('expense_date'),
    ),
  );

  // ================================================= A6: the date is required ===
  STEP = 'required-date';
  await page.getByTestId('expense-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.getByTestId('expense-date').fill('');
  await page.getByTestId('expense-category-trigger').click();
  await page.getByTestId('expense-category-list').waitFor({ timeout: 5000 });
  await page.getByTestId('expense-category-option-Loyer').click();
  await page.getByTestId('expense-label').fill('Sans date');
  await page.getByTestId('expense-amount').fill('100');
  await page.getByTestId('expense-amount').press('Tab');
  await page.getByTestId('expense-save').click();
  await page.waitForTimeout(700);
  const before = (await store(page)).expenses?.length ?? 0;
  ok('an empty date is refused', (await dialog.isVisible()) === true);
  ok(
    'the field shows the reason',
    strip(nb(await dialog.innerText())).includes('La date de la dépense est obligatoire'),
    strip(nb(await dialog.innerText())).slice(0, 120),
  );
  ok('nothing was saved', ((await store(page)).expenses?.length ?? 0) === before);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ================================================== A7: dashboard untouched ===
  STEP = 'dashboard';
  await go(page, '/');
  await page.waitForTimeout(1200);
  const dashStore = await store(page);
  const currentMonthExpenses = (dashStore.expenses ?? [])
    .filter((row) => row.month === period.month && row.year === period.year)
    .reduce((sum, row) => sum + row.amount_cents, 0);
  const netCard = page.getByTestId('kpi-net');
  ok('the dashboard still shows the net card', (await netCard.count()) === 1);
  const tooltip = strip(nb((await netCard.getAttribute('data-tooltip')) ?? ''));
  ok(
    'its tooltip still reports the month\'s expenses (period, not dates)',
    amountToCents(tooltip.split('·')[1] ?? tooltip) === currentMonthExpenses ||
      tooltip.includes(String((currentMonthExpenses / 100).toFixed(2))),
    { tooltip, expected: currentMonthExpenses },
  );

  // ========================================================== A8: Arabic pass ===
  STEP = 'arabic';
  await page.evaluate(() => localStorage.setItem('centremanager.language', 'ar'));
  await page.reload();
  await page.waitForTimeout(800);
  if (page.url().includes('/login')) {
    // The dev session lives in memory, so the reload lands on the login form —
    // now in Arabic: select the fields by type, not by their translated label.
    await page.locator('input[type="password"]').first().fill('test1234');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(`${BASE}/`, { timeout: 20000 });
    await page.waitForTimeout(1500);
  }
  await go(page, '/expenses');
  await page.waitForTimeout(1200);
  ok('document switched to RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');

  const arHeaders = await page
    .locator('[data-testid="expenses-table"] thead th')
    .allInnerTexts();
  ok('the Date column is translated', strip(arHeaders[0]).trim() === 'التاريخ', arHeaders.map(strip));

  await go(page, '/expenses');
  await page.waitForTimeout(600);
  // back to the month holding the dated rows
  await page.getByTestId('expenses-month').selectOption(String(previous.getMonth() + 1));
  await page.waitForTimeout(1200);
  const arDates = (await page.locator('[data-testid^="expense-date-"]').allInnerTexts()).map((text) =>
    strip(text).trim(),
  );
  ok(
    'Arabic prints the date year-first',
    arDates.length > 0 && arDates.every((text) => /^\d{4}\/\d{2}\/\d{2}$/.test(text)),
    arDates,
  );
  ok(
    '…the same day as the store',
    arDates.includes(arDate(movedDay)),
    { shown: arDates, expected: arDate(movedDay) },
  );

  await page.getByTestId('expense-new').click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  ok(
    'the field is labelled “تاريخ المصروف”',
    (await page.locator('[role="dialog"] label', { hasText: 'تاريخ المصروف' }).count()) === 1,
    strip(nb(await page.locator('[role="dialog"]').innerText())).slice(0, 160),
  );
  ok(
    'the date still defaults to today in Arabic',
    (await page.getByTestId('expense-date').inputValue()) === todayIso(),
    await page.getByTestId('expense-date').inputValue(),
  );
  await page.screenshot({ path: `${SHOTS}/phase15-05-expense-date-ar.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  ok('no console errors or page errors', consoleIssues.length === 0, consoleIssues.slice(0, 6));

  await browser.close();

  console.log(`\nphase15: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`\nphase15 stopped at step "${STEP}":`, error?.message ?? error);
  for (const failure of consoleIssues.slice(0, 6)) console.error('  console:', failure);
  await browser.close();
  process.exit(1);
}
