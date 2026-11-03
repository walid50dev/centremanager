#!/usr/bin/env node
/**
 * remove-bilan.mjs — removes the *Bilan* page from a CentreManager tree that
 * already has it (v1.5.0 as first shipped), keeping the Rentrée wizard and the
 * whole Rust backend.
 *
 *     node phase14-repair/remove-bilan.mjs [root] [--dry-run]
 *
 * What it removes — frontend only:
 *
 *   1. `src/pages/BilanPage.tsx`
 *   2. the `import BilanPage` line and the `/bilan` `<Route>` in `src/App.tsx`
 *   3. the nav item and the now-unused `BarChart3` icon in
 *      `src/components/layout/Sidebar.tsx`
 *   4. `bilanApi` in `src/services/schoolYear.ts` (the rentrée wrappers stay)
 *   5. `MonthlyBreakdown`, `TopGroup`, `TopStudent`, `BilanData` in
 *      `src/types/index.ts`
 *   6. the `cmd_get_bilan` case, `computeBilan()` and its helpers in
 *      `src/services/settingsDevBackend.ts`
 *   7. the `bilan.*` blocks and `sidebar.bilan` in `src/i18n/fr.json` + `ar.json`
 *
 * What it keeps, on purpose: `src-tauri/src/commands/bilan.rs`, the
 * `cmd_get_bilan` registration, its Rust tests, the `billan`-free schema — the
 * backend is not touched at all.
 *
 * Idempotent (a second run does nothing), backs the tree up first, and refuses
 * to half-remove: if a file cannot be cleaned it is left untouched and reported.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? process.cwd());

const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const write = (rel, text) => {
  if (DRY) return;
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const report = [];
const record = (file, status, detail = '') => {
  report.push({ file, status, detail });
  console.log(`  ${status === 'skipped' || status === 'failed' ? '✖' : '✔'} ${file} — ${status}${detail ? ` (${detail})` : ''}`);
};

console.log(`\nCentreManager — remove the Bilan page\nroot: ${root}${DRY ? '  [dry run]' : ''}\n`);

for (const required of ['package.json', 'src/App.tsx', 'src/components/layout/Sidebar.tsx']) {
  if (!existsSync(join(root, required))) {
    console.error(`Not a CentreManager tree: ${required} is missing.`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------
if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(root, `pre-remove-bilan-${stamp}`);
  mkdirSync(backup, { recursive: true });
  for (const dir of ['src', 'src-tauri/src']) {
    if (existsSync(join(root, dir))) cpSync(join(root, dir), join(backup, dir), { recursive: true });
  }
  console.log(`Backup: ${backup}`);
  console.log(`Rollback: cp -r "${backup}/src" "${root}/"\n`);
}

// ---------------------------------------------------------------------------
// 1. the page
// ---------------------------------------------------------------------------
const PAGE = 'src/pages/BilanPage.tsx';
if (!existsSync(join(root, PAGE))) {
  record(PAGE, 'present', 'already absent');
} else if (DRY) {
  record(PAGE, 'written', 'would be deleted');
} else {
  rmSync(join(root, PAGE));
  record(PAGE, 'written', 'deleted');
}

// ---------------------------------------------------------------------------
// 2. App.tsx — import + route
// ---------------------------------------------------------------------------
function cleanApp(current) {
  if (!current.includes('BilanPage')) return null;
  let next = current
    .split('\n')
    .filter((line) => !/^\s*import\s+BilanPage\s+from\s+['"].*BilanPage['"];?\s*$/.test(line))
    .join('\n');
  // the route block, from the `<Route` to its closing `/>`…
  const routeRe = /\n[ \t]*<Route\s*\n?[ \t]*path=["']\/bilan["'][\s\S]*?\n[ \t]*\/>/;
  next = next.replace(routeRe, '');
  // …and the comment that introduced it
  next = next.replace(/^[ \t]*\{\/\* Phase 14[^\n]*\*\/\}\s*\n/m, '');
  return next;
}

// ---------------------------------------------------------------------------
// 3. Sidebar.tsx — nav item + unused icon
// ---------------------------------------------------------------------------
function cleanSidebar(current) {
  if (!current.includes('sidebar.bilan')) return null;
  let next = current
    .split('\n')
    .filter((line) => !/labelKey:\s*['"]sidebar\.bilan['"]/.test(line))
    .filter((line) => !/^[ \t]*\/\/ Phase 14 — the annual summary/.test(line))
    .join('\n');
  // BarChart3 was only used by that entry
  if (!next.includes('BarChart3,'.replace(',', '')) || !/BarChart3/.test(next.replace(/^[ \t]*BarChart3,\s*$/m, ''))) {
    next = next.replace(/^[ \t]*BarChart3,\s*\n/m, '');
  }
  return next;
}

// ---------------------------------------------------------------------------
// 4. schoolYear.ts — drop bilanApi, keep the rentrée
// ---------------------------------------------------------------------------
function cleanService(current) {
  if (!current.includes('bilanApi')) return null;
  let next = current;

  // Remove the `bilanApi` object by brace matching — a regex is too fragile on
  // arrow functions and nested braces.
  const marker = 'export const bilanApi';
  const index = next.indexOf(marker);
  if (index >= 0) {
    const open = next.indexOf('{', index);
    let depth = 0;
    let close = -1;
    for (let at = open; at < next.length; at += 1) {
      if (next[at] === '{') depth += 1;
      else if (next[at] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = at;
          break;
        }
      }
    }
    if (close > 0) {
      let tail = close + 1;
      if (next[tail] === ';') tail += 1;
      while (next[tail] === '\n') tail += 1;
      next = `${next.slice(0, index).replace(/\n+$/, '\n')}\n${next.slice(tail)}`;
    }
  }

  // `BilanData` out of the type import
  next = next.replace(/import type \{([^}]*)\} from '\.\.\/types';/, (match, names) => {
    const kept = names
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && name !== 'BilanData');
    return `import type { ${kept.join(', ')} } from '../types';`;
  });

  // the doc comment mentioned both modules
  next = next.replace(
    / \* Typed wrappers for the Phase 14 commands\n \* \(`src-tauri\/src\/commands\/rentree\.rs`, `bilan\.rs`\)\./,
    ' * Typed wrappers for the school-year transition (Phase 14,\n * `src-tauri/src/commands/rentree.rs`).',
  );
  next = next.replace(/\n\n\n+/g, '\n\n');
  return next;
}

// ---------------------------------------------------------------------------
// 5. types — the four Bilan interfaces
// ---------------------------------------------------------------------------
function cleanTypes(current) {
  if (!current.includes('export interface BilanData')) return null;
  let next = current;
  for (const name of ['MonthlyBreakdown', 'TopGroup', 'TopStudent']) {
    next = next.replace(new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}\\n\\n?`), '');
  }
  next = next.replace(/export interface BilanData \{[\s\S]*?\n\}\n?/, '');
  next = next.replace('// Phase 14 — Rentrée (school year transition) & Bilan (annual summary)',
                      '// Phase 14 — Rentrée (school year transition)');
  next = next.replace(/\n\n\n+/g, '\n\n').trimEnd() + '\n';
  return next;
}

// ---------------------------------------------------------------------------
// 6. dev backend — the mock, computeBilan and the Bilan-only types
// ---------------------------------------------------------------------------
function cleanDevBackend(current) {
  if (!current.includes('cmd_get_bilan')) return null;
  let next = current;
  // the case
  next = next.replace(/\n[ \t]*case 'cmd_get_bilan': \{[\s\S]*?\n[ \t]*\}\n/, '\n');
  // the helper section, up to devInvoke
  const start = next.indexOf('// Phase 14 — annual summary');
  if (start > 0) {
    const headerStart = next.lastIndexOf('// ---', start);
    const end = next.indexOf('export async function devInvoke(');
    if (headerStart > 0 && end > start) next = next.slice(0, headerStart) + next.slice(end);
  }
  // the four Bilan-only type imports
  for (const name of ['BilanData', 'MonthlyBreakdown', 'TopGroup', 'TopStudent']) {
    next = next.replace(new RegExp(`^[ \\t]*${name},\\s*\\n`, 'm'), '');
  }
  // the section comment
  next = next.replace('    // -- Rentrée & Bilan (Phase 14) ----------------------------------------',
                      '    // -- Rentrée (Phase 14) -------------------------------------------------');
  // Only the seam of the removed case, never the file's own section spacing.
  next = next.replace(/(\n[ \t]*\}\n)\n\n(    \/\/ -- )/g, '$1\n$2');
  return next;
}

// ---------------------------------------------------------------------------
// 7. translations — the bilan block and sidebar.bilan
// ---------------------------------------------------------------------------
function cleanI18n(current) {
  const data = JSON.parse(current);
  let changed = false;
  if (data.bilan) {
    delete data.bilan;
    changed = true;
  }
  if (data.sidebar && data.sidebar.bilan) {
    delete data.sidebar.bilan;
    changed = true;
  }
  if (data.rentree && typeof data.rentree.confirmHint === 'string') {
    const hint = data.rentree.confirmHint;
    // “Rien n'est supprimé : l'année précédente reste intacte pour le bilan.”
    // → drop the trailing clause that pointed at the removed page.
    const trimmed = hint
      .replace(/\s*pour le bilan\.?$/i, '.')
      .replace(/\s*للحصيلة\.?$/, '.');
    if (trimmed !== hint) {
      data.rentree.confirmHint = trimmed;
      changed = true;
    }
  }
  return changed ? `${JSON.stringify(data, null, 2)}\n` : null;
}

const CLEANERS = {
  'src/App.tsx': cleanApp,
  'src/components/layout/Sidebar.tsx': cleanSidebar,
  'src/services/schoolYear.ts': cleanService,
  'src/types/index.ts': cleanTypes,
  'src/services/settingsDevBackend.ts': cleanDevBackend,
  'src/i18n/fr.json': cleanI18n,
  'src/i18n/ar.json': cleanI18n,
};

console.log('Cleaning the frontend');
for (const [rel, cleaner] of Object.entries(CLEANERS)) {
  const current = read(rel);
  if (current === null) {
    record(rel, 'failed', 'file not found');
    continue;
  }
  let next;
  try {
    next = cleaner(current);
  } catch (error) {
    record(rel, 'failed', `could not be cleaned — left untouched (${error.message})`);
    continue;
  }
  if (next === null || next === current) {
    record(rel, 'present', 'nothing to remove');
    continue;
  }
  write(rel, next);
  record(rel, 'written', 'Bilan removed');
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
const problems = report.filter((row) => row.status === 'failed');
console.log(`${'-'.repeat(64)}`);
console.log(`${report.filter((r) => r.status === 'written').length} file(s) modified, ${report.filter((r) => r.status === 'present').length} already clean`);
console.log('\nKept on purpose: src-tauri/src/commands/bilan.rs, cmd_get_bilan, its tests, the schema.');
if (problems.length) {
  console.log('\nLeft untouched — check these by hand:');
  for (const row of problems) console.log(`  • ${row.file} — ${row.detail}`);
  process.exit(1);
}
if (!DRY) {
  console.log('\nNext: npx tsc --noEmit && npm run check:i18n && npm run build');
  console.log('      rm -rf node_modules/.vite   # Vite caches module graphs');
}
