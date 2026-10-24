/*
 * Builds data/ftir/groups.json from the two tables of an open-access review (CC BY 4.0).
 *
 *   npm run build:ftir              rebuild from the cached tables in data/ftir/source/
 *   npm run build:ftir -- --refresh download the article from Europe PMC again first
 *
 * Nothing is typed from memory: the numbers are the table cells.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseFunctionalGroups, parseMetalOxides, tableWrap } from './ftir-groups-parse.ts';

const PMCID = 'PMC11821210';
const URL_XML = `https://www.ebi.ac.uk/europepmc/webservices/rest/${PMCID}/fullTextXML`;
const root = new URL('../', import.meta.url);
const sourceDir = new URL('data/ftir/source/', root);
const cache = new URL('tables.xml', sourceDir);
const out = new URL('data/ftir/groups.json', root);

if (process.argv.includes('--refresh') || !existsSync(cache)) {
  const response = await fetch(URL_XML);
  if (!response.ok) throw new Error(`Europe PMC answered ${response.status} for ${URL_XML}`);
  const xml = await response.text();
  const tables = [tableWrap(xml, 1), tableWrap(xml, 2)];
  if (tables.some((t) => !t)) throw new Error('Tables 2 and 3 were not found in the article.');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    cache,
    `<!-- Tables 2 and 3 of doi:10.3390/molecules30030684 (CC BY 4.0), from ${URL_XML}, retrieved ${new Date().toISOString().slice(0, 10)} -->\n<tables>\n${tables.join('\n')}\n</tables>\n`,
  );
}

const cached = readFileSync(cache, 'utf8');
const metalTable = tableWrap(cached, 0);
const groupTable = tableWrap(cached, 1);
if (!metalTable || !groupTable)
  throw new Error('The cached tables are damaged; run with --refresh.');
const retrieved = /retrieved (\d{4}-\d{2}-\d{2})/.exec(cached)?.[1] ?? 'unknown';

const file = {
  source: {
    citation:
      'S. Pasieczna-Patkowska, M. Cichy, J. Flieger, "Application of Fourier Transform Infrared (FTIR) Spectroscopy in Characterization of Green Synthesized Nanoparticles", Molecules 30 (2025) 684',
    doi: '10.3390/molecules30030684',
    licence: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
    url: `https://pmc.ncbi.nlm.nih.gov/articles/${PMCID}/`,
    retrieved,
    tables: 'Table 3 (functional groups) and Table 2 (metal oxides)',
  },
  verification:
    "TODO, verify: these are one review article's tables of typical ranges. Confirm each range against your own literature or a textbook before it goes into a paper.",
  functionalGroups: parseFunctionalGroups(groupTable),
  metalOxides: parseMetalOxides(metalTable),
};
writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
console.log(
  `${file.functionalGroups.length} functional group entries, ${file.metalOxides.length} metal oxide entries written.`,
);
