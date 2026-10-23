/*
 * Builds the reference pattern library in data/reference/ from the Crystallography Open
 * Database (COD). Run on a developer machine or in CI, never in the browser:
 *
 *   npm run build:refs              reuse scripts/cif-cache/ and rebuild the JSON files
 *   npm run build:refs -- --refresh search COD again and download the CIFs again
 *
 * Nothing here comes from memory: every COD ID is found by searching COD, every CIF is
 * downloaded and checked, and the scattering-factor table is downloaded and parsed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCif, type CifBlock } from '../src/core/xrd/reference/cif.ts';
import {
  cellComposition,
  crystalFromCif,
  expandAtoms,
  patternFor,
  reflections,
  type FormFactors,
} from '../src/core/xrd/reference/powder.ts';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types.ts';
import { ANODES } from '../src/core/xrd/radiation.ts';
import { FAMILIES, PHASES, type PhaseRequest } from './reference-phases.ts';

const COD = 'https://www.crystallography.net/cod';
const SCATTERING_URL =
  'https://raw.githubusercontent.com/project-gemmi/gemmi/master/include/gemmi/it92.hpp';
const root = new URL('../', import.meta.url);
const cifDir = new URL('scripts/cif-cache/', root);
const sourceDir = new URL('scripts/source-cache/', root);
const outDir = new URL('data/reference/', root);
const selectionFile = new URL('selection.json', cifDir);

const D_MIN = 0.8;
/** Largest U (Å²) accepted for an atom at room temperature; sanity filter, not a physical limit. */
const MAX_U = 0.06;
const MIN_INTENSITY = 0.05;
const refresh = process.argv.includes('--refresh');

/** Fields of a COD search result that the selection uses. */
interface CodRow {
  file: string;
  sg: string | null;
  sgNumber: string | null;
  mineral: string | null;
  commonname: string | null;
  chemname: string | null;
  calcformula: string | null;
  formula: string | null;
  cellformula: string | null;
  celltemp: string | null;
  diffrtemp: string | null;
  cellpressure: string | null;
  diffrpressure: string | null;
  Rall: string | null;
  Robs: string | null;
  Rref: string | null;
  status: string | null;
  onhold: string | null;
  duplicateof: string | null;
  year: string | null;
  journal: string | null;
  volume: string | null;
  firstpage: string | null;
  doi: string | null;
  flags: string | null;
}

interface Selection {
  /** COD ID chosen for each phase id. */
  chosen: Record<string, { codId: number; row: CodRow; why: string }>;
  /** Phases with no acceptable COD entry, with the reasons. */
  skipped: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
      if (response.status === 403 || response.status === 404) {
        throw new Error(`${url} answered ${response.status}`);
      }
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`could not download ${url}`);
}

/** Cached download of a file used as input. */
async function cached(dir: URL, name: string, url: string): Promise<string> {
  const file = new URL(name, dir);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  mkdirSync(dir, { recursive: true });
  const text = await download(url);
  writeFileSync(file, text);
  await sleep(300);
  return text;
}

/** Neutral-atom scattering factors: International Tables Vol. C (1992), via the gemmi source file. */
async function scatteringFactors(): Promise<FormFactors> {
  const text = await cached(sourceDir, 'it92.hpp', SCATTERING_URL);
  const start = text.indexOf('IT92<Real>::data[99+112] = {');
  const rows = [...text.slice(start).matchAll(/^\s*\{([^}]*)\},\s*\/\/\s*(\S+)/gm)].slice(0, 99);
  const factors: Record<string, number[]> = {};
  // Row 0 is the placeholder "X"; rows 1 to 98 are H to Cf in order.
  for (const [, numbers, symbol] of rows.slice(1)) {
    const values = (numbers as string).split(',').map(Number);
    if (values.length !== 9 || values.some(Number.isNaN)) throw new Error(`bad row for ${symbol}`);
    factors[symbol as string] = values;
  }
  if (Object.keys(factors).length !== 98 || !factors['H'] || !factors['Cf']) {
    throw new Error('unexpected layout of the scattering-factor source file');
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    new URL('scattering-factors.json', outDir),
    JSON.stringify(
      {
        source:
          'X-ray scattering factor coefficients from International Tables for Crystallography Vol. C (1992): four Gaussians plus a constant, valid for sin(theta)/lambda < 2 per angstrom. Neutral atoms only. Downloaded from the gemmi source file it92.hpp (Global Phasing Ltd.).',
        url: SCATTERING_URL,
        coefficientOrder: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c'],
        factors,
      },
      null,
      1,
    ) + '\n',
  );
  return factors as unknown as FormFactors;
}

/** "TiO2" → { Ti: 1, O: 2 }, "Fe-O" is not a formula and throws. */
function parseFormula(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [, element, n] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    counts[element as string] = (counts[element as string] ?? 0) + (n ? Number(n) : 1);
  }
  return counts;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Counts divided by their greatest common divisor, as a canonical string such as "O2 Ti1". */
function reduced(counts: Record<string, number>): string {
  const g = Object.values(counts).reduce(gcd);
  return Object.keys(counts)
    .sort()
    .map((el) => `${el}${Math.round((counts[el] as number) / g)}`)
    .join(' ');
}

/** COD formula text such as "- O2 Ti -" → { O: 2, Ti: 1 }. */
function parseCodFormula(text: string | null): Record<string, number> | null {
  if (!text) return null;
  const counts: Record<string, number> = {};
  for (const token of text.replace(/-/g, ' ').split(/\s+/).filter(Boolean)) {
    const m = /^([A-Z][a-z]?)(\d*\.?\d*)$/.exec(token);
    if (!m) return null;
    counts[m[1] as string] = m[2] ? Number(m[2]) : 1;
  }
  return counts;
}

const asNumber = (v: string | null) => (v === null ? null : Number(v));
/** Lowest of the three R factors COD lists (fractions), or null when it lists none. */
const rFactor = (row: CodRow) => {
  const values = [row.Rall, row.Robs, row.Rref]
    .map(asNumber)
    .filter((v): v is number => v !== null && v > 0);
  return values.length > 0 ? Math.min(...values) : null;
};

/** Hard filters that need only the COD search record. Returns the reason for rejection, or null. */
function rejectRow(row: CodRow, request: PhaseRequest): string | null {
  const wanted = reduced(parseFormula(request.formula));
  const counts = parseCodFormula(row.calcformula ?? row.formula);
  if (!counts || reduced(counts) !== wanted) return 'formula differs';
  if (
    request.spaceGroup !== undefined &&
    ![request.spaceGroup].flat().includes(Number(row.sgNumber))
  ) {
    return 'space group differs';
  }
  if (request.mineral) {
    const names = [row.mineral, row.commonname, row.chemname].filter(Boolean).join(' | ');
    if (!request.mineral.test(names)) return 'name differs';
  }
  if (row.status || row.onhold || row.duplicateof) return 'retracted, on hold or duplicate';
  for (const t of [row.celltemp, row.diffrtemp]) {
    if (t !== null && (Number(t) < 283 || Number(t) > 305)) return 'not room temperature';
  }
  for (const p of [row.cellpressure, row.diffrpressure]) {
    if (p !== null && Number(p) > 120) return 'not ambient pressure';
  }
  return null;
}

/** Checks that need the CIF itself. Returns the reason for rejection, or null. */
function rejectCif(cifText: string, row: CodRow, factors: FormFactors): string | null {
  let crystal;
  try {
    crystal = crystalFromCif(parseCif(cifText), factors);
  } catch (error) {
    return `CIF unusable: ${(error as Error).message}`;
  }
  if (crystal.atoms.some((a) => Math.abs(a.occupancy - 1) > 1e-3)) return 'partial occupancy';
  // Displacement parameters of a well-refined room-temperature structure are small and positive.
  const u = crystal.atoms.flatMap((a) => [a.uIso ?? 0, ...(a.uAniso?.slice(0, 3) ?? [])]);
  if (u.some((v) => v < -1e-3 || v > MAX_U))
    return `implausible displacement parameter (U up to ${Math.max(...u)} Å²)`;
  const found = cellComposition(expandAtoms(crystal));
  const expected = parseCodFormula(row.cellformula);
  if (!expected) return 'no cell formula to check the atoms against';
  for (const el of new Set([...Object.keys(found), ...Object.keys(expected)])) {
    if (
      Math.abs((found[el] ?? 0) - (expected[el] ?? 0)) >
      1e-6 * Math.max(1, expected[el] ?? 0) + 1e-3
    ) {
      return `atoms in the cell (${JSON.stringify(found)}) differ from COD's cell formula`;
    }
  }
  return null;
}

async function selectPhase(
  request: PhaseRequest,
  factors: FormFactors,
): Promise<{ codId: number; row: CodRow; why: string } | string> {
  const elements = Object.keys(parseFormula(request.formula));
  const query = elements.map((el, i) => `el${i + 1}=${el}`).join('&');
  const url = `${COD}/result?${query}&strictmin=${elements.length}&strictmax=${elements.length}&format=json`;
  const rows = JSON.parse(await download(url)) as CodRow[];
  await sleep(300);
  const reasons = new Map<string, number>();
  const note = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  const passed = rows.filter((row) => {
    const reason = rejectRow(row, request);
    if (reason) note(reason);
    return !reason;
  });
  // Download and check every candidate, then rank: lowest R factor first; entries without
  // an R factor follow, those with displacement parameters before those without, newest first.
  const usable: { row: CodRow; hasAdp: boolean }[] = [];
  for (const row of passed) {
    const cif = await cached(cifDir, `${row.file}.cif`, `${COD}/${row.file}.cif`);
    const reason = rejectCif(cif, row, factors);
    if (reason) note(reason);
    else {
      const crystal = crystalFromCif(parseCif(cif), factors);
      usable.push({
        row,
        hasAdp: crystal.atoms.every((a) => a.uIso !== null || a.uAniso !== null),
      });
    }
  }
  usable.sort((p, q) => {
    const rp = rFactor(p.row);
    const rq = rFactor(q.row);
    if (rp !== null && rq !== null) return rp - rq;
    if (rp !== null) return -1;
    if (rq !== null) return 1;
    if (p.hasAdp !== q.hasAdp) return p.hasAdp ? -1 : 1;
    return Number(q.row.year ?? 0) - Number(p.row.year ?? 0);
  });
  const best = usable[0];
  if (best) {
    const r = rFactor(best.row);
    const why =
      r === null
        ? `COD lists no R factor for any usable candidate; ${best.hasAdp ? 'has displacement parameters, ' : 'no displacement parameters, '}newest (${best.row.year ?? 'year unknown'}) of ${usable.length} usable`
        : `lowest R factor (${r}) of ${usable.length} usable`;
    return { codId: Number(best.row.file), row: best.row, why };
  }
  const summary = [...reasons].map(([reason, n]) => `${n} × ${reason}`).join('; ');
  return `${rows.length} COD entries for these elements, none usable: ${summary || 'none found'}`;
}

function crystalSystem(spaceGroupNumber: number): string {
  // International Tables Vol. A: ranges of space-group numbers per crystal system.
  const ranges: [number, string][] = [
    [2, 'triclinic'],
    [15, 'monoclinic'],
    [74, 'orthorhombic'],
    [142, 'tetragonal'],
    [167, 'trigonal'],
    [194, 'hexagonal'],
    [230, 'cubic'],
  ];
  return (ranges.find(([max]) => spaceGroupNumber <= max) as [number, string])[1];
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const sig = (value: number, digits: number) => Number(value.toPrecision(digits));

function buildPhase(
  request: PhaseRequest,
  codId: number,
  row: CodRow,
  factors: FormFactors,
): ReferencePhase {
  const cifText = readFileSync(new URL(`${codId}.cif`, cifDir), 'utf8');
  const block: CifBlock = parseCif(cifText);
  const crystal = crystalFromCif(block, factors);
  const lines = reflections(crystal, factors, D_MIN);
  const peaks = patternFor(lines, ANODES.Cu.kAlpha1);
  const item = (tag: string) => block.items.get(tag) ?? null;
  const number = Number(row.sgNumber);
  return {
    id: request.id,
    name: request.name,
    formula: request.formula,
    codId,
    spaceGroup: { hm: row.sg ?? '', number },
    crystalSystem: crystalSystem(number),
    cell: {
      a: crystal.cell.a,
      b: crystal.cell.b,
      c: crystal.cell.c,
      alpha: crystal.cell.alpha,
      beta: crystal.cell.beta,
      gamma: crystal.cell.gamma,
    },
    citation: {
      journal: item('_journal_name_full') ?? row.journal ?? '',
      volume: item('_journal_volume') ?? row.volume ?? '',
      page: item('_journal_page_first') ?? row.firstpage ?? '',
      year: item('_journal_year') ?? row.year ?? '',
      doi: item('_journal_paper_doi') ?? row.doi ?? null,
    },
    peaks: peaks
      .filter((peak) => peak.intensity >= MIN_INTENSITY)
      .map((peak) => ({
        d: round(peak.d, 5),
        m: peak.multiplicity,
        mf2: sig(peak.mf2, 5),
        i: round(peak.intensity, 3),
        hkl: peak.hkl,
      })),
  };
}

async function main() {
  const factors = await scatteringFactors();
  mkdirSync(cifDir, { recursive: true });
  let selection: Selection = { chosen: {}, skipped: {} };
  if (!refresh && existsSync(selectionFile)) {
    selection = JSON.parse(readFileSync(selectionFile, 'utf8')) as Selection;
  }
  for (const request of PHASES) {
    if (selection.chosen[request.id] || selection.skipped[request.id]) continue;
    console.log(`searching COD for ${request.id} …`);
    const result = await selectPhase(request, factors);
    if (typeof result === 'string') {
      selection.skipped[request.id] = result;
      console.log(`  skipped: ${result}`);
    } else {
      selection.chosen[request.id] = result;
      console.log(`  COD ${result.codId}: ${result.why}`);
    }
    writeFileSync(selectionFile, JSON.stringify(selection, null, 1) + '\n');
  }

  const byFamily = new Map<string, ReferencePhase[]>();
  for (const request of PHASES) {
    const chosen = selection.chosen[request.id];
    if (!chosen) continue;
    const phase = buildPhase(request, chosen.codId, chosen.row, factors);
    byFamily.set(request.family, [...(byFamily.get(request.family) ?? []), phase]);
  }
  const index: ReferenceIndex = {
    source:
      'Patterns computed from CIF files of the Crystallography Open Database (COD, http://www.crystallography.net/), kinematic model, Cu Ka1; see docs/PROGRESS.md.',
    intensityWavelength: ANODES.Cu.kAlpha1,
    families: [],
  };
  for (const family of FAMILIES) {
    const phases = byFamily.get(family.id);
    if (!phases) continue;
    const file: ReferenceFamilyFile = { family: family.id, phases };
    writeFileSync(new URL(`${family.id}.json`, outDir), JSON.stringify(file) + '\n');
    index.families.push({
      id: family.id,
      name: family.name,
      aliases: family.aliases,
      formula: family.formula,
      file: `${family.id}.json`,
      phases: phases.map((p) => ({
        id: p.id,
        name: p.name,
        codId: p.codId,
        spaceGroup: p.spaceGroup.hm,
        crystalSystem: p.crystalSystem,
      })),
    });
  }
  writeFileSync(new URL('index.json', outDir), JSON.stringify(index, null, 1) + '\n');
  const skipped = Object.keys(selection.skipped);
  console.log(
    `\n${Object.keys(selection.chosen).length} phases built, ${skipped.length} skipped${skipped.length ? `: ${skipped.join(', ')}` : ''}`,
  );
}

await main();
