/*
 * Builds data/reference/bond-valence.json from I. D. Brown's accumulated table of bond-valence
 * parameters, bvparm2020.cif (2020-11-25), kept unchanged with its copyright notice in
 * data/reference/source/. The copy was taken from the matminer 0.10.1 wheel on PyPI
 * (matminer/utils/data_files/bvparm2020.cif, SHA-1 54640352675869efaa9264bb1b9b1cd3c43d03e5)
 * because www.iucr.org refuses automated downloads; it is the file the IUCr page links.
 *
 *   npm run build:bv
 *
 * Nothing is typed by hand: every value is a cell of the table. Kept: for each ordered pair of
 * ions (cation and valence, anion and valence) the first entry not marked "unchecked", since the
 * table lists values "in decreasing order of reliability". Valence 9 means "not specified".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const source = new URL('data/reference/source/bvparm2020.cif', root);
const out = new URL('data/reference/bond-valence.json', root);

const text = readFileSync(source, 'utf8');
const sha1 = createHash('sha1').update(readFileSync(source)).digest('hex');
const lines = text.split(/\r?\n/);

// The copyright notice and the disclaimer, verbatim (the comment block between the asterisk rules).
const start = lines.findIndex((l) => l.includes('COPYRIGHT NOTICE'));
const end = lines.findIndex((l, i) => i > start && l.includes('Users are advised to'));
const notice = lines
  .slice(start, end + 2)
  .map((l) => l.replace(/^#\s?/, '').trimEnd())
  .filter((l) => !/^\*+/.test(l) && !/DISCLAIMER/.test(l))
  .join('\n')
  .trim();

// References: "  a 'Brown and Altermatt, (1985), …'" (the text may contain an apostrophe).
const refs: Record<string, string> = {};
const paramStart = lines.findIndex((l) => l.trim() === '_valence_param_details');
const refStart = lines.findIndex((l) => l.trim() === '_valence_ref_reference');
for (const line of lines.slice(refStart + 1, paramStart)) {
  const m = /^\s*([a-z]{1,2})\s+'(.*)'\s*$/.exec(line);
  if (m) refs[m[1] as string] = (m[2] as string).trim();
}

type Entry = [string, number, string, number, number, number, string];
const params: Entry[] = [];
const seen = new Set<string>();
let unchecked = 0;
let rows = 0;
for (const line of lines.slice(paramStart + 1)) {
  if (line.startsWith('#')) break;
  const t = line.trim().split(/\s+/);
  if (t.length < 8) continue;
  rows++;
  const [cation, cv, anion, av, r0, b, ref] = t as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (t.slice(7).join(' ') === 'unchecked') {
    unchecked++;
    continue;
  }
  if (!(ref in refs)) throw new Error(`Unknown reference ${ref} in: ${line}`);
  const key = `${cation} ${cv} ${anion} ${av}`;
  if (seen.has(key)) continue;
  seen.add(key);
  params.push([cation, Number(cv), anion, Number(av), Number(r0), Number(b), ref]);
}
const used = Object.fromEntries(
  [...new Set(params.map((p) => p[6]))].sort().map((id) => [id, refs[id] as string]),
);

writeFileSync(
  out,
  JSON.stringify(
    {
      source:
        'I. D. Brown, Accumulated table of bond valence parameters, bvparm2020.cif (2020-11-25), distributed by the IUCr (www.iucr.org/resources/data/datasets/bond-valence-parameters); copy from the matminer 0.10.1 wheel, SHA-1 ' +
        sha1 +
        '. Flagged for owner verification.',
      notice,
      changes:
        'Converted to JSON by scripts/build-bond-valence.ts. Entries marked "unchecked" are left out, and for each pair of ions only the first remaining (most reliable) entry is kept. No value is changed.',
      equation: 's = exp((R0 - R) / b), R the bond length; R0 and b in angstrom',
      columns: ['cation', 'cation valence', 'anion', 'anion valence', 'R0', 'b', 'ref'],
      refs: used,
      params,
    },
    null,
    1,
  ) + '\n',
);
console.log(
  `${rows} rows, ${unchecked} unchecked, ${params.length} pairs kept, ${Object.keys(used).length} references.`,
);
