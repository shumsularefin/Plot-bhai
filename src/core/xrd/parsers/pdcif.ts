import { cifNumber, parseCifBlocks, type CifBlock } from '../reference/cif';
import type { DataMessage, ParseResult } from '../types';

/*
 * Powder CIF (pdCIF) reader: a powder pattern stored in a CIF, as in the NIST standard reference
 * material data releases and in GSAS-II's CIF export. Tags are those of the pdCIF dictionary
 * (B. H. Toby, International Tables Vol. G (2006), ch. 3.3; https://www.iucr.org/resources/cif):
 *   2θ (degrees):  _pd_proc_2theta_corrected, _pd_meas_2theta_scan, or a regular grid from
 *                  _pd_meas_2theta_range_min/max/inc (or _pd_proc_…)
 *   intensity:     _pd_meas_counts_total, _pd_meas_intensity_total or _pd_proc_intensity_total
 *   uncertainty:   the standard uncertainty in parentheses, "123(11)", or the least-squares weight
 *                  _pd_proc_ls_weight = 1/σ², so σ = 1/√w
 * The first data block with a pattern is read, skipping blocks whose name ends in "_calc" (a
 * calculated pattern stored next to the measured one).
 */

const TWO_THETA_TAGS = ['_pd_proc_2theta_corrected', '_pd_meas_2theta_scan'];
const INTENSITY_TAGS = [
  '_pd_meas_counts_total',
  '_pd_meas_intensity_total',
  '_pd_proc_intensity_total',
];

export function looksLikePdCif(text: string): boolean {
  const head = text.slice(0, 200_000).toLowerCase();
  return /(^|\n)\s*data_/.test(head) && INTENSITY_TAGS.some((tag) => head.includes(tag));
}

/** Standard uncertainty written in parentheses: "123.4(56)" → 5.6. */
function parenthesisSu(text: string | null | undefined): number | null {
  const match = text ? /^[+-]?(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?\((\d+)\)$/.exec(text.trim()) : null;
  if (!match) return null;
  const decimals = (match[2] as string).length - Number(match[3] ?? 0);
  return Number(match[4]) * 10 ** -decimals;
}

function grid(block: CifBlock, count: number): number[] | null {
  for (const prefix of ['_pd_meas_2theta_range_', '_pd_proc_2theta_range_']) {
    const min = cifNumber(block.items.get(`${prefix}min`));
    const inc = cifNumber(block.items.get(`${prefix}inc`));
    if (min !== null && inc !== null && inc > 0)
      return Array.from({ length: count }, (_, i) => min + i * inc);
  }
  return null;
}

function hasPattern(block: CifBlock): boolean {
  return block.loops.some((rows) => INTENSITY_TAGS.some((tag) => rows[0]?.has(tag)));
}

function readBlock(block: CifBlock): ParseResult | null {
  for (const rows of block.loops) {
    const first = rows[0];
    const yTag = first && INTENSITY_TAGS.find((tag) => first.has(tag));
    if (!first || !yTag) continue;
    const xTag = TWO_THETA_TAGS.find((tag) => first.has(tag));
    const x = xTag ? rows.map((r) => cifNumber(r.get(xTag)) ?? NaN) : grid(block, rows.length);
    if (!x)
      return {
        ok: false,
        error:
          'This powder CIF gives intensities but no 2θ values (no 2θ column and no 2θ range). It may hold time-of-flight or energy data, which this site does not read.',
      };
    const twoTheta: number[] = [];
    const intensity: number[] = [];
    const sigma: number[] = [];
    let skipped = 0;
    let withSigma = 0;
    rows.forEach((row, i) => {
      const angle = x[i] as number;
      const value = cifNumber(row.get(yTag));
      if (!Number.isFinite(angle) || value === null) {
        skipped++;
        return;
      }
      const weight = cifNumber(row.get('_pd_proc_ls_weight'));
      const su =
        parenthesisSu(row.get(yTag)) ?? (weight && weight > 0 ? 1 / Math.sqrt(weight) : null);
      if (su !== null && su > 0) withSigma++;
      twoTheta.push(angle);
      intensity.push(value);
      sigma.push(su ?? NaN);
    });
    const notes: DataMessage[] = [];
    if (skipped > 0)
      notes.push({ level: 'warning', text: `${skipped} points without a number were skipped.` });
    const complete = withSigma === twoTheta.length && twoTheta.length > 0;
    if (complete)
      notes.push({
        level: 'info',
        text: 'The file gives the uncertainty of each point; the refinement weights the points with it.',
      });
    return {
      ok: true,
      scan: {
        twoTheta,
        intensity,
        ...(complete && { sigma }),
        ...(yTag === '_pd_meas_counts_total' && { unitFromFile: 'counts' as const }),
        metadata: [{ key: 'Data block', value: block.name }],
        notes,
      },
    };
  }
  return null;
}

export function parsePdCif(text: string): ParseResult {
  const blocks = parseCifBlocks(text);
  const candidates = blocks.filter((b) => !/_calc$/i.test(b.name));
  for (const block of [...candidates, ...blocks.filter((b) => !candidates.includes(b))]) {
    const read = readBlock(block);
    if (!read) continue;
    if (read.ok) {
      const others = blocks.filter((b) => b !== block && hasPattern(b)).length;
      if (others > 0)
        read.scan.notes.push({
          level: 'info',
          text: `The file holds ${others + 1} patterns; the first measured one (${block.name}) was read.`,
        });
      for (const b of blocks) {
        const radiation = b.items.get('_diffrn_radiation_wavelength');
        const lambda = cifNumber(radiation);
        if (lambda !== null && lambda > 0.1 && lambda < 3) {
          read.scan.wavelengthFromFileA = lambda;
          break;
        }
      }
    }
    return read;
  }
  return {
    ok: false,
    error:
      'This CIF holds no powder pattern (no intensity column). A CIF of a crystal structure is loaded in step 3, Choose material.',
  };
}
