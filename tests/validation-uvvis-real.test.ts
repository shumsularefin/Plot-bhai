// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importSpectraFile, importSpectraText } from '../src/core/uvvis/import';
import { absorptionSignal, analyseTaucGap, fitBandGap, taucValues } from '../src/core/uvvis/tauc';
import type { ValueScale } from '../src/core/uvvis/types';

/*
 * Real TiO₂ diffuse reflectance files (tests/fixtures-real/uvvis/, Zenodo 10.5281/zenodo.14608640,
 * CC BY 4.0) against an independent reading and fit by scripts/validation/spectra/uvvis_real.py.
 * The record publishes no band gap, so this checks the arithmetic and the suggested region on
 * real data, not a published value (docs/validation.md, "Real files").
 */

interface Fit {
  exponent: number;
  window: [number, number];
  n: number;
  egEv: number;
  egSigma: number;
}
const reference = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/validation/uvvis-real-reference.json', import.meta.url),
    'utf8',
  ),
) as {
  files: Record<
    string,
    {
      points: number;
      wavelengthRangeNm: [number, number];
      kubelkaMunk: Record<string, number>;
      fits: { direct: Fit; indirect: Fit };
    }
  >;
};

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const read = (name: string) =>
  readFileSync(new URL(`./fixtures-real/uvvis/${name}`, import.meta.url));

function load(name: string) {
  const result = importSpectraFile(name, new Uint8Array(read(name)));
  if (!result.ok) throw new Error(result.error);
  return result.spectra;
}

function signalOf(wavelength: Float64Array, values: Float64Array, scale: ValueScale = 'percent') {
  return absorptionSignal(wavelength, values, { kind: 'reflectance', scale }, null);
}

describe.each(Object.entries(reference.files))('real file %s', (name, ref) => {
  const spectra = load(name);
  const spectrum = spectra[0] as (typeof spectra)[number];
  const signal = signalOf(spectrum.wavelengthNm, spectrum.values);

  it('is read as one spectrum with every point (semicolons, decimal commas, trailing "--" rows)', () => {
    expect(spectra.length).toBe(1);
    expect(spectrum.wavelengthNm.length).toBe(ref.points);
    expect(Math.min(...spectrum.wavelengthNm)).toBe(ref.wavelengthRangeNm[0]);
    expect(Math.max(...spectrum.wavelengthNm)).toBe(ref.wavelengthRangeNm[1]);
    // No header says what the values are, so the kind is a guess the user confirms.
    expect(spectrum.kindOrigin).toBe('guess');
  });

  it('F(R) equals the independent reading', () => {
    expect(signal.unit).toBe('kubelka-munk');
    for (const [i, value] of Object.entries(ref.kubelkaMunk))
      expect(rel(signal.signal[Number(i)] as number, value)).toBeLessThan(1e-12);
  });

  it.each(['direct', 'indirect'] as const)(
    '%s Tauc line over the fixed window equals scipy curve_fit',
    (transition) => {
      const f = ref.fits[transition];
      const fit = fitBandGap(
        signal.energyEv,
        taucValues(signal.energyEv, signal.signal, f.exponent),
        ...f.window,
      );
      expect(fit?.n).toBe(f.n);
      expect(Math.abs((fit?.egEv as number) - f.egEv)).toBeLessThan(1e-8);
      expect(rel(fit?.egSigma as number, f.egSigma)).toBeLessThan(1e-6);
    },
  );

  it('the suggested direct-gap region lies on the edge, not on the flat part above it (fault fixed)', () => {
    const f = ref.fits.direct;
    const gap = analyseTaucGap(signal.energyEv, signal.signal, f.exponent, {
      method: null,
      edgeRegion: null,
      baselineRegion: null,
    });
    const [from, to] = gap.region as [number, number];
    // The flat part starts near 3.7 eV in these files; before the fix the region was 4.6–5.4 eV.
    expect(from).toBeLessThan(3.4);
    expect(to).toBeLessThan(3.7);
    expect(Math.abs((gap.fit?.egEv as number) - f.egEv)).toBeLessThan(0.04);
  });

  it('the gap does not depend on the row order or on % versus fraction', () => {
    const f = ref.fits.direct;
    const base = fitBandGap(
      signal.energyEv,
      taucValues(signal.energyEv, signal.signal, 2),
      ...f.window,
    );
    const text = read(name).toString('latin1');
    const reversed = importSpectraText(name, text.split(/\r?\n/).reverse().join('\n'));
    if (!reversed.ok) throw new Error(reversed.error);
    const r = reversed.spectra[0] as (typeof spectra)[number];
    const fromReversed = signalOf(r.wavelengthNm, r.values);
    const fraction = signalOf(
      spectrum.wavelengthNm,
      spectrum.values.map((v) => v / 100),
      'fraction',
    );
    for (const s of [fromReversed, fraction]) {
      const fit = fitBandGap(s.energyEv, taucValues(s.energyEv, s.signal, 2), ...f.window);
      expect(fit?.egEv).toBeCloseTo(base?.egEv as number, 12);
      expect(fit?.egSigma).toBeCloseTo(base?.egSigma as number, 12);
    }
  });
});

describe('suggested indirect-gap region on the real files', () => {
  it('lies on the edge for the 200 °C file', () => {
    const name = 'DRS_TiO2_annealed_at_200_oC.csv';
    const s = load(name)[0] as ReturnType<typeof load>[number];
    const signal = signalOf(s.wavelengthNm, s.values);
    const gap = analyseTaucGap(signal.energyEv, signal.signal, 0.5, {
      method: null,
      edgeRegion: null,
      baselineRegion: null,
    });
    const ref = reference.files[name]?.fits.indirect as Fit;
    expect(Math.abs((gap.fit?.egEv as number) - ref.egEv)).toBeLessThan(0.02);
  });

  it.todo(
    'for the 300 °C file, after the sub-gap baseline is subtracted, it lies on the foot of the edge (2.78–2.88 eV, Eg 2.69 eV); open in docs/validation.md',
  );
});
