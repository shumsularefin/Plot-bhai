/*
 * Builds data/ftir/groups.json from the two tables of an open-access review (CC BY 4.0), and from
 * three more open tables (CC BY) whose text is cached in data/ftir/source/*.txt (the PDFs were
 * supplied by the owner; the cache records the pdftotext command).
 *
 *   npm run build:ftir              rebuild from the cached tables in data/ftir/source/
 *   npm run build:ftir -- --refresh download the article from Europe PMC again first
 *
 * Nothing is typed from memory: the numbers are the table cells.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  parseAlAmin,
  parseElgayyar,
  parseFunctionalGroups,
  parseGautam,
  parseMetalOxides,
  tableWrap,
} from './ftir-groups-parse.ts';

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

const text = (name: string) => readFileSync(new URL(name, sourceDir), 'utf8');
const SAME_CHECK = 'confirm a range against your own literature before it goes into a paper.';

const file = {
  sources: {
    'pasieczna-2025': {
      short: 'Pasieczna-Patkowska et al. 2025, Table 3 or 2',
      citation:
        'S. Pasieczna-Patkowska, M. Cichy, J. Flieger, "Application of Fourier Transform Infrared (FTIR) Spectroscopy in Characterization of Green Synthesized Nanoparticles", Molecules 30 (2025) 684',
      doi: '10.3390/molecules30030684',
      licence: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${PMCID}/`,
      retrieved,
      tables: 'Table 3 (functional groups) and Table 2 (metal oxides)',
      verification: `Transcription checked on 2026-10-28: all 65 functional-group rows and 13 metal-oxide rows match Tables 3 and 2 of the article (PubMed Central full text). These are one review's typical ranges, not a textbook table: ${SAME_CHECK}`,
    },
    'al-amin-2025': {
      short: 'Al-Amin et al. 2025, Table 1',
      citation:
        'K. Al-Amin, Md. Kawsar, Md. T. R. B. Mamun, Md. S. Hossain, "Fourier transform infrared spectroscopic technique for analysis of inorganic materials: a review", Nanoscale Adv. 7 (2025) 6677–6702',
      doi: '10.1039/d5na00522a',
      licence: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
      url: 'https://doi.org/10.1039/d5na00522a',
      retrieved: '2026-11-15',
      tables: 'Table 1 (FTIR spectroscopy absorption table), inorganic materials',
      verification: `Transcription checked on 2026-11-15: all 27 rows match Table 1 of the PDF, read against the rendered page. Wide ranges for whole classes (for example M–O, 400–1000 cm⁻¹): ${SAME_CHECK}`,
    },
    'elgayyar-2025': {
      short: 'Elgayyar et al. 2025, Table 1 (carbonate)',
      citation:
        'T. Elgayyar, F. Azzolina-Jury, F. Thibault-Starzyk, "Infrared spectroscopy at the surface of carbonates", Phys. Chem. Chem. Phys. 27 (2025) 22871–22879',
      doi: '10.1039/d5cp02197a',
      licence: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
      url: 'https://doi.org/10.1039/d5cp02197a',
      retrieved: '2026-11-15',
      tables:
        'Table 1 (approximate IR frequency ranges of the four fundamental modes of carbonate)',
      verification: `Transcription checked on 2026-11-15: the four modes match Table 1 of the PDF, read against the rendered page. The table calls the ranges approximate: ${SAME_CHECK}`,
    },
    'gautam-2012': {
      short: 'Gautam et al. 2012, Table 6 (borate glasses)',
      citation:
        'C. Gautam, A. K. Yadav, A. K. Singh, "A Review on Infrared Spectroscopy of Borate Glasses with Effects of Different Additives", ISRN Ceramics 2012 (2012) 428497',
      doi: '10.5402/2012/428497',
      licence: 'CC BY (Creative Commons Attribution License, as stated in the article)',
      url: 'https://doi.org/10.5402/2012/428497',
      retrieved: '2026-11-15',
      tables: 'Table 6 (assignment of infrared bands in the spectra of borate glasses)',
      verification: `Transcription checked on 2026-11-15: 22 of the 23 rows match Table 6 of the PDF, read against the rendered page; the row "<600" (metal cations) has no lower limit and is left out. These are bands of borate glasses: ${SAME_CHECK}`,
    },
  },
  functionalGroups: [
    ...parseFunctionalGroups(groupTable, 'pasieczna-2025'),
    ...parseAlAmin(text('al-amin-2025-table1.txt'), 'al-amin-2025'),
    ...parseElgayyar(text('elgayyar-2025-table1.txt'), 'elgayyar-2025'),
    ...parseGautam(text('gautam-2012-table6.txt'), 'gautam-2012'),
  ],
  metalOxides: parseMetalOxides(metalTable, 'pasieczna-2025'),
};
writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
console.log(
  `${file.functionalGroups.length} functional group entries, ${file.metalOxides.length} metal oxide entries written.`,
);
