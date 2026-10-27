import { describe, expect, it } from 'vitest';
import {
  calibrationError,
  calibrationWarnings,
  toData,
  xPerPixel,
  type Calibration,
} from '../src/core/digitize/calibration';
import { toCurve } from '../src/core/digitize/curve';
import { digitizedSentence } from '../src/core/digitize/methods';

/** An FTIR-style figure: 4000 cm⁻¹ at pixel 100, 500 cm⁻¹ at pixel 800 (high on the left). */
const ftir: Calibration = {
  x: [
    { at: { x: 100, y: 500 }, value: 4000 },
    { at: { x: 800, y: 500 }, value: 500 },
  ],
  y: [
    { at: { x: 100, y: 500 }, value: 0 },
    { at: { x: 100, y: 100 }, value: 100 },
  ],
  yScale: 'linear',
};

const FTIR_AXES = { x: 'wavenumber', y: 'transmittance', xIncreasesRight: false };

describe('digitizing figures of other tools', () => {
  it('reads a reversed wavenumber axis', () => {
    expect(calibrationError(ftir, FTIR_AXES)).toBeNull();
    expect(toData(ftir, { x: 450, y: 300 })).toEqual({ x: 2250, y: 50 });
    expect(xPerPixel(ftir)).toBeCloseTo(5, 12);
  });

  it('warns about a reversed axis only where figures are not drawn that way', () => {
    const reversed = (t: string) => t.includes('increases to the left');
    expect(calibrationWarnings(ftir, FTIR_AXES).some(reversed)).toBe(false);
    expect(
      calibrationWarnings(ftir, { x: '2θ', y: 'intensity', xIncreasesRight: true }).some(reversed),
    ).toBe(true);
  });

  it('names the axes of the tool in its messages', () => {
    const same = { ...ftir, x: [ftir.x[0], { ...ftir.x[1], value: 4000 }] } as const;
    expect(calibrationError(same, FTIR_AXES)).toBe(
      'The two wavenumber points need different values.',
    );
  });

  it('returns the curve with x increasing, whatever the direction of the axis', () => {
    // Points left to right on the image, so wavenumber falls from 4000 to 500.
    const points = Array.from({ length: 701 }, (_, i) => ({ x: 100 + i, y: 300 }));
    const curve = toCurve(points, ftir);
    expect(curve).not.toBeNull();
    const x = curve?.x as Float64Array;
    expect(x[0]).toBeCloseTo(500, 9);
    expect(x[x.length - 1]).toBeCloseTo(4000, 9);
    expect(x.every((v, i) => i === 0 || v > (x[i - 1] as number))).toBe(true);
    expect(curve?.y.every((v) => Math.abs(v - 50) < 1e-9)).toBe(true);
  });
});

describe('methods sentence for digitized data', () => {
  it('says nothing when no data were digitized', () => {
    expect(digitizedSentence(0, 3, ['spectrum', 'spectra'])).toBeNull();
  });

  it('counts the digitized data sets', () => {
    expect(digitizedSentence(1, 1, ['spectrum', 'spectra'])).toMatch(/^The spectrum was digitized/);
    expect(digitizedSentence(2, 2, ['spectrum', 'spectra'])).toMatch(/^All spectra were/);
    expect(digitizedSentence(1, 3, ['spectrum', 'spectra'])).toMatch(
      /^1 of the 3 spectra was digitized .* derived from it are approximate\.$/,
    );
  });
});
