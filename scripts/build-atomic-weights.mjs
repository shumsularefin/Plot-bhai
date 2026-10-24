// Builds data/thermal/atomic-weights.json from the saved CIAAW abridged table
// (data/thermal/source/abridged-atomic-weights.html, https://ciaaw.org/abridged-atomic-weights.htm).
// Only rows with a printed value and uncertainty are kept; no value is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('data/thermal/source/abridged-atomic-weights.html', 'utf8');
const text = html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;?/g, ' ')
  .replace(/&plusmn;?/g, '±');
const weights = {};
for (const line of text.split('\n')) {
  const m = line.trim().match(/^(\d+)\s+([A-Z][a-z]?)\s+([a-z]+)\s+([\d.]+)\s+±\s+([\d.]+)/);
  if (m)
    weights[m[2]] = {
      z: Number(m[1]),
      name: m[3],
      weight: Number(m[4]),
      uncertainty: Number(m[5]),
    };
}
const out = {
  source: {
    citation: 'CIAAW, Abridged Standard Atomic Weights 2024',
    url: 'https://ciaaw.org/abridged-atomic-weights.htm',
    note: 'Abridged (conventional) values, five digits as recommended by the Commission in 2013. Unit: g/mol.',
    retrieved: '2026-10-24',
  },
  verification:
    'TODO, verify: copied by script from the saved page. Compare a few elements with the current CIAAW table before publishing.',
  elements: weights,
};
writeFileSync('data/thermal/atomic-weights.json', JSON.stringify(out, null, 1) + '\n');
console.log(Object.keys(weights).length, 'elements');
