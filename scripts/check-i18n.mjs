#!/usr/bin/env node
/**
 * Check translation parity, missing lookups and likely unused keys.
 *
 * Every string literal in source/tests counts as a possible indirect key (for
 * label maps etc.). Template literal prefixes count as potentially used, so
 * e.g. `t(`groups.dayNames.${day}`)` keeps the whole dynamic family. Plural
 * variants are grouped only when a `_one` form exists. This conservative
 * static audit is not a proof for arbitrary runtime-generated keys: when adding
 * such a lookup, keep its possible keys or a matching template prefix in source.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.indexOf('--root');
const root = rootArg < 0 ? defaultRoot : resolve(process.argv[rootArg + 1]);
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.set(path, value);
  }
  return out;
}
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx|js|jsx|mjs)$/.test(path) ? [path] : [];
  });
}

const locales = Object.fromEntries(['fr', 'ar'].map(lang => [lang,
  flatten(JSON.parse(readFileSync(join(root, 'src/i18n', `${lang}.json`), 'utf8'))),
]));
const allKeys = new Set([...locales.fr.keys(), ...locales.ar.keys()]);
const pluralBases = new Set([...allKeys].filter(key => key.endsWith('_one')).map(key => key.slice(0, -4)));
const base = key => {
  const stripped = key.replace(pluralSuffix, '');
  return pluralBases.has(stripped) ? stripped : key;
};
const has = (keys, key) => keys.has(key) ||
  [...keys.keys()].some(path => path.startsWith(`${key}.`)) ||
  (pluralBases.has(key) && keys.has(`${key}_one`) && keys.has(`${key}_other`));

const literals = new Set();
const prefixes = new Set();
const directLookups = new Map();
for (const file of [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'tests'))]) {
  const source = readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : undefined;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  function directKeys(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!directLookups.has(node.text)) directLookups.set(node.text, relative(root, file));
    } else if (ts.isConditionalExpression(node)) {
      directKeys(node.whenTrue);
      directKeys(node.whenFalse);
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) directKeys(element);
    }
  }
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
    if (ts.isTemplateExpression(node) && node.head.text) prefixes.add(node.head.text);
    // Also retain families built with a literal prefix plus a runtime value.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (ts.isStringLiteral(node.left) || ts.isNoSubstitutionTemplateLiteral(node.left)) && node.left.text) prefixes.add(node.left.text);
    if (ts.isCallExpression(node) && node.arguments.length &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
         (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) {
      directKeys(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const isReferenced = key => literals.has(key) || literals.has(base(key)) ||
  [...prefixes].some(prefix => key.startsWith(prefix)) ||
  // An object requested as a whole via returnObjects also uses its children.
  [...directLookups.keys()].some(literal => key.startsWith(`${literal}.`));

let failed = false;
const bases = Object.fromEntries(Object.entries(locales).map(([lang, keys]) => [lang, new Set([...keys.keys()].map(base))]));
for (const [lang, other] of [['fr', 'ar'], ['ar', 'fr']]) {
  const missing = [...directLookups].filter(([key]) => !has(locales[lang], key));
  const missingParity = [...bases[other]].filter(key => !bases[lang].has(key)).sort();
  const orphans = [...locales[lang].keys()].filter(key => !isReferenced(key)).sort();
  const requiredForms = lang === 'ar' ? ['zero', 'one', 'two', 'few', 'many', 'other'] : ['one', 'other'];
  const incompletePlurals = [...pluralBases].filter(key => [...locales[lang].keys()].some(k => base(k) === key) && requiredForms.some(form => !locales[lang].has(`${key}_${form}`)));
  console.log(`${lang}: ${locales[lang].size} clés, ${missing.length} référence(s) manquante(s), ${missingParity.length} différence(s) de parité, ${orphans.length} clé(s) orpheline(s) probable(s)`);
  for (const [key, file] of missing) console.error(`  - référence absente : ${key} (${file})`);
  for (const key of missingParity) console.error(`  - traduction absente : ${key}`);
  for (const key of incompletePlurals) console.error(`  - pluriel incomplet : ${key}`);
  for (const key of orphans) console.error(`  - clé orpheline probable : ${key}`);
  if (missing.length || missingParity.length || incompletePlurals.length || orphans.length) failed = true;
}
if (failed) process.exitCode = 1;
