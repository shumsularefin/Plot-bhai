/*
 * Builds data/thermal/atomic-weights.json from the CIAAW "Abridged Standard Atomic Weights 2024"
 * table (https://ciaaw.org/abridged-atomic-weights.htm).
 *
 *   npm run build:weights              rebuild from the cached page in data/thermal/source/
 *   npm run build:weights -- --refresh download the page again first
 *
 * Nothing is typed from memory: the values are the table cells. Elements without a standard
 * atomic weight (no stable isotope) are left out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PAGE = 'https://ciaaw.org/abridged-atomic-weights.htm';
const root = new URL('../', import.meta.url);
const cache = new URL('data/thermal/source/ciaaw-abridged-2024.html', root);
const out = new URL('data/thermal/atomic-weights.json', root);

if (process.argv.includes('--refresh') || !existsSync(cache)) {
  const response = await fetch(PAGE);
  if (!response.ok) throw new Error(`CIAAW answered ${response.status} for ${PAGE}`);
  mkdirSync(new URL('data/thermal/source/', root), { recursive: true });
  writeFileSync(cache, await response.text());
}

const html = readFileSync(cache, 'utf8');
const text = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;?/g, ' ')
  .replace(/&plusmn;/g, '±');
const row = /(?:^|\s)(\d{1,3})\s+([A-Z][a-z]?)\s+([a-z]+)\s+(\d+(?:\.\d+)?)\s*±\s*(\d+(?:\.\d+)?)/g;
const elements: { z: number; symbol: string; name: string; weight: number; uncertainty: number }[] =
  [];
for (const m of text.matchAll(row)) {
  elements.push({
    z: Number(m[1]),
    symbol: m[2] as string,
    name: m[3] as string,
    weight: Number(m[4]),
    uncertainty: Number(m[5]),
  });
}
if (elements.length < 70) throw new Error(`Only ${elements.length} elements parsed; page changed?`);

const file = {
  source: {
    citation:
      'IUPAC Commission on Isotopic Abundances and Atomic Weights (CIAAW), Abridged Standard Atomic Weights 2024',
    url: PAGE,
    year: 2024,
    retrieved: new Date().toISOString().slice(0, 10),
    note: 'Abridged values (about five significant figures), in g/mol. "uncertainty" is the ± given on the page.',
  },
  elements,
};
writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
console.log(`${elements.length} elements written.`);
