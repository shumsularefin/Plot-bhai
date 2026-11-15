/*
 * Reads the source tables of data/ftir/groups.json. First, the two tables of the open-access review
 * S. Pasieczna-Patkowska, M. Cichy, J. Flieger, "Application of Fourier Transform Infrared (FTIR)
 * Spectroscopy in Characterization of Green Synthesized Nanoparticles", Molecules 30 (2025) 684,
 * doi:10.3390/molecules30030684, CC BY 4.0. Table 2: band positions of metal oxides. Table 3:
 * wavenumber ranges of functional group vibrations. Nothing here is typed from memory; the
 * numbers come from the table cells. Then three more open (CC BY) tables, read from the text that
 * pdftotext gives for the PDFs (cached in data/ftir/source/*.txt, see readTextTable below).
 */

export interface GroupRange {
  /** Wavenumbers in cm⁻¹, from ≤ to. A single value has from = to. */
  from: number;
  to: number;
}

export interface FunctionalGroup {
  id: string;
  /** Key of the row's source in the `sources` of data/ftir/groups.json. */
  source: string;
  /** Band assignment as printed in the table (Table 3). */
  label: string;
  ranges: GroupRange[];
  /** True when the table gives the value with a "~". */
  approximate?: boolean;
}

export interface MetalOxide {
  id: string;
  /** Key of the row's source in the `sources` of data/ftir/groups.json. */
  source: string;
  /** Oxide name as printed, for example "ZnO" or "TiO2 anatase". */
  label: string;
  /** Band positions in cm⁻¹. */
  bands: { cm: number; note?: string }[];
}

const entities = (text: string) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&#x2212;|&#8722;/g, '−')
    .replace(/&#x2013;|&#8211;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Rows of an XML table as lists of cell text. */
export function tableRows(tableXml: string): string[][] {
  return [...tableXml.matchAll(/<tr[\s>][\s\S]*?<\/tr>/g)].map((row) =>
    [...(row[0] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) =>
      entities(cell[1] ?? ''),
    ),
  );
}

/** The n-th <table-wrap> element of the article XML (0-based), or undefined. */
export function tableWrap(xml: string, index: number): string | undefined {
  return [...xml.matchAll(/<table-wrap[\s>][\s\S]*?<\/table-wrap>/g)][index]?.[0];
}

/**
 * Wavenumber ranges in a cell such as "3730–3520", "~1660" or "3540–34803420–3380" (two ranges
 * printed without a separator). Each range is returned low to high.
 */
export function parseRanges(cell: string): { ranges: GroupRange[]; approximate: boolean } {
  // "~" or the tilde operator "∼" that some PDFs print.
  const approximate = /^[~∼]/.test(cell.trim());
  const ranges = [...cell.matchAll(/(\d{3,4})\s*[–-]\s*(\d{3,4})/g)].map((m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  });
  if (ranges.length === 0) {
    const single = /(\d{3,4})/.exec(cell);
    if (single) ranges.push({ from: Number(single[1]), to: Number(single[1]) });
  }
  return { ranges, approximate };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Table 3 rows (after the header row): wavenumber cell, assignment cell. */
export function parseFunctionalGroups(tableXml: string, source: string): FunctionalGroup[] {
  const groups: FunctionalGroup[] = [];
  for (const [wavenumber, label] of tableRows(tableXml).slice(1)) {
    if (!wavenumber || !label) continue;
    const { ranges, approximate } = parseRanges(wavenumber);
    if (ranges.length === 0) continue;
    groups.push({
      id: `fg-${groups.length + 1}-${slug(label).slice(0, 40)}`,
      source,
      label,
      ranges,
      ...(approximate && { approximate }),
    });
  }
  return groups;
}

/** Table 2 rows: oxide, then four columns of band positions (comma separated), then references. */
export function parseMetalOxides(tableXml: string, source: string): MetalOxide[] {
  const oxides: MetalOxide[] = [];
  let parent = '';
  for (const row of tableRows(tableXml).slice(1)) {
    const [name, ...rest] = row;
    if (!name) continue;
    const cells = rest.slice(0, 4);
    const bands = cells
      .flatMap((cell) => [...cell.matchAll(/(\d{3,4})\s*(\*)?/g)])
      .map((m) => ({
        cm: Number(m[1]),
        ...(m[2] && { note: 'band of carbonate anion (footnote of the table)' }),
      }));
    if (bands.length === 0) {
      // A heading row such as "TiO2", followed by rows for its polymorphs.
      parent = name;
      continue;
    }
    // Polymorph rows ("anatase", "rutile") belong to the heading row above them.
    const polymorph = parent !== '' && /^[a-z]+$/.test(name);
    const label = polymorph ? `${parent} ${name}` : name;
    if (!polymorph) parent = '';
    bands.sort((a, b) => a.cm - b.cm);
    oxides.push({ id: `mo-${slug(label)}`, source, label, bands });
  }
  return oxides;
}

/*
 * The tables below come as plain text from pdftotext -layout, one table row per line with the
 * columns separated by two or more spaces. Lines starting with "#" are the cache's own header.
 * pdftotext loses sub- and superscripts, so the formulas these tables print are written back
 * with the pairs below, each checked against the rendered page; nothing else in a cell changes.
 */
const FORMULAS: [string, string][] = [
  ['CO32−', 'CO₃²⁻'],
  ['SO42−', 'SO₄²⁻'],
  ['PO43−', 'PO₄³⁻'],
  ['NO3−', 'NO₃⁻'],
  ['BO33−', 'BO₃³⁻'],
  ['BO45−', 'BO₄⁵⁻'],
  ['BO3 −', 'BO₃⁻'],
  ['BO4 −', 'BO₄⁻'],
  ['BO3 –', 'BO₃–'],
  ['B3 O6', 'B₃O₆'],
  ['PbO4', 'PbO₄'],
  ['BO3', 'BO₃'],
  ['BO4', 'BO₄'],
];

/** Writes back the sub- and superscripts of the formulas in FORMULAS. */
export function formulas(text: string): string {
  let out = text;
  for (const [flat, printed] of FORMULAS) out = out.split(flat).join(printed);
  return out;
}

/** Table lines of a cached text table, header comments removed, split into cells. */
export function readTextTable(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s{2,}/));
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Table 1 of Al-Amin et al., Nanoscale Adv. 7 (2025) 6677 ("FTIR spectroscopy absorption table"):
 * wavenumber range, functional group or compound, bond type, software, references. The label is
 * the group followed by the bond type. The PDF's font prints "=" as "]" and "≡" as "^".
 */
export function parseAlAmin(text: string, source: string): FunctionalGroup[] {
  const rows: FunctionalGroup[] = [];
  for (const [wavenumber, group, bond] of readTextTable(text)) {
    if (!wavenumber || !group || !bond || !/^\d/.test(wavenumber)) continue;
    const { ranges } = parseRanges(wavenumber);
    if (ranges.length === 0) continue;
    const label = `${formulas(group.replace(/\]/g, '=').replace(/\^/g, '≡'))}, ${lowerFirst(bond)}`;
    rows.push({ id: `aa-${rows.length + 1}-${slug(label).slice(0, 40)}`, source, label, ranges });
  }
  return rows;
}

/**
 * Table 1 of Elgayyar et al., Phys. Chem. Chem. Phys. 27 (2025) 22871: the four fundamental modes
 * of carbonate, in columns (mode, assignment, wavenumber range). The PDF's font prints ν as "n".
 */
export function parseElgayyar(text: string, source: string): FunctionalGroup[] {
  const lines = readTextTable(text);
  const modes = lines.find((cells) => cells[0] === 'Vibration mode')?.slice(1) ?? [];
  const names = lines.find((cells) => cells[0] === 'Assignment')?.slice(1) ?? [];
  const numbers = lines.find((cells) => cells[0]?.startsWith('Wavenumber'))?.slice(1) ?? [];
  return modes.map((mode, i) => {
    const label = `carbonate ${mode.replace(/^n/, 'ν')}, ${lowerFirst(names[i] ?? '')}`;
    return {
      id: `el-${i + 1}-${slug(label.replace('ν', 'nu')).slice(0, 40)}`,
      source,
      label,
      ranges: parseRanges(numbers[i] ?? '').ranges,
    };
  });
}

/**
 * Table 6 of Gautam et al., ISRN Ceramics 2012 (2012) 428497 (infrared bands of borate glasses):
 * peak position or range, assignment, references (sometimes on lines of their own, which are
 * skipped). "<600" has no lower limit and is left out, so no range is invented for it.
 */
export function parseGautam(text: string, source: string): FunctionalGroup[] {
  const rows: FunctionalGroup[] = [];
  for (const [position, assignment] of readTextTable(text)) {
    if (!position || !assignment || !/^[∼~]?\d{3,4}/.test(position)) continue;
    const { ranges, approximate } = parseRanges(position);
    if (ranges.length === 0) continue;
    const label = formulas(assignment);
    rows.push({
      id: `ga-${rows.length + 1}-${slug(label).slice(0, 40)}`,
      source,
      label,
      ranges,
      ...(approximate && { approximate }),
    });
  }
  return rows;
}
