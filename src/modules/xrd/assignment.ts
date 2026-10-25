import { phaseReference } from '../../core/xrd/reference/source';
import { regionValue, type RegionFit } from '../../core/xrd/peaks/fit';
import { peakTable, type PeakRow } from '../../core/xrd/peaks/table';
import { ANODES } from '../../core/xrd/radiation';
import {
  assignPeaks,
  uniqueHkl,
  type Assignment,
  type Candidate,
} from '../../core/xrd/reference/assign';
import {
  cellVolume,
  latticeSystemOf,
  refineLattice,
  type LatticeOutcome,
  type LatticePeak,
  type LatticeSystem,
} from '../../core/xrd/reference/lattice';
import { formatHkl } from '../../core/xrd/reference/hkl';
import { DEFAULT_MATCH, matchPhase, referenceLines } from '../../core/xrd/reference/match';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import { peaksFor, type XrdData } from './data';

/** One fitted peak and what it was assigned to. */
export interface AssignedPeak {
  /** Position in the sorted list of fitted peaks. */
  index: number;
  peak: PeakRow;
  /** Height of the fitted curve at the peak (data units), where its label is anchored. */
  top: number;
  assignment: Assignment;
  phase: ReferencePhase | null;
  /** Nearest reference line, or null when unassigned. */
  line: Candidate | null;
  /** All candidate (hkl) as text, for example "(004) / (112)"; empty when unassigned. */
  hklText: string;
}

/** Refined cell edges compared with the library cell. */
export interface LatticeSummary {
  system: LatticeSystem;
  outcome: LatticeOutcome;
  /** Library cell edges in the order of the refined edges, Å. */
  reference: number[];
  referenceVolume: number;
  /** Peaks left out because their index is not unique. */
  skipped: number;
}

export interface PhaseAssignment {
  phase: ReferencePhase;
  /** Zero shift (observed − reference) that best aligned the phase with the fitted peaks, degrees 2θ. */
  shift: number;
  assigned: number;
  /** Null when the cell type is not supported (monoclinic and triclinic). */
  lattice: LatticeSummary | { unsupported: string };
}

export interface AssignmentResult {
  peaks: AssignedPeak[];
  phases: PhaseAssignment[];
  unassigned: number;
}

/** "(101)" or "(004) / (112)": every candidate (hkl) of the peak. */
function candidateText(assignment: Assignment): string {
  return formatHkl(assignment.candidates.flatMap((c) => c.hkl));
}

/**
 * Assigns the fitted peaks of a pattern to the chosen reference phases and refines each
 * phase's cell from its uniquely indexed peaks.
 *
 * Each phase is first shifted by the zero shift that best aligns it with the fitted peak
 * positions (matchPhase), then every peak is given the nearest line within the tolerance
 * (assignPeaks). The cell is refined only from peaks whose index is unique (see uniqueHkl).
 * Returns null when the pattern has no fitted peaks or no phase is chosen.
 */
export function assignmentFor(
  data: XrdData,
  patternId: string,
  phases: readonly ReferencePhase[],
  refineZeroShift: boolean,
): AssignmentResult | null {
  const fit = peaksFor(data, patternId).fit;
  const chosen = phases.filter((p) => data.material.phaseIds.includes(p.id));
  if (!fit || chosen.length === 0) return null;
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  const rows = peakTable(fit.regions, lambda);
  if (rows.length === 0) return null;
  const positions = rows.map((r) => r.twoTheta);
  const range = [
    Math.min(...fit.regions.map((r) => r.start)),
    Math.max(...fit.regions.map((r) => r.end)),
  ] as const;
  const tolerance = data.material.toleranceDeg;

  const prepared = chosen.map((phase) => {
    const lines = referenceLines(phase, lambda);
    const match = matchPhase(lines, positions, range, {
      ...DEFAULT_MATCH,
      toleranceDeg: tolerance,
    });
    return { phase, lines, shift: match.shift };
  });
  const assignments = assignPeaks(
    positions,
    prepared.map((p) => ({ id: p.phase.id, lines: p.lines, shift: p.shift })),
    { toleranceDeg: tolerance, minIntensity: 1 },
  );

  const peaks: AssignedPeak[] = rows.map((peak, index) => {
    const assignment = assignments[index] as Assignment;
    const region = fit.regions[peak.region] as RegionFit;
    return {
      index,
      peak,
      top: regionValue(region, peak.twoTheta),
      assignment,
      phase: chosen.find((p) => p.id === assignment.phaseId) ?? null,
      line: assignment.candidates[0] ?? null,
      hklText: candidateText(assignment),
    };
  });

  const results: PhaseAssignment[] = prepared.map(({ phase, shift }) => {
    const own = peaks.filter((p) => p.assignment.phaseId === phase.id);
    const system = latticeSystemOf(phase.crystalSystem, phase.cell);
    if (!system)
      return {
        phase,
        shift,
        assigned: own.length,
        lattice: {
          unsupported: `Lattice parameters are calculated for cubic, tetragonal, hexagonal and orthorhombic cells; ${phase.name} is ${phase.crystalSystem}.`,
        },
      };
    const usable: LatticePeak[] = own.flatMap((p) => {
      const hkl = uniqueHkl(p.assignment, system);
      return hkl
        ? [
            {
              twoTheta: p.peak.twoTheta,
              ...(p.peak.twoThetaSigma > 0 && { sigma: p.peak.twoThetaSigma }),
              hkl,
            },
          ]
        : [];
    });
    const { a, b, c } = phase.cell;
    const reference = {
      cubic: [a],
      tetragonal: [a, c],
      hexagonal: [a, c],
      orthorhombic: [a, b, c],
    }[system];
    return {
      phase,
      shift,
      assigned: own.length,
      lattice: {
        system,
        outcome: refineLattice(system, usable, lambda, refineZeroShift),
        reference,
        referenceVolume: cellVolume(system, reference),
        skipped: own.length - usable.length,
      },
    };
  });

  return { peaks, phases: results, unassigned: peaks.filter((p) => !p.phase).length };
}

/** Superscript digits, for numbering phases in labels. */
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const superscript = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('');

/**
 * Peak labels for the figure: the (hkl) of each assigned peak, the strongest one in bold. With
 * more than one phase, each label carries the number of its phase and the key lists the numbers.
 */
export function peakLabelSet(result: AssignmentResult): PeakLabelSet {
  const many = result.phases.length > 1;
  const assigned = result.peaks.filter((p) => p.phase);
  const strongest = assigned.reduce<AssignedPeak | null>(
    (best, p) => (!best || p.peak.height > best.peak.height ? p : best),
    null,
  );
  const number = (id: string) => result.phases.findIndex((p) => p.phase.id === id) + 1;
  return {
    labels: assigned.map((p) => ({
      x: p.peak.twoTheta,
      y: p.top,
      text: `${p.hklText.replace(/ \/ /g, '/')}${many && p.phase ? superscript(number(p.phase.id)) : ''}`,
      ...(p === strongest && { strong: true }),
    })),
    key: result.phases.map(
      (p, i) =>
        `${many ? `${superscript(i + 1)} ` : ''}${p.phase.name}, ${phaseReference(p.phase)}`,
    ),
  };
}
