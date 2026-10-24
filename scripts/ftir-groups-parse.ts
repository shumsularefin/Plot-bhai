/*
 * Reads the two tables of the open-access review used for data/ftir/groups.json:
 * S. Pasieczna-Patkowska, M. Cichy, J. Flieger, "Application of Fourier Transform Infrared (FTIR)
 * Spectroscopy in Characterization of Green Synthesized Nanoparticles", Molecules 30 (2025) 684,
 * doi:10.3390/molecules30030684, CC BY 4.0. Table 2: band positions of metal oxides. Table 3:
 * wavenumber ranges of functional group vibrations. Nothing here is typed from memory; the
 * numbers come from the table cells.
 */

export interface GroupRange {
  /** Wavenumbers in cm⁻¹, from ≤ to. A single value has from = to. */
  from: number;
  to: number;
}

export interface FunctionalGroup {
  id: string;
  /** Band assignment as printed in the table (Table 3). */
  label: string;
  ranges: GroupRange[];
  /** True when the table gives the value with a "~". */
  approximate?: boolean;
}

export interface MetalOxide {
  id: string;
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
  const approximate = cell.trim().startsWith('~');
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
export function parseFunctionalGroups(tableXml: string): FunctionalGroup[] {
  const groups: FunctionalGroup[] = [];
  for (const [wavenumber, label] of tableRows(tableXml).slice(1)) {
    if (!wavenumber || !label) continue;
    const { ranges, approximate } = parseRanges(wavenumber);
    if (ranges.length === 0) continue;
    groups.push({
      id: `fg-${groups.length + 1}-${slug(label).slice(0, 40)}`,
      label,
      ranges,
      ...(approximate && { approximate }),
    });
  }
  return groups;
}

/** Table 2 rows: oxide, then four columns of band positions (comma separated), then references. */
export function parseMetalOxides(tableXml: string): MetalOxide[] {
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
    oxides.push({ id: `mo-${slug(label)}`, label, bands });
  }
  return oxides;
}
