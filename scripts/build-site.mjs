import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const out = path.resolve('_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const entry of ['index.html', 'css', 'js', 'vendor']) {
  cpSync(entry, path.join(out, entry), { recursive: true });
}

writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${path.relative(process.cwd(), out)}`);
