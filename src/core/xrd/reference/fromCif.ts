/*
 * A reference phase from a CIF file the user loads, computed in the browser with the same
 * kinematic model as the built-in library (powder.ts): any structure from the Crystallography
 * Open Database, the Materials Project, ICSD, a refinement or a paper's supporting information
 * can be compared with a measured pattern.
 */

import { cifNumber, parseCif, type CifBlock } from './cif.ts';
import {
  cellComposition,
  crystalFromCif,
  expandAtoms,
  patternFor,
  reflections,
  type FormFactors,
} from './powder.ts';
import type { ReferencePhase } from './types.ts';
import type { DataMessage } from '../types.ts';

/** Shortest d-spacing kept, Å: the library uses the same (2θ up to about 150° for Cu Kα1). */
export const CIF_D_MIN = 0.8;
/** Lines weaker than this (percent of the strongest, Cu Kα1) are dropped, as in the library. */
const MIN_INTENSITY = 0.05;
/** Cu Kα1 wavelength (Å) for the stored relative intensities; radiation.ts, Hölzer 1997. */
const CU_KALPHA1 = 1.5405929;

export type CifPhaseResult =
  { ok: true; phase: ReferencePhase; notes: DataMessage[] } | { ok: false; error: string };

/** Crystal system from the International Tables space-group number. */
export function crystalSystemOf(number: number): string {
  const ranges: [number, string][] = [
    [2, 'triclinic'],
    [15, 'monoclinic'],
    [74, 'orthorhombic'],
    [142, 'tetragonal'],
    [167, 'trigonal'],
    [194, 'hexagonal'],
    [230, 'cubic'],
  ];
  return ranges.find(([max]) => number <= max)?.[1] ?? 'unknown';
}

const text = (block: CifBlock, ...tags: string[]): string | null => {
  for (const tag of tags) {
    const v = block.items.get(tag);
    if (v !== null && v !== undefined && v.trim() !== '') return v.trim();
  }
  return null;
};

/** "Bi O4 V" or "Bi1 O4 V1" → "BiO4V"; counts such as 1.00 lose their decimals. */
function compactFormula(sum: string): string {
  return sum
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^([A-Z][a-z]?)(\d*\.?\d*)$/.exec(t);
      if (!m) return t;
      const n = m[2] ? Number(m[2]) : 1;
      return `${m[1]}${n === 1 ? '' : Number(n.toFixed(3))}`;
    })
    .join('');
}

/** Formula from the cell contents divided by their greatest common count (2 decimals). */
function formulaFromCell(counts: Record<string, number>): string {
  const values = Object.values(counts);
  const smallest = Math.min(...values);
  let divisor = smallest;
  for (let z = 1; z <= 64; z++) {
    if (values.every((v) => Math.abs((v * z) / smallest - Math.round((v * z) / smallest)) < 0.02)) {
      divisor = smallest / z;
      break;
    }
  }
  return Object.keys(counts)
    .sort()
    .map((el) => {
      const n = Number(((counts[el] as number) / divisor).toFixed(2));
      return `${el}${n === 1 ? '' : n}`;
    })
    .join('');
}

/**
 * Reads a CIF and calculates its powder lines. `id` must be unique among the phases of the
 * analysis. Returns a plain-language reason when the file cannot be used, and notes about what
 * limits the calculated intensities (partial occupancy, missing displacement parameters,
 * hydrogen atoms, a temperature or pressure far from ambient).
 */
export function phaseFromCif(
  cifText: string,
  fileName: string,
  factors: FormFactors,
  id: string,
): CifPhaseResult {
  let block: CifBlock;
  try {
    block = parseCif(cifText);
  } catch {
    return { ok: false, error: 'This file could not be read as a CIF.' };
  }
  if (block.items.size === 0 && block.loops.length === 0)
    return { ok: false, error: 'This file has no CIF data block (data_…).' };
  let crystal;
  try {
    crystal = crystalFromCif(block, factors);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown problem';
    return {
      ok: false,
      error: `This CIF cannot be used to calculate a pattern: ${reason}. A structure file needs the cell, the symmetry operators and the atom positions.`,
    };
  }
  const sites = expandAtoms(crystal);
  const lines = reflections(crystal, factors, CIF_D_MIN);
  if (lines.length === 0)
    return { ok: false, error: 'No diffraction lines were found for this structure.' };
  const peaks = patternFor(lines, CU_KALPHA1).filter((p) => p.intensity >= MIN_INTENSITY);

  const notes: DataMessage[] = [];
  if (crystal.atoms.some((a) => a.occupancy < 0.999))
    notes.push({
      level: 'info',
      text: 'Some sites are partly occupied; the calculation uses the occupancies as given.',
    });
  if (crystal.atoms.some((a) => a.uIso === null && a.uAniso === null))
    notes.push({
      level: 'warning',
      text: 'Some atoms have no displacement parameters, so they were treated as not vibrating. Calculated intensities at high angles are then too strong.',
    });
  if (
    crystal.atoms.some(
      (a) => (a.uIso !== null && a.uIso < 0) || (a.uAniso?.slice(0, 3).some((u) => u < 0) ?? false),
    )
  )
    notes.push({
      level: 'warning',
      text: 'Some atoms have a negative displacement parameter, which is not physical (it points to a problem in the refinement). The pattern was calculated as given, so its intensities are approximate.',
    });
  if (crystal.atoms.some((a) => a.element === 'H'))
    notes.push({
      level: 'info',
      text: 'The structure contains hydrogen, which scatters X-rays very weakly.',
    });
  const temperature = cifNumber(
    block.items.get('_diffrn_ambient_temperature') ??
      block.items.get('_cell_measurement_temperature'),
  );
  if (temperature !== null && (temperature < 250 || temperature > 330))
    notes.push({
      level: 'warning',
      text: `The structure was measured at ${temperature} K, far from room temperature, so its cell (and line positions) may differ from your sample's.`,
    });
  const pressure = cifNumber(block.items.get('_diffrn_ambient_pressure'));
  if (pressure !== null && pressure > 200)
    notes.push({
      level: 'warning',
      text: `The structure was measured at ${pressure} kPa, above ambient pressure, so its cell may be compressed.`,
    });

  const number = cifNumber(
    block.items.get('_space_group_it_number') ?? block.items.get('_symmetry_int_tables_number'),
  );
  const hm =
    text(block, '_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m') ?? 'not stated';
  const sum = text(block, '_chemical_formula_sum');
  const formula = sum ? compactFormula(sum) : formulaFromCell(cellComposition(sites));
  const name =
    text(
      block,
      '_chemical_name_mineral',
      '_chemical_name_common',
      '_chemical_name_systematic',
    )?.replace(/\s+/g, ' ') ?? formula;
  const cod = cifNumber(block.items.get('_cod_database_code'));
  const icsd = cifNumber(block.items.get('_database_code_icsd'));
  const database = cod !== null ? `COD ${cod}` : icsd !== null ? `ICSD ${icsd}` : null;
  if (number === null)
    notes.push({
      level: 'info',
      text: 'The file does not give the space-group number, so the crystal system is not shown.',
    });

  const round = (v: number, digits: number) => Number(v.toFixed(digits));
  const phase: ReferencePhase = {
    id,
    name,
    formula,
    codId: cod,
    origin: { kind: 'cif', fileName, database },
    spaceGroup: { hm, number: number ?? 0 },
    crystalSystem: number === null ? 'unknown' : crystalSystemOf(number),
    cell: { ...crystal.cell },
    cellContents: roundedContents(cellComposition(sites)),
    citation: {
      journal: text(block, '_journal_name_full') ?? '',
      volume: text(block, '_journal_volume') ?? '',
      page: text(block, '_journal_page_first') ?? '',
      year: text(block, '_journal_year') ?? '',
      doi: text(block, '_journal_paper_doi'),
    },
    peaks: peaks.map((p) => ({
      d: round(p.d, 5),
      m: p.multiplicity,
      mf2: Number(p.mf2.toPrecision(5)),
      i: round(p.intensity, 3),
      hkl: p.hkl,
    })),
  };
  return { ok: true, phase, notes };
}

/** Cell contents rounded to 4 decimals (occupancies such as 1/3 make long fractions). */
export function roundedContents(contents: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(contents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([element, n]) => [element, Number(n.toFixed(4))]),
  );
}
