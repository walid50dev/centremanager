/**
 * Phase 9 — final edge cases, demo data and release smoke test.
 * Temporary browser suite (deleted after the phase).
 *
 * Runs against the Vite dev server with the localStorage backend.
 * Headed, because the receipt viewer (`PDFViewer`) needs a real engine.
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

const browser = await chromium.launch({ headless: false });

async function login(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
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
  // React Router ignores a popstate to the current route: bounce through '/'.
  const same = await page.evaluate((target) => window.location.pathname === target, path);
  if (same) {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(350);
  }
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(900);
}

const store = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);

let STEP = 'login';

try {
  const { context, page } = await login();

  // =============================================== Part 2: demo data seed ===
  STEP = 'demo-seed';
  await go(page, '/settings');
  // Settings sections are collapsible: open "Sauvegarde" first.
  await page.getByRole('button', { name: /^Sauvegarde/ }).click();
  await page.waitForTimeout(700);
  const seedButton = page.getByTestId('seed-demo-data');
  await seedButton.waitFor({ timeout: 15000 });
  ok('the demo button lives in Settings → Sauvegarde', (await seedButton.count()) === 1);
  await page.screenshot({ path: `${SHOTS}/demo-01-settings-button.png` });

  await seedButton.click();
  await page.waitForTimeout(600);
  const confirmDialog = page.locator('[role="dialog"]');
  ok('the demo seed asks for confirmation', (await confirmDialog.count()) === 1);
  ok(
    'the confirmation explains what will be added',
    strip(await confirmDialog.innerText()).includes('15 élèves'),
    strip(await confirmDialog.innerText()).slice(0, 120),
  );
  await page.screenshot({ path: `${SHOTS}/demo-02-confirm.png` });

  await confirmDialog.getByRole('button', { name: /^Charger$/ }).click();
  await page.waitForTimeout(1200);
  const seedToast = strip(await page.locator('[role="status"]').first().innerText().catch(() => ''));
  ok(
    'the seed reports the specified summary in a toast',
    seedToast.includes('Demo data: 15 students, 5 teachers, 8 groups') &&
      /invoices/.test(seedToast) &&
      /payments/.test(seedToast),
    seedToast.slice(0, 160),
  );
  // No reload: the session survives, and each page picks the data up on mount.
  await page.waitForTimeout(1500);
  ok(
    'the user stays logged in after seeding',
    (await page.getByLabel('Mot de passe', { exact: true }).count()) === 0,
  );

  const seeded = await store(page);
  ok('15 demo students', seeded.students.length === 15, seeded.students.length);
  ok('5 demo teachers', seeded.teachers.length === 5, seeded.teachers.length);
  ok('8 demo groups', seeded.groups.length === 8, seeded.groups.length);
  ok(
    'the four compensation modes are used',
    new Set(seeded.teachers.map((teacher) => teacher.compensation_mode)).size === 4,
    seeded.teachers.map((teacher) => teacher.compensation_mode),
  );
  ok('invoices were generated for two months', seeded.invoices.length >= 40, seeded.invoices.length);
  const currentMonth = new Date().getMonth() + 1;
  const currentInvoices = seeded.invoices.filter((invoice) => invoice.period_month === currentMonth);
  const collected = currentInvoices.reduce((sum, invoice) => sum + invoice.paid_amount_cents, 0);
  const billed = currentInvoices.reduce((sum, invoice) => sum + invoice.amount_cents, 0);
  const rate = billed ? collected / billed : 0;
  ok('the current month is collected around 60 %', rate > 0.45 && rate < 0.75, rate.toFixed(2));
  ok(
    'the previous month is left unpaid (late invoices)',
    seeded.invoices
      .filter((invoice) => invoice.period_month !== currentMonth)
      .every((invoice) => invoice.paid_amount_cents === 0),
  );
  ok('activities were recorded', seeded.teacherActivities.length >= 25, seeded.teacherActivities.length);
  ok('two settlements exist', seeded.teacherSettlements.length === 2, seeded.teacherSettlements.length);

  // The UI reflects the seeded data.
  await go(page, '/');
  await page.waitForTimeout(800);
  ok(
    'the dashboard counts the demo students',
    strip(await page.getByTestId('kpi-students-value').innerText()) === '15',
    strip(await page.getByTestId('kpi-students-value').innerText()),
  );
  ok(
    'the dashboard shows échéances',
    Number(strip(await page.getByTestId('dashboard-alerts-count').innerText())) > 0,
    strip(await page.getByTestId('dashboard-alerts-count').innerText()),
  );
  await page.screenshot({ path: `${SHOTS}/demo-03-dashboard.png` });

  await go(page, '/students');
  ok('the students page lists 15 rows', (await page.locator('tbody tr').count()) === 15);
  await go(page, '/teachers');
  await page.waitForTimeout(600);
  ok('the teachers page lists 5 cards', (await page.locator('[data-testid^="teacher-card-"]').count()) === 5);
  await go(page, '/groups');
  await page.waitForTimeout(600);
  ok('the groups page lists 8 cards', (await page.locator('[data-testid^="group-card-"]').count()) === 8);

  await go(page, '/payments');
  ok('the payments page has late rows', (await page.getByTestId('payment-collect').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/demo-04-payments.png` });
  const badgeText = strip(await page.getByTestId('sidebar-late-badge').innerText());
  const lateCount = seeded.invoices.filter(
    (invoice) => invoice.status !== 'payé' && invoice.due_date < new Date().toISOString().slice(0, 10),
  ).length;
  ok(
    'the sidebar badge counts the demo late invoices',
    badgeText === (lateCount > 9 ? '9+' : String(lateCount)),
    { badgeText, lateCount },
  );

  // ==================================== Case 15: Arabic name, French UI ===
  STEP = 'arabic-name';
  const arabicName = 'أحمد بن علي';
  await page.evaluate(async (name) => {
    const { studentsApi } = await import('/src/services/students.ts');
    await studentsApi.create({
      full_name: name,
      phone: '0612345678',
      parent_phone: null,
      date_of_birth: null,
      level_id: 10,
      branch_id: null,
      address: null,
      notes: null,
    });
  }, arabicName);

  await go(page, '/students');
  await page.getByTestId('students-search').fill('أحمد');
  await page.waitForTimeout(900);
  const arabicRow = page.locator('tbody tr').first();
  const rowText = strip(await arabicRow.innerText());
  ok('the Arabic name is stored and searchable', rowText.includes(arabicName), rowText.slice(0, 80));
  const overflow = await arabicRow.evaluate((node) => {
    const cell = node.querySelector('td');
    return { scroll: cell?.scrollWidth ?? 0, client: cell?.clientWidth ?? 0 };
  });
  ok(
    'the Arabic name does not overflow its cell',
    overflow.scroll <= overflow.client + 1,
    overflow,
  );
  ok(
    'no horizontal overflow on the page',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await page.screenshot({ path: `${SHOTS}/edge-01-arabic-name.png` });

  const arabicStudentId = (await store(page)).students.find((s) => s.full_name === arabicName).id;
  await go(page, `/students/${arabicStudentId}`);
  await page.waitForTimeout(900);
  ok(
    'the student sheet shows the Arabic name',
    strip(await page.locator('main').innerText()).includes(arabicName),
  );

  // ============================ Case 16: LTR phone inside the Arabic UI ===
  STEP = 'ltr-phone';
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.waitForTimeout(1200);
  ok('the UI switched to RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');

  await go(page, '/payments');
  await page.getByTestId('payment-collect').first().click();
  await page.waitForTimeout(1200);
  // The per-row "Encaisser" opens the modal at step 2, student preselected.

  const studentLine = page.locator('[role="dialog"]').locator('span[dir="ltr"]').first();
  const phoneText = strip(await studentLine.innerText());
  const phoneDirection = await studentLine.evaluate((node) => getComputedStyle(node).direction);
  ok('the phone is rendered as an LTR run', phoneDirection === 'ltr', phoneDirection);
  ok(
    'the phone reads left-to-right, digits unchanged',
    /^—?\s*0[67]\d{8}$/.test(phoneText.replace(/\s+/g, ' ').trim()),
    phoneText,
  );
  ok(
    'a separator keeps the phone away from the name',
    phoneText.includes('—'),
    phoneText,
  );
  await page.screenshot({ path: `${SHOTS}/edge-02-rtl-phone.png` });

  // ================================== Case 20: double click on a payment ==
  STEP = 'double-click';
  await page.getByTestId('payment-next').click(); // step 2 → 3 (invoices)
  await page.waitForTimeout(900);
  // The amount the modal is about to record, straight from the field.
  const amountRaw = await page.getByTestId('payment-amount').inputValue();
  const expectedCents = Math.round(
    Number.parseFloat(amountRaw.replace(/[^\d.,]/g, '').replace(/,/g, '')) * 100,
  );
  await page.getByTestId('payment-next').click(); // step 3 → 4 (confirmation)
  await page.waitForTimeout(900);

  // One payment action writes one row per settled invoice, so the money is the
  // honest counter: a duplicated record shows up as twice the amount.
  const paidSum = async () =>
    (await store(page)).invoices.reduce((total, invoice) => total + invoice.paid_amount_cents, 0);
  const before = await paidSum();
  const confirm = page.getByTestId('payment-confirm');
  await confirm.click();
  // Second click as fast as a nervous user would send it.
  await confirm.click({ force: true, timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const after = await paidSum();
  ok(
    'a double click records a single payment',
    after - before === expectedCents,
    { expectedCents, recorded: after - before },
  );
  const doubleToast = await page.locator('[role="status"]').count();
  ok('only one confirmation toast', doubleToast <= 1, doubleToast);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Français' }).click();
  await page.waitForTimeout(1000);

  // ============================ Case 18: deactivated teacher, live groups ==
  STEP = 'teacher-deactivation';
  const teacherId = (await store(page)).teachers[0].id;
  const teacherName = (await store(page)).teachers[0].full_name;
  await page.evaluate(async (id) => {
    const { teachersApi } = await import('/src/services/teachers.ts');
    await teachersApi.setStatus(id, 'inactif');
  }, teacherId);

  await go(page, '/groups');
  const firstCard = page.locator('[data-testid^="group-card-"]').first();
  await firstCard.waitFor({ timeout: 15000 }).catch(() => {});
  const groupCards = await page.locator('[data-testid^="group-card-"]').count();
  ok('the groups page still renders all 8 groups', groupCards === 8, groupCards);
  ok(
    'the deactivated teacher is still named on their groups',
    strip(await page.locator('main').innerText()).includes(teacherName),
    teacherName,
  );
  ok('no error boundary was triggered', (await page.getByTestId('error-boundary').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/edge-03-inactive-teacher.png` });

  // ==================================== Regression: Phase 0–8 still fine ==
  STEP = 'regression';
  await go(page, '/__error');
  ok('the error boundary still catches', (await page.getByTestId('error-boundary').count()) === 1);
  await go(page, '/students');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  ok(
    'Ctrl+K still focuses the search',
    await page.getByTestId('students-search').evaluate((node) => node === document.activeElement),
  );

  await go(page, '/payments');
  await page.getByTestId('payment-collect').first().click();
  await page.waitForTimeout(1400);
  await page.getByTestId('payment-next').click();
  await page.waitForTimeout(900);
  await page.getByTestId('payment-next').click();
  await page.waitForTimeout(900);
  await page.getByTestId('payment-confirm-print').click();
  await page.waitForTimeout(3500);
  ok('the receipt modal still opens', (await page.getByTestId('receipt-preview').count()) === 1);
  ok(
    'the PDF viewer is still mounted inline',
    (await page.locator('[data-testid="receipt-preview"] iframe').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/edge-04-receipt-regression.png` });
  await page.getByTestId('receipt-template-thermal').click();
  await page.waitForTimeout(1500);
  ok(
    'the thermal template still renders',
    (await page.getByTestId('receipt-preview').getAttribute('data-template')) === 'thermal',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'العربية' }).click();
  await page.waitForTimeout(1200);
  ok('Arabic still mirrors the layout', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  await page.screenshot({ path: `${SHOTS}/edge-05-rtl-payments.png` });
  await go(page, '/');
  await page.waitForTimeout(800);
  ok(
    'the dashboard renders in Arabic',
    strip(await page.locator('main').innerText()).length > 50,
  );

  await context.close();

  // ------------------------------------------- small viewport (min size) ---
  const { context: narrowCtx, page: narrow } = await login({ width: 900, height: 600 });
  await narrow.waitForTimeout(1200);
  ok(
    'the 900 × 600 minimum window has no horizontal scroll',
    await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await narrow.screenshot({ path: `${SHOTS}/edge-06-min-window.png` });
  await narrowCtx.close();
} catch (error) {
  failures.push(`CRASH[${STEP}] — ${error instanceof Error ? error.message : String(error)}`);
}

await browser.close();

const expected = consoleIssues.filter((line) => /Boom|DevCrashPage|error-boundary-demo|ErrorBoundary/.test(line));
const unexpected = consoleIssues.filter((line) => !expected.includes(line));
console.log(
  JSON.stringify(
    {
      passed,
      failed: failures,
      consoleErrors: unexpected,
      expectedConsoleErrors: expected.length,
    },
    null,
    2,
  ),
);
