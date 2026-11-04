// Run: node tests/receipt-pdf.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { inflateSync } from 'node:zlib';
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: A4 } = await server.ssrLoadModule('/src/components/print/ReceiptA4.tsx');
  const { default: Thermal, wrapValue } = await server.ssrLoadModule('/src/components/print/ReceiptThermal.tsx');
  const labels = { heading: 'RECU DE PAIEMENT', shortHeading: 'RECU', number: 'No', date: 'Date', student: 'Eleve', level: 'Niveau', subject: 'Matiere', group: 'Groupe', month: 'Mois', amount: 'Montant', total: 'TOTAL', method: 'Mode', studentInfo: 'Informations eleve', paymentDetails: 'Details du paiement', signature: 'Signature', thanks: 'Merci', thankYouShort: 'Merci', groups: 'Groupes', period: 'Periode', advance: 'Avance', unavailable: 'Details indisponibles', centerFallback: 'CentreManager' };
  // Tiny valid PNG.
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const data = { receiptNumber: 'REC-20251101-0001', dateText: '01/11/2025', centerName: 'Centre Test', centerAddress: '', centerPhone: '', logo, studentName: 'Salma', studentLevel: '2Bac', groupsText: '', periodText: '', amountText: '800.00 DH', methodText: 'Especes', items: [
    { subject: 'Maths', group: '2Bac PC', month: 'Novembre 2025', amount: '400.00 DH' },
    { subject: 'Physique', group: '2Bac PC', month: 'Novembre 2025', amount: '350.00 DH' },
    { subject: 'Chimie', group: '2Bac PC', month: 'Novembre 2025', amount: '50.00 DH' },
  ] };
  const render = async Component => {
    const stream = await pdf(React.createElement(Component, { data, labels })).toBuffer();
    const buffers = []; for await (const part of stream) buffers.push(part);
    return Buffer.concat(buffers);
  };
  for (const [name, component] of [['A4', A4], ['thermal', Thermal]]) {
    const buffer = await render(component);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buffer.length > 1000, `${name} PDF generated`);
    // Confirm the PDF contains drawing commands, including compressed streams.
    let decodedStreams = 0;
    let decoded = '';
    const binary = buffer.toString('latin1');
    for (const match of binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try { const stream = inflateSync(Buffer.from(match[1], 'latin1')); if (stream.length) { decodedStreams++; decoded += stream.toString('latin1'); } } catch { /* not deflated */ }
    }
    assert.ok(decodedStreams > 0, `${name} has content streams`);
    const text = [...decoded.matchAll(/BT([\s\S]*?)ET/g)].map(part => [...part[1].matchAll(/<([0-9a-f]+)>/gi)].map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join('')).join(' ').replace(/\s+/g, ' ');
    for (const value of ['Maths', 'Physique', 'Chimie', 'Novembre 2025', '400.00 DH', '350.00 DH', '50.00 DH', '800.00 DH', 'Salma']) assert.ok(text.includes(value), `${name}: missing ${value} in ${text}`);
    assert.equal(decoded.includes('/I1 Do'), name === 'A4', 'only A4 embeds the logo');
  }
  data.logo = null;
  assert.ok((await render(A4)).length > 1000, 'A4 PDF renders without logo');
  const longWord = 'a'.repeat(80);
  assert.equal(wrapValue(longWord, 20).join(''), longWord, 'thermal words are not truncated');
  console.log('PDF: A4 with PNG and thermal documents rendered with multiple payment lines');
} finally { await server.close(); }
