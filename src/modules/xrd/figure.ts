import { phaseReference } from '../../core/xrd/reference/source';
import { ANODES } from '../../core/xrd/radiation';
import { referenceLines } from '../../core/xrd/reference/match';
import type { ReferenceLane } from '../../ui/plot/ReferenceLanes';
import type { AssignmentResult } from './assignment';
import type { XrdData } from './data';

/** Lines weaker than this (percent of the strongest) are left out of the lanes. */
const MIN_LANE_PERCENT = 1;

/**
 * One stick lane per chosen phase for the figure: reference lines shifted by the phase's zero
 * shift, heights relative to the strongest line, named "phase, COD id". Lines that no fitted
 * peak was assigned to are marked as not found, so they print thinner and lighter. Phases the
 * user hid in step 4 are left out.
 */
export function referenceLanesFor(data: XrdData, assignment: AssignmentResult): ReferenceLane[] {
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  return assignment.phases
    .filter(({ phase }) => !data.material.hidden.includes(phase.id))
    .map(({ phase, shift }, i) => {
      const found = new Set(
        assignment.peaks
          .filter((p) => p.assignment.phaseId === phase.id)
          .flatMap((p) => p.assignment.candidates.map((c) => c.twoTheta)),
      );
      return {
        id: phase.id,
        name: `${phase.name}, ${phaseReference(phase)}`,
        colorIndex: i % 7,
        lines: referenceLines(phase, lambda)
          .filter((l) => l.intensity >= MIN_LANE_PERCENT)
          .map((l) => ({
            x: l.twoTheta + shift,
            height: l.intensity / 100,
            found: found.has(l.twoTheta),
          })),
      };
    });
}
