import type { AxisLabels } from '../../ui/plot/types';

/** Publication-style axis labels: italic θ, degrees, arbitrary intensity units. */
export function xrdLabels(normalised: boolean): AxisLabels {
  return {
    x: (
      <>
        2<tspan font-style="italic">θ</tspan> (°)
      </>
    ),
    y: normalised ? 'Normalised intensity (a.u.)' : 'Intensity (a.u.)',
  };
}
