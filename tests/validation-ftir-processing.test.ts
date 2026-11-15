// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  type FtirProcessing,
} from '../src/core/ftir/process';

// References from numpy and scipy (scripts/validation/spectra/ftir_processing.py); see
// docs/validation.md, 19d.
interface Reference {
  x: number[];
  percentR: number[];
  kubelkaMunk: number[];
  logInverse: number[];
  co2: { fromCm: number; toCm: number; y: number[] };
  band: {
    fromCm: number;
    toCm: number;
    height: number;
    area: number;
    byHeight: number[];
    byArea: number[];
  };
}

const ref = JSON.parse(
  readFileSync('tests/fixtures/validation/ftir-processing-reference.json', 'utf8'),
) as Reference;
const spectrum = {
  wavenumber: Float64Array.from(ref.x),
  values: Float64Array.from(ref.percentR),
  kind: 'reflectance' as const,
  scale: 'percent' as const,
};
const settings = (patch: Partial<FtirProcessing>): FtirProcessing => ({
  ...DEFAULT_FTIR_PROCESSING,
  ...patch,
});
const co2 = { enabled: true, fromCm: ref.co2.fromCm, toCm: ref.co2.toCm };

function maxRelative(a: ArrayLike<number>, b: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < b.length; i++) {
    const scale = Math.max(Math.abs(b[i] as number), 1e-12);
    worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)) / scale);
  }
  return worst;
}

describe('FTIR processing against numpy and scipy (19d)', () => {
  it('Kubelka–Munk and log10(1/R) of diffuse reflectance', () => {
    const km = processSpectrum(spectrum, settings({ reflectance: 'kubelka-munk' }));
    expect(maxRelative(km.absorbance, ref.kubelkaMunk)).toBeLessThan(1e-12);
    const log = processSpectrum(spectrum, settings({ reflectance: 'log-inverse' }));
    expect(maxRelative(log.absorbance, ref.logInverse)).toBeLessThan(1e-12);
  });

  it('CO₂ region replaced by a straight line (numpy.interp)', () => {
    const out = processSpectrum(spectrum, settings({ co2 }));
    expect(maxRelative(out.absorbance, ref.co2.y)).toBeLessThan(1e-12);
    expect(out.edited).toEqual({ fromCm: ref.co2.fromCm, toCm: ref.co2.toCm });
  });

  it('normalisation to the height and to the area of a band (scipy.integrate.trapezoid)', () => {
    const band = { fromCm: ref.band.fromCm, toCm: ref.band.toCm };
    const byHeight = processSpectrum(
      spectrum,
      settings({
        co2,
        normalise: { enabled: true, method: 'band', band: { ...band, measure: 'height' } },
      }),
    );
    expect(maxRelative(byHeight.absorbance, ref.band.byHeight)).toBeLessThan(1e-10);
    const byArea = processSpectrum(
      spectrum,
      settings({
        co2,
        normalise: { enabled: true, method: 'band', band: { ...band, measure: 'area' } },
      }),
    );
    expect(maxRelative(byArea.absorbance, ref.band.byArea)).toBeLessThan(1e-10);
  });
});
