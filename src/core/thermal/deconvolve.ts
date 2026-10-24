import { fitRegion } from '../xrd/peaks/fit';
import type { StepResult } from './steps';

/** One Gaussian component of a DTG region. Temperatures in °C, loss in % of the reference mass. */
export interface DtgComponent {
  /** The step this component started from. */
  id: number;
  centerC: number;
  /** Full width at half maximum, °C. */
  fwhmC: number;
  /** Height in %/°C. */
  height: number;
  /** Area under the component, % of the reference mass: the mass lost in this component. */
  lossPct: number;
}

export interface DtgDeconvolution {
  components: DtgComponent[];
  /** Coefficient of determination of the fit over the region. */
  rSquared: number;
  converged: boolean;
}

/**
 * Splits overlapping DTG steps into Gaussian components: the DTG between `fromC` and `toC` is
 * fitted with one Gaussian per step plus a straight baseline (the peak fitter of the XRD
 * tool, with x in °C and y in %/°C). The area of a Gaussian, height · FWHM · √(π / (4 ln 2)),
 * is the mass lost in it. This is an approximation: real steps are rarely Gaussian, and
 * different splits can fit overlapping data almost equally well.
 */
export function deconvolveSteps(
  temperatureC: Float64Array,
  dtg: Float64Array,
  steps: readonly StepResult[],
  fromC: number,
  toC: number,
): DtgDeconvolution | null {
  const fit = fitRegion(
    temperatureC,
    dtg,
    {
      start: fromC,
      end: toC,
      peaks: steps.map((s) => ({
        center: s.peakC,
        width: Math.max(0.4 * (s.toC - s.fromC), 2 * medianStep(temperatureC)),
      })),
    },
    { profile: 'gaussian', fixedEta: null },
  );
  if (fit.peaks.length !== steps.length) return null;
  return {
    components: fit.peaks.map((p, i) => ({
      id: (steps[i] as StepResult).id,
      centerC: p.center,
      fwhmC: p.fwhm,
      height: p.height,
      lossPct: p.area,
    })),
    rSquared: fit.rSquared,
    converged: fit.converged,
  };
}

function medianStep(x: Float64Array): number {
  return ((x[x.length - 1] as number) - (x[0] as number)) / Math.max(1, x.length - 1);
}
