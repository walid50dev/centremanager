// Run: node tests/receipt-labels.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: i18n } = await server.ssrLoadModule('/src/i18n/index.ts');
  const { buildReceiptLabels, buildReceiptDocument } = await server.ssrLoadModule('/src/components/print/receiptLabels.ts');
  await i18n.changeLanguage('ar');
  const labels = buildReceiptLabels(i18n.getFixedT('fr'));
  assert.equal(labels.subject, 'Matière');
  const data = { receipt_number: 'R-1', payment_date: '2025-11-01', center_name: 'Centre', center_address: null, center_phone: null, center_logo: null, student_name: 'Salma', student_level: '2Bac', groups_text: '', amount_cents: 15000, payment_method: 'espèces', items: [{ subject: 'Maths', group_name: '2Bac PC', month: 'Novembre 2025', amount: 12000, kind: 'invoice' }, { subject: '', group_name: '', month: '', amount: 3000, kind: 'advance' }] };
  const doc = buildReceiptDocument(data, labels, '', 'Espèces');
  assert.equal(doc.items[0].amount, '120,00 DH');
  assert.equal(doc.items[1].subject, labels.advance);
  assert.equal(doc.amountText, '150,00 DH');
  assert.equal(doc.studentLevel, '2Bac');
  console.log('Receipt labels: French PDF defaults in Arabic UI, invoice and advance formatting passed');
} finally { await server.close(); }
