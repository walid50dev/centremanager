import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { pdf, Font } from '@react-pdf/renderer';
import { inflateSync } from 'node:zlib';
const server = await createServer({ optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Document } = await server.ssrLoadModule('/src/components/year-export/YearSummaryPdf.tsx');
  Font.getRegisteredFonts().DejaVu.sources[0].src = path.resolve('public/fonts/DejaVuSans.ttf');
  const summary = { label:'2024-2025', students:2, groups:1, teachers:1, revenue_cents:20000, expenses_cents:3000, salaries_cents:4000, net_cents:13000, subjects:[{ name:'Mathématiques', students:2, revenue_cents:20000 }] };
  const labels = { title:'Résumé 2024-2025', students:'Élèves', groups:'Groupes', teachers:'Enseignants', revenue:'Encaissements', expenses:'Dépenses', salaries:'Salaires', net:'Net', subject:'Matière', note:'Avances non ventilées par matière.' };
  const stream = await pdf(React.createElement(Document, { summary, centerName:'Centre Test', logo:null, labels, rtl:false })).toBuffer();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-'); assert.ok(buffer.length > 1000);
  if (process.env.PDF_OUT) { const fs = await import('node:fs/promises'); await fs.writeFile(process.env.PDF_OUT, buffer); }
  const binary = buffer.toString('latin1'); let textCommands = '';
  for (const match of binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { textCommands += inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { /* non-deflated stream */ }
  }
  assert.ok(textCommands.includes('BT'), 'PDF has rendered text');
  assert.match(binary, /DejaVu/i, 'embedded font supports Unicode');
  console.log('Year PDF: valid document with embedded Unicode font and text');
} finally { await server.close(); }
