// Fails if shipped code or tests contain TODO/FIXME/XXX markers or disabled tests (.skip/.only/.todo).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'tests', 'public', 'index.html'];
const bad = [];
const markers = new RegExp(['TO' + 'DO', 'FIX' + 'ME', 'X' + 'XX'].map((m) => `\\b${m}\\b`).join('|'));
const disabled = /\b(it|test|describe)\.(skip|only|todo|fixme)\b|\btest\.fixme\b/;
function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) if (!f.endsWith('-snapshots')) walk(join(p, f));
  } else if (/\.(ts|js|mjs|css|html|json|webmanifest)$/.test(p)) {
    readFileSync(p, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (markers.test(line) || disabled.test(line)) bad.push(`${p}:${i + 1}: ${line.trim()}`);
      });
  }
}
for (const r of roots) {
  try {
    walk(r);
  } catch {
    /* root may not exist yet */
  }
}
if (bad.length) {
  console.error('Forbidden markers found:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('no-todo: clean');
