// Run against the default clean Vite server on :1420.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const opts = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (process.env.PLAYWRIGHT_NO_SANDBOX === '1') opts.args = ['--no-sandbox'];
const browser = await chromium.launch(opts);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const id = name => page.getByTestId(name);
const call = (cmd, args = {}) => page.evaluate(async ({ cmd, args }) => (await import('/src/services/settingsDevBackend.ts')).devInvoke(cmd, args), { cmd, args });
try {
  await page.goto(process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420');
  await page.locator('input[type=password]').first().waitFor();
  await page.evaluate(async () => (await import('/src/services/auth.ts')).authApi.setup('Centre test', 'admin123'));
  const student = await call('cmd_create_student', { data: { first_name: 'Salma', last_name: 'Essai', phone: '0661070809', guardian_phone: '0712345678', guardian_name: 'Parent Essai', level_id: 1, enrollment_date: '2026-09-01', status: 'actif' } });
  await page.reload();
  await page.locator('input[type=password]').fill('admin123');
  await page.locator('form button[type=submit]').click();
  await id('nav-students').click();
  await id(`student-whatsapp-${student}`).waitFor();

  for (const language of ['fr', 'ar']) {
    await page.evaluate(async language => (await import('/src/stores/appStore.ts')).useAppStore.getState().setLanguage(language), language);
    await page.waitForFunction(language => document.documentElement.lang === language, language);
    await id(`student-whatsapp-${student}`).waitFor();
    for (const width of [1440, 1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const table = id('students-table');
      const widths = await table.locator('thead th').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
      [180, 120, 150, 180, 140, 100, 100].forEach ( (minimum, i) => assert.ok(widths[i] >= minimum - 0.5, `${language} ${width}: column ${i} width ${widths[i]}`));
      const padding = await table.locator('tbody tr').first().locator('td').first().evaluate(node => getComputedStyle(node).paddingTop);
      assert.equal(padding, '10px');
      const scroll = await table.evaluate(node => ({ client: node.parentElement.clientWidth, scroll: node.parentElement.scrollWidth, overflow: getComputedStyle(node.parentElement).overflowX }));
      if (width === 375) { assert.equal(scroll.overflow, 'auto'); assert.ok(scroll.scroll > scroll.client); }
      for (const [kind, expected] of [['student', '06 61 07 08 09'], ['guardian', '07 12 34 56 78']]) {
        const phone = id(`${kind}-phone-text-${student}`), link = id(`${kind}-whatsapp-${student}`);
        assert.equal(await phone.textContent(), expected);
        const metrics = await phone.evaluate(node => {
          const phone = node.getBoundingClientRect(), link = node.nextElementSibling.getBoundingClientRect(), cell = node.closest('td').getBoundingClientRect();
          const a = node.nextElementSibling, style = getComputedStyle(a);
          return { whiteSpace: getComputedStyle(node).whiteSpace, direction: getComputedStyle(node.parentElement).direction, phone: { left: phone.left, right: phone.right, top: phone.top, bottom: phone.bottom }, link: { left: link.left, right: link.right, top: link.top, bottom: link.bottom, width: link.width, height: link.height }, cell: { left: cell.left, right: cell.right }, background: style.backgroundColor, radius: style.borderRadius, color: style.color, svg: !!a.querySelector('svg path') };
        });
        assert.equal(metrics.whiteSpace, 'nowrap'); assert.equal(metrics.direction, 'ltr');
        assert.ok(Math.abs(metrics.link.left - metrics.phone.right - 8) < 0.5);
        assert.ok(metrics.phone.top < metrics.link.bottom && metrics.phone.bottom > metrics.link.top);
        assert.ok(metrics.phone.left >= metrics.cell.left && metrics.link.right <= metrics.cell.right);
        assert.equal(metrics.link.width, 28); assert.equal(metrics.link.height, 28);
        assert.equal(metrics.background, 'rgb(37, 211, 102)'); assert.equal(metrics.color, 'rgb(255, 255, 255)'); assert.equal(metrics.radius, '9999px'); assert.ok(metrics.svg);
        assert.equal(await link.getAttribute('title'), language === 'fr' ? 'Envoyer un message WhatsApp' : 'إرسال رسالة عبر واتساب');
        assert.ok((await link.getAttribute('aria-label')).includes(language === 'fr' ? 'Envoyer un message WhatsApp' : 'إرسال رسالة عبر واتساب'));
        assert.equal(new URL(await link.getAttribute('href')).pathname, kind === 'student' ? '/212661070809' : '/212712345678');
      }
    }
  }
  // Links should not activate the surrounding row, including keyboard activation.
  await page.evaluate(() => document.querySelectorAll('[data-testid*="-whatsapp-"]').forEach(a => a.addEventListener('click', e => e.preventDefault())));
  const url = page.url();
  for (const kind of ['student', 'guardian']) {
    const link = id(`${kind}-whatsapp-${student}`);
    await link.click(); assert.equal(page.url(), url);
    await link.focus(); await page.keyboard.press('Enter'); assert.equal(page.url(), url);
  }
  console.log('Browser: student table geometry, compact WhatsApp links, accessibility and row isolation passed in FR/AR at desktop and mobile widths.');
} finally { await browser.close(); }
