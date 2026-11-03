/**
 * Phase 11 — monthly expenses + the "Total Net" dashboard card.
 * Temporary browser suite (deleted after the phase).
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
/** `1 234,56 DH` / `1 234.56 DH` → 123456 (centimes). */
const amountToCents = (text) => {
  const cleaned = strip(text).replace(/[^\d.,-]/g, '').replace(/\s/g, '');
  const normalised = cleaned.replace(',', '.');
  return Math.round(Number.parseFloat(normalised) * 100);
};
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
  await page.waitForTimeout(700);
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

/** The dev session lives in memory: a reload lands on /login again. */
async function relogin(page) {
  await page.getByLabel('Mot de passe', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: /^Connexion$/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await page.waitForTimeout(1500);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

let STEP = 'login';

try {
  const { page } = await login();
  const dialog = page.locator('[role="dialog"]');

  // ==================================================== A1: sidebar + route ===
  STEP = 'sidebar';
  const navItems = await page.locator('nav a').evaluateAll((links) =>
    links.map((link) => ({ href: link.getAttribute('href'), text: link.innerText.trim() })),
  );
  const hrefs = navItems.map((item) => item.href);
  ok(
    'the sidebar has a Frais link between Paiements and Paramètres',
    hrefs.indexOf('/expenses') === hrefs.indexOf('/payments') + 1 &&
      hrefs.indexOf('/settings') === hrefs.indexOf('/expenses') + 1,
    hrefs,
  );
  ok('the Frais link is labelled "Frais"', navItems.some((item) => item.text === 'Frais'), navItems);

  await page.getByTestId('nav-expenses').click();
  await page.waitForTimeout(1200);
  ok('the Frais link opens /expenses', page.url().endsWith('/expenses'), page.url());

  // ======================================================= A2: the page itself ===
  STEP = 'expenses-page';
  ok(
    'the page is titled "Frais du mois"',
    strip(await page.getByTestId('expenses-title').innerText()).includes('Frais du mois'),
    strip(await page.getByTestId('expenses-title').innerText()),
  );
  const seededStore = await store(page);
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const seededRows = (seededStore.expenses ?? []).filter(
    (row) => row.month === month && row.year === year,
  );
  ok('the dev store starts with monthly charges', seededRows.length > 0, seededRows.length);

  const totalCard = page.getByTestId('expenses-total-value');
  const seededTotal = seededRows.reduce((sum, row) => sum + row.amount_cents, 0);
  ok(
    'the total card shows the sum of the month',
    amountToCents(await totalCard.innerText()) === seededTotal,
    { shown: strip(await totalCard.innerText()), expected: seededTotal },
  );
  ok(
    'the total is rendered in the destructive colour',
    (await totalCard.evaluate((node) => getComputedStyle(node).color)).includes('220, 38, 38'),
    await totalCard.evaluate((node) => getComputedStyle(node).color),
  );
  ok(
    'the count card shows the number of expenses',
    Number(await page.getByTestId('expenses-count-value').innerText()) === seededRows.length,
    await page.getByTestId('expenses-count-value').innerText(),
  );
  ok(
    'the header badge repeats the count',
    strip(await page.getByTestId('expenses-count-badge').innerText()) === String(seededRows.length),
    strip(await page.getByTestId('expenses-count-badge').innerText()),
  );

  const rows = page.locator('[data-testid^="expense-row-"]');
  ok('the table lists the month rows', (await rows.count()) === seededRows.length, await rows.count());

  // Category colours must differ between categories.
  const badgeColours = await page
    .locator('[data-testid^="expense-row-"] [data-category]')
    .evaluateAll((badges) =>
      badges.map((badge) => ({
        category: badge.getAttribute('data-category'),
        background: getComputedStyle(badge).backgroundColor,
      })),
    );
  const byCategory = new Map();
  for (const badge of badgeColours) if (!byCategory.has(badge.category)) byCategory.set(badge.category, badge.background);
  ok(
    'each category badge has its own colour',
    new Set(byCategory.values()).size === byCategory.size,
    [...byCategory.entries()],
  );
  ok(
    'the footer counts in plain French',
    /\d+ dépenses$/.test(strip(await page.getByTestId('expenses-footer-count').innerText())),
    strip(await page.getByTestId('expenses-footer-count').innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/phase11-01-expenses-page.png` });

  // ============================================================ A3: create ===
  STEP = 'create-expense';
  await page.getByTestId('expense-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);

  // Phase 12 turned the category into a CreatableSelect: open it, then pick.
  await page.getByTestId('expense-category-trigger').click();
  await page.getByTestId('expense-category-list').waitFor({ timeout: 5000 });
  const options = await page
    .locator('[data-testid^="expense-category-option-"]')
    .allInnerTexts();
  ok(
    'the form offers the seven default categories',
    ['Loyer', 'WiFi', 'Électricité', 'Eau', 'Assistance', 'Fournitures', 'Autre'].every((name) =>
      options.some((label) => strip(label).trim() === name),
    ),
    options,
  );
  ok(
    'the category defaults to the first one',
    strip(await page.getByTestId('expense-category-trigger').innerText()).includes('Loyer'),
    strip(await page.getByTestId('expense-category-trigger').innerText()),
  );
  await page.getByTestId('expense-category-option-Loyer').click();
  await page.waitForTimeout(300);
  await page.getByTestId('expense-label').fill('Loyer local principal');
  const expenseAmount = page.getByTestId('expense-amount');
  ok(
    'the amount uses the shared numeric component',
    (await expenseAmount.getAttribute('type')) === 'text',
  );
  ok(
    'the amount shows the DH suffix',
    strip(await expenseAmount.locator('xpath=..').innerText()).includes('DH'),
  );
  await expenseAmount.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3500');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  ok(
    'the amount is grouped with 2 decimals on blur',
    nb(await expenseAmount.inputValue()) === '3 500.00',
    await expenseAmount.inputValue(),
  );
  await page.getByTestId('expense-notes').fill('Payé par virement');
  await page.screenshot({ path: `${SHOTS}/phase11-02-expense-modal.png` });
  await page.getByTestId('expense-save').click();
  await page.waitForTimeout(1200);

  const afterCreate = await store(page);
  const created = (afterCreate.expenses ?? []).find((row) => row.label === 'Loyer local principal' && row.amount_cents === 350000);
  ok('the expense is stored', Boolean(created), (afterCreate.expenses ?? []).length);
  ok('the amount is stored in centimes', created?.amount_cents === 350000, created?.amount_cents);
  ok('the category is stored', created?.category === 'Loyer', created?.category);
  ok('the month/year come from the page selector', created?.month === month && created?.year === year, {
    month: created?.month,
    year: created?.year,
  });
  ok('the notes are stored', created?.notes === 'Payé par virement', created?.notes);
  ok(
    'a CREATE row is audited',
    (afterCreate.auditLog ?? []).some(
      (entry) => entry.entity_type === 'expense' && entry.action === 'CREATE',
    ),
  );

  // The table and the summary now include it.
  await page.waitForTimeout(600);
  const totalAfterCreate = seededTotal + 350000;
  ok(
    'the total card grew by 3 500 DH',
    amountToCents(await page.getByTestId('expenses-total-value').innerText()) === totalAfterCreate,
    strip(await page.getByTestId('expenses-total-value').innerText()),
  );
  ok(
    'a summary card exists per category',
    (await page.locator('[data-testid^="expense-category-card-"]').count()) >= 4,
    await page.locator('[data-testid^="expense-category-card-"]').count(),
  );

  // ============================================================== A4: edit ===
  STEP = 'edit-expense';
  const createdRow = page.locator(`[data-testid="expense-row-${created.id}"]`);
  await createdRow.getByTestId(`expense-edit-${created.id}`).click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  ok(
    'the edit form is pre-filled',
    (await page.getByTestId('expense-label').inputValue()) === 'Loyer local principal',
    await page.getByTestId('expense-label').inputValue(),
  );
  await page.getByTestId('expense-label').fill('Loyer local principal (révisé)');
  const editAmount = page.getByTestId('expense-amount');
  await editAmount.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3600');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  await page.getByTestId('expense-save').click();
  await page.waitForTimeout(1200);

  const afterEdit = await store(page);
  const edited = (afterEdit.expenses ?? []).find((row) => row.id === created.id);
  ok('the label changed', edited?.label === 'Loyer local principal (révisé)', edited?.label);
  ok('the amount changed in centimes', edited?.amount_cents === 360000, edited?.amount_cents);
  ok(
    'an UPDATE row is audited',
    (afterEdit.auditLog ?? []).some(
      (entry) => entry.entity_type === 'expense' && entry.action === 'UPDATE',
    ),
  );

  // =========================================== A5: category + month filters ===
  STEP = 'filters';
  await page.getByTestId('expenses-filter').selectOption('Loyer');
  await page.waitForTimeout(500);
  const filteredRows = await page.locator('[data-testid^="expense-row-"]').count();
  const loyerRows = (afterEdit.expenses ?? []).filter(
    (row) => row.month === month && row.year === year && row.category === 'Loyer',
  ).length;
  ok('the category filter narrows the table', filteredRows === loyerRows, { filteredRows, loyerRows });
  ok(
    'the footer total follows the filter',
    amountToCents(await page.getByTestId('expenses-footer-total').innerText()) ===
      (afterEdit.expenses ?? [])
        .filter((row) => row.month === month && row.year === year && row.category === 'Loyer')
        .reduce((sum, row) => sum + row.amount_cents, 0),
    strip(await page.getByTestId('expenses-footer-total').innerText()),
  );
  await page.getByTestId('expenses-clear-filter').click();
  await page.waitForTimeout(400);

  // Previous month (the seeded store has a rent row there).
  const previousMonth = month === 1 ? 12 : month - 1;
  await page.getByTestId('expenses-month').selectOption(String(previousMonth));
  await page.waitForTimeout(900);
  const previousRows = (afterEdit.expenses ?? []).filter(
    (row) => row.month === previousMonth && row.year === year,
  );
  ok(
    'switching the month loads that month only',
    (await page.locator('[data-testid^="expense-row-"]').count()) === previousRows.length,
    { shown: await page.locator('[data-testid^="expense-row-"]').count(), expected: previousRows.length },
  );
  await page.getByTestId('expenses-month').selectOption(String(month));
  await page.waitForTimeout(900);

  // ============================================ A6: custom category in Settings ===
  STEP = 'settings-categories';
  await go(page, '/settings');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Catégories de dépenses/ }).click();
  await page.waitForTimeout(600);
  ok(
    'the settings section lists the categories',
    (await page.locator('[data-testid^="expense-category-tag-"]').count()) === 7,
    await page.locator('[data-testid^="expense-category-tag-"]').count(),
  );
  await page.getByTestId('expense-category-input').fill('Sécurité');
  await page.getByTestId('expense-category-add').click();
  await page.waitForTimeout(400);
  ok(
    'a custom category can be added',
    (await page.locator('[data-testid^="expense-category-tag-"]').count()) === 8,
  );
  await page.screenshot({ path: `${SHOTS}/phase11-03-settings-categories.png` });
  await page.getByTestId('expense-categories-save').click();
  await page.waitForTimeout(1200);
  const afterCategories = await store(page);
  ok(
    'the custom category is persisted in settings',
    JSON.parse(afterCategories.settings.expense_categories).includes('Sécurité'),
    afterCategories.settings.expense_categories,
  );

  // …and the expense form offers it immediately.
  await go(page, '/expenses');
  await page.waitForTimeout(900);
  await page.getByTestId('expense-new').click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.getByTestId('expense-category-trigger').click();
  await page.getByTestId('expense-category-list').waitFor({ timeout: 5000 });
  ok(
    'the new category appears in the expense form',
    (await page.locator('[data-testid^="expense-category-option-"]').count()) === 8,
    await page.locator('[data-testid^="expense-category-option-"]').count(),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: /Annuler/ }).click();
  await page.waitForTimeout(500);

  // ============================================================ A7: delete ===
  STEP = 'delete-expense';
  const rowToDelete = page.locator(`[data-testid="expense-row-${created.id}"]`);
  await rowToDelete.getByTestId(`expense-delete-${created.id}`).click();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const confirmText = strip(await dialog.innerText());
  ok('the delete asks for a confirmation', confirmText.includes('Supprimer cette dépense'));
  ok('the confirmation names the expense', confirmText.includes('Loyer local principal (révisé)'));
  await page.screenshot({ path: `${SHOTS}/phase11-04-delete-confirm.png` });
  await dialog.getByRole('button', { name: /^Supprimer$/ }).click();
  await page.waitForTimeout(1400);

  const afterDelete = await store(page);
  ok(
    'the expense is gone from the store',
    !(afterDelete.expenses ?? []).some((row) => row.id === created.id),
  );
  ok(
    'a DELETE row is audited with a snapshot',
    (afterDelete.auditLog ?? []).some(
      (entry) =>
        entry.entity_type === 'expense' &&
        entry.action === 'DELETE' &&
        String(entry.details).includes('Loyer local principal (révisé)'),
    ),
  );
  ok(
    'the DELETE is not left in the table',
    (await page.locator(`[data-testid="expense-row-${created.id}"]`).count()) === 0,
  );

  // ====================================================== A8: persistence ===
  STEP = 'persistence';
  const beforeReload = await store(page);
  await page.reload();
  await page.waitForTimeout(1500);
  // The dev session is memory-only: sign back in, then assert the rows survived.
  await relogin(page);
  const afterReload = await store(page);
  ok(
    'the expenses survive a reload',
    (afterReload.expenses ?? []).length === (beforeReload.expenses ?? []).length,
    { before: beforeReload.expenses?.length, after: afterReload.expenses?.length },
  );

  // ============================================================ B1: net card ===
  STEP = 'dashboard-net';
  await go(page, '/');
  await page.waitForTimeout(1500);
  const cards = page.locator('[data-testid^="kpi-"]');
  const kpiIds = await page
    .locator('[data-testid="dashboard-kpis"] > *')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  ok('the dashboard shows six KPI cards', kpiIds.length === 6, kpiIds);
  ok('the sixth card is the net income', kpiIds[5] === 'kpi-net', kpiIds);

  // Grid geometry: three cards per row on a 1440 px window.
  const boxes = await page
    .locator('[data-testid="dashboard-kpis"] > *')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
  ok(
    'three cards share the first row',
    Math.abs(boxes[0].y - boxes[2].y) < 2 && boxes[3].y > boxes[0].y + 20,
    boxes.map((box) => ({ x: Math.round(box.x), y: Math.round(box.y) })),
  );

  // Expected net, recomputed from the store.
  const finalStore = await store(page);
  const pad2 = (value) => String(value).padStart(2, '0');
  const monthPrefix = `${year}-${pad2(month)}`;
  const revenue = (finalStore.payments ?? [])
    .filter((payment) => payment.created_at.startsWith(monthPrefix))
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const expensesTotal = (finalStore.expenses ?? [])
    .filter((row) => row.month === month && row.year === year)
    .reduce((sum, row) => sum + row.amount_cents, 0);
  // The payroll has one implementation (Phase 6); take it from the card's own
  // tooltip and check the arithmetic instead of duplicating the formula here.
  const breakdown = strip(await page.getByTestId('kpi-net').getAttribute('title'));
  const amounts = breakdown.match(/-?[\d\s\u00A0\u202F]+[.,]\d{2}/g) ?? [];
  const [tooltipRevenue, tooltipExpenses, tooltipCompensation] = amounts.map(amountToCents);
  const compensation = tooltipCompensation;
  ok(
    'the tooltip revenue matches the revenue card',
    tooltipRevenue === revenue,
    { tooltipRevenue, revenue },
  );
  ok(
    'the tooltip expenses match the expenses page',
    tooltipExpenses === expensesTotal,
    { tooltipExpenses, expensesTotal },
  );
  const expectedNet = revenue - expensesTotal - compensation;

  const netValueText = strip(await page.getByTestId('kpi-net-value').innerText());
  ok(
    'the net card shows revenue − expenses − payroll',
    amountToCents(netValueText) === expectedNet,
    { shown: amountToCents(netValueText), expected: expectedNet, revenue, expensesTotal, compensation },
  );

  const netClass = await page.getByTestId('kpi-net-value').getAttribute('class');
  const expectedClass = expectedNet > 0 ? 'text-success' : expectedNet < 0 ? 'text-destructive' : 'text-warning';
  ok(`the net value is coloured ${expectedClass}`, String(netClass).includes(expectedClass), netClass);
  ok(
    'the tone is exposed for tests',
    (await page.locator('[data-net]').first().getAttribute('data-net')) ===
      (expectedNet > 0 ? 'positive' : expectedNet < 0 ? 'negative' : 'zero'),
    await page.locator('[data-net]').first().getAttribute('data-net'),
  );

  const tooltip = await page.getByTestId('kpi-net').getAttribute('title');
  ok(
    'the tooltip breaks the net down',
    Boolean(tooltip) && /Revenus/.test(tooltip) && /Frais/.test(tooltip) && /Salaires/.test(tooltip),
    tooltip,
  );
  ok(
    'the tooltip carries the three amounts',
    strip(tooltip).includes(strip(await page.getByTestId('kpi-revenue-value').innerText())),
    tooltip,
  );
  ok(
    'the net card shows a trend against the previous month',
    (await page.getByTestId('kpi-net-trend').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/phase11-05-dashboard-net.png` });

  // ============================================ B2: no expenses, then no data ===
  STEP = 'dashboard-no-expenses';
  // Next January has neither charges nor payments; the fixed salaries remain, so
  // the net must be exactly the negative payroll.
  await page.getByTestId('dashboard-year').selectOption(String(year + 1));
  await page.getByTestId('dashboard-month').selectOption('1');
  await page.waitForTimeout(1600);
  const noExpensesNet = amountToCents(await page.getByTestId('kpi-net-value').innerText());
  const noExpensesTooltip = strip(await page.getByTestId('kpi-net').getAttribute('title'));
  const futureAmounts = (noExpensesTooltip.match(/-?[\d\s\u00A0\u202F]+[.,]\d{2}/g) ?? []).map(
    amountToCents,
  );
  const [futureRevenue, futureExpenses, futurePayroll] = futureAmounts;
  ok(
    'a month without expenses shows 0,00 DH of expenses',
    /Frais\s*:\s*0[.,]00/.test(noExpensesTooltip) && futureExpenses === 0,
    noExpensesTooltip,
  );
  ok('a month without payments shows no revenue', futureRevenue === 0, futureRevenue);
  ok(
    'a month without expenses nets revenue − payroll',
    noExpensesNet === futureRevenue - futureExpenses - futurePayroll,
    { shown: noExpensesNet, futureRevenue, futureExpenses, futurePayroll },
  );

  // ==================================================== B3: no data → amber ===
  STEP = 'dashboard-zero-net';
  // Remove every compensation configuration for a moment: with no payments, no
  // expenses and no payroll, the month nets to exactly zero.
  await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    raw.teachers = raw.teachers.map((teacher) => ({
      ...teacher,
      compensation_mode: null,
      compensation_value_cents: 0,
      bonus_pct: null,
    }));
    localStorage.setItem(key, JSON.stringify(raw));
  }, STORE_KEY);
  await page.reload();
  await page.waitForTimeout(1500);
  await relogin(page);
  await page.getByTestId('dashboard-year').selectOption(String(year + 1));
  await page.getByTestId('dashboard-month').selectOption('1');
  await page.waitForTimeout(1600);
  const zeroNet = strip(await page.getByTestId('kpi-net-value').innerText());
  ok('an empty month nets to zero', amountToCents(zeroNet) === 0, zeroNet);
  ok(
    'a zero net is amber (break-even)',
    String(await page.getByTestId('kpi-net-value').getAttribute('class')).includes('text-warning'),
    await page.getByTestId('kpi-net-value').getAttribute('class'),
  );
  ok(
    'the zero month is labelled "Équilibre"',
    strip(await page.getByTestId('kpi-net').innerText()).includes('Équilibre'),
    strip(await page.getByTestId('kpi-net').innerText()).slice(0, 120),
  );
  await page.screenshot({ path: `${SHOTS}/phase11-06-dashboard-zero.png` });

  // Back to the real month for the Arabic pass (with the payroll restored).
  await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    raw.teachers = raw.teachers.map((teacher) => ({
      ...teacher,
      compensation_mode: teacher.full_name.includes('Mohamed') ? 'fixed_monthly' : 'hourly',
      compensation_value_cents: teacher.full_name.includes('Mohamed') ? 120000 : 15000,
    }));
    localStorage.setItem(key, JSON.stringify(raw));
  }, STORE_KEY);
  await page.reload();
  await page.waitForTimeout(1500);
  await relogin(page);

  // ======================================================== A9: Arabic/RTL ===
  STEP = 'arabic';
  const arToggle = page.locator('button', { hasText: 'AR' }).first();
  if ((await arToggle.count()) === 0) failures.push('the language toggle is missing');
  else {
    await arToggle.click();
    await page.waitForTimeout(900);
    await go(page, '/expenses');
    await page.waitForTimeout(1200);
    ok(
      'the page is translated',
      strip(await page.getByTestId('expenses-title').innerText()).includes('مصاريف الشهر'),
      strip(await page.getByTestId('expenses-title').innerText()),
    );
    const arabicTable = strip(await page.locator('[data-testid="expenses-table"]').innerText());
    ok('the category names are translated', arabicTable.includes('الكراء'), arabicTable.slice(0, 160));
    ok(
      'the document is RTL',
      (await page.evaluate(() => document.documentElement.dir)) === 'rtl',
    );
    const netDirection = await page.evaluate(() => {
      const node = document.querySelector('[data-net]');
      return node ? getComputedStyle(node).direction : 'missing';
    });
    await go(page, '/');
    await page.waitForTimeout(1200);
    ok(
      'the net card exists in Arabic too',
      /صافي الدخل/.test(strip(await page.getByTestId('kpi-net').innerText())),
      strip(await page.getByTestId('kpi-net').innerText()).slice(0, 120),
    );
    ok(
      'amounts stay LTR inside the RTL page',
      (await page.locator('[data-net]').first().evaluate((node) => getComputedStyle(node).direction)) ===
        'ltr',
      netDirection,
    );
    await page.screenshot({ path: `${SHOTS}/phase11-07-dashboard-ar.png` });
    await go(page, '/expenses');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/phase11-07-expenses-ar.png` });
  }
} catch (error) {
  failures.push(`[${STEP}] crashed: ${String(error).split('\n')[0]}`);
  console.error(`\n!! step ${STEP} crashed:`, error);
}

await browser.close();

const IGNORED = [/Failed to load resource/i, /favicon/i];
const realConsole = consoleIssues.filter((line) => !IGNORED.some((re) => re.test(line)));

console.log(`\n=== Phase 11 browser suite: ${passed} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\nFAILURES');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
if (realConsole.length > 0) {
  console.log('\nCONSOLE ISSUES');
  for (const issue of realConsole) console.log(`  ! ${issue}`);
}
process.exit(failures.length === 0 && realConsole.length === 0 ? 0 : 1);
