import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] || '_site');
const failures = [];

function fail(message) {
  failures.push(message);
}

function isRemote(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function checkReference(value, baseDir, context) {
  const ref = value.trim();
  if (!ref || ref.startsWith('#') || isRemote(ref)) return null;

  if (ref.startsWith('/')) {
    fail(`${context}: absolute path "${ref}" will break on the GitHub Pages subpath`);
    return null;
  }

  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;

  const resolved = path.resolve(baseDir, clean);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    fail(`${context}: path escapes the site root: "${ref}"`);
    return null;
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    fail(`${context}: missing "${ref}"`);
    return null;
  }

  return resolved;
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Site directory not found: ${root}`);
  process.exit(1);
}

const indexPath = path.join(root, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`Missing ${indexPath}`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const references = Array.from(html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi), (match) => match[2]);
const loadedScripts = new Set();
let checked = 0;

for (const ref of references) {
  const resolved = checkReference(ref, root, 'index.html');
  if (!resolved) continue;
  checked++;

  const clean = ref.split('#')[0].split('?')[0];
  const relative = path.relative(root, resolved).split(path.sep).join('/');

  if (clean.endsWith('.js')) loadedScripts.add(relative);

  if (clean.endsWith('.css')) {
    const css = readFileSync(resolved, 'utf8');
    const cssRefs = Array.from(css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi), (match) => match[2]);
    for (const cssRef of cssRefs) {
      if (cssRef.trim().startsWith('data:')) continue;
      if (checkReference(cssRef, path.dirname(resolved), relative)) checked++;
    }
  }
}

const jsDir = path.join(root, 'js');
if (!existsSync(jsDir)) {
  fail('Missing js/ directory');
} else {
  for (const file of readdirSync(jsDir).filter((name) => name.endsWith('.js'))) {
    const relative = path.posix.join('js', file);
    if (!loadedScripts.has(relative)) {
      fail(`index.html: module "${relative}" is not loaded`);
    }
  }
}

// Tower artwork is referenced from classic scripts, so HTML/CSS scans alone
// cannot catch an icon omitted from the offline / GitHub Pages package.
const towersPath = path.join(jsDir, 'towers.js');
if (existsSync(towersPath)) {
  const source = readFileSync(towersPath, 'utf8');
  for (const match of source.matchAll(/\bid: '([^']+)'/g)) {
    if (checkReference(`assets/towers/${match[1]}.png`, root, 'js/towers.js')) checked++;
  }
}

// Training icons are also created dynamically, including the builder-only card.
const upgradeMenuPath = path.join(jsDir, 'upgrade-menu.js');
if (existsSync(upgradeMenuPath)) {
  const source = readFileSync(upgradeMenuPath, 'utf8');
  for (const match of source.matchAll(/['"](assets\/upgrades\/[^'"]+\.png)['"]/g)) {
    if (checkReference(match[1], root, 'js/upgrade-menu.js')) checked++;
  }
}

if (failures.length) {
  console.error('Static site check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Checked ${checked} local asset reference${checked === 1 ? '' : 's'} in ${path.relative(process.cwd(), root) || '.'}.`);
