import {
  absorbanceAt,
  calibrate,
  firstOrderKinetics,
  type Calibration,
  type FirstOrderResult,
} from '../../../core/uvvis/concentration';
import { lambdaMax, toQuantity } from '../../../core/uvvis/process';
import type { ConcentrationData, ConcentrationSample } from './data';

/** Absorbance of a spectrum as numbers (transmittance converted, A = −log₁₀ T); null for reflectance. */
export function absorbanceOf(sample: ConcentrationSample): Float64Array | null {
  const s = sample.spectrum;
  return s ? toQuantity(s.values, s, 'absorbance') : null;
}

/**
 * The wavelength in use: the one typed, else the absorption maximum of the reference spectrum
 * (the timed sample at t = 0, else the earliest one, else the most concentrated standard)
 * between the search limits. Null without spectra.
 */
export function chosenWavelength(data: ConcentrationData): number | null {
  if (data.wavelengthNm !== null) return data.wavelengthNm;
  const withSpectrum = data.samples.filter((s) => s.spectrum && s.value !== null);
  const timed = withSpectrum.filter((s) => s.role === 'timed');
  const zero = timed.find((s) => s.value === 0);
  const earliest = [...timed].sort((a, b) => (a.value as number) - (b.value as number))[0];
  const strongest = withSpectrum
    .filter((s) => s.role === 'standard')
    .sort((a, b) => (b.value as number) - (a.value as number))[0];
  const reference = zero ?? earliest ?? strongest;
  const s = reference?.spectrum;
  if (!s) return null;
  return (
    lambdaMax(
      s.wavelengthNm,
      s.values,
      s,
      data.searchFromNm ?? -Infinity,
      data.searchToNm ?? Infinity,
    )?.wavelengthNm ?? null
  );
}

/** Absorbance of one sample: the typed value, or the spectrum read at the wavelength in use. */
export function sampleAbsorbance(
  sample: ConcentrationSample,
  wavelengthNm: number | null,
  halfWidthNm: number,
): number | null {
  if (!sample.spectrum) return sample.typedAbsorbance;
  const a = absorbanceOf(sample);
  if (!a || wavelengthNm === null) return null;
  return absorbanceAt(sample.spectrum.wavelengthNm, a, wavelengthNm, halfWidthNm);
}

/** What step 1 still needs, or null when the analysis can go on. */
export function samplesProblem(samples: readonly ConcentrationSample[]): string | null {
  if (samples.length === 0) {
    return 'Load spectra or type absorbances, or press "Try with example data".';
  }
  const missing = samples.find((s) => s.value === null);
  if (missing) {
    return `Type the ${missing.role === 'standard' ? 'concentration' : 'time'} of "${missing.name}".`;
  }
  const untyped = samples.find((s) => !s.spectrum && s.typedAbsorbance === null);
  if (untyped) return `Type the absorbance of "${untyped.name}".`;
  const reflect = samples.find((s) => s.spectrum?.kind === 'reflectance');
  if (reflect) {
    return `"${reflect.name}" is a reflectance spectrum. Concentrations need absorbance or transmittance of a solution.`;
  }
  const standards = samples.filter((s) => s.role === 'standard').length;
  const timed = samples.filter((s) => s.role === 'timed').length;
  if (standards < 2 && timed < 2) {
    return 'Add at least two standards for a calibration line, or at least two time points for the kinetics.';
  }
  return null;
}

export interface Outcome {
  wavelengthNm: number | null;
  /** Absorbance per sample id (null when it could not be read). */
  absorbance: Map<string, number | null>;
  calibration: Calibration | null;
  standards: { sample: ConcentrationSample; absorbance: number }[];
  kinetics: FirstOrderResult | null;
  timed: { sample: ConcentrationSample; absorbance: number }[];
}

/** Absorbances at the chosen wavelength, the calibration line and the kinetics. */
export function analyse(data: ConcentrationData): Outcome {
  const wavelengthNm = chosenWavelength(data);
  const absorbance = new Map(
    data.samples.map((s) => [s.id, sampleAbsorbance(s, wavelengthNm, data.halfWidthNm)]),
  );
  const usable = (role: ConcentrationSample['role']) =>
    data.samples
      .filter((s) => s.role === role && s.value !== null && absorbance.get(s.id) != null)
      .map((s) => ({ sample: s, absorbance: absorbance.get(s.id) as number }))
      .sort((a, b) => (a.sample.value as number) - (b.sample.value as number));
  const standards = usable('standard');
  const timed = usable('timed');
  return {
    wavelengthNm,
    absorbance,
    standards,
    calibration:
      standards.length >= 2
        ? calibrate(
            standards.map((s) => s.sample.value as number),
            standards.map((s) => s.absorbance),
            data.pathCm,
            data.throughOrigin,
          )
        : null,
    timed,
    kinetics:
      timed.length >= 2
        ? firstOrderKinetics(
            timed.map((s) => s.sample.value as number),
            timed.map((s) => s.absorbance),
          )
        : null,
  };
}
