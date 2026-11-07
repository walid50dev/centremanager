// Run with: node tests/screenshot-files.mjs
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const files = (await readdir('screenshots')).filter(name => name.endsWith('.png')).sort();
assert.ok(files.length >= 43, 'expected at least 43 PNG captures');
for (let index = 1; index <= 43; index++) {
  const prefix = `${String(index).padStart(2, '0')}-`;
  const found = files.filter(name => name.startsWith(prefix));
  assert.equal(found.length, 1, `expected exactly one ${prefix} capture`);
  const header = (await readFile(`screenshots/${found[0]}`)).subarray(0, 24);
  assert.deepEqual(header.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'), `${found[0]} PNG signature`);
  assert.equal(header.readUInt32BE(16), 1280, `${found[0]} width`);
  assert.equal(header.readUInt32BE(20), 800, `${found[0]} height`);
}
console.log('43 captures PNG de 1280 × 800 vérifiées.');
