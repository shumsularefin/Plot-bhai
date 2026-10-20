// Fails when the initial JavaScript of the app shell exceeds the budget in CLAUDE.md
// (150 KB gzipped). "Initial" means every script index.html loads or preloads; lazily
// loaded tool chunks are listed for information only. Run after `npm run build`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const dist = new URL('../dist/', import.meta.url).pathname;

const gzipKb = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [
  ...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g),
  ...html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g),
].map((match) => match[1]);

const allJs = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => `assets/${name}`);
const lazy = allJs.filter((file) => !initial.includes(file));

const report = (files) =>
  files.reduce((sum, file) => {
    const kb = gzipKb(file);
    console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${file}`);
    return sum + kb;
  }, 0);

console.log('Initial JavaScript (gzipped):');
const total = report(initial);
console.log(`  ${total.toFixed(1).padStart(7)} KB  total, budget ${BUDGET_KB} KB`);
if (lazy.length > 0) {
  console.log('Lazy chunks (gzipped, not counted):');
  report(lazy);
}

if (initial.length === 0) {
  console.error('No scripts found in dist/index.html. Did the build run?');
  process.exit(1);
}
if (total > BUDGET_KB) {
  console.error(`Initial JavaScript is over budget by ${(total - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
console.log('Bundle size is within budget.');
