import { describe, expect, it } from 'vitest';
import {
  calibrationWarnings,
  toData,
  toPixel,
  type Calibration,
} from '../src/core/digitize/calibration';

describe('Digitize affine calibration analytical validation', () => {
  it('round-trips linear, rotated, and log-y coordinates to machine precision', () => {
    const theta = (5 * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const cal: Calibration = {
      x: [
        { at: { x: 100, y: 400 }, value: 10 },
        { at: { x: 100 + 500 * cos, y: 400 + 500 * sin }, value: 60 },
      ],
      y: [
        { at: { x: 100, y: 400 }, value: 1 },
        { at: { x: 100 + 300 * sin, y: 400 - 300 * cos }, value: 1000 },
      ],
      yScale: 'log',
    };
    const pt = toPixel(cal, { x: 35, y: 100 });
    const back = toData(cal, pt);
    expect(back.x).toBeCloseTo(35, 6);
    expect(back.y).toBeCloseTo(100, 6);
  });

  it('does not emit a bogus 179.9° tilt warning on reversed right-to-left FTIR x-axes', () => {
    const ftirReversed: Calibration = {
      x: [
        { at: { x: 600, y: 400 }, value: 400 },
        { at: { x: 100, y: 399.5 }, value: 4000 },
      ],
      y: [
        { at: { x: 100, y: 400 }, value: 0 },
        { at: { x: 100, y: 100 }, value: 1 },
      ],
      yScale: 'linear',
    };
    const warnings = calibrationWarnings(ftirReversed, {
      x: 'Wavenumber',
      y: 'Absorbance',
      xIncreasesRight: false,
    });
    expect(warnings.some((w) => w.includes('tilted'))).toBe(false);
  });

  it('round-trips log-x and log-y coordinates accurately', () => {
    const logLog: Calibration = {
      x: [
        { at: { x: 100, y: 400 }, value: 1 },
        { at: { x: 500, y: 400 }, value: 10000 },
      ],
      y: [
        { at: { x: 100, y: 400 }, value: 0.1 },
        { at: { x: 100, y: 100 }, value: 100 },
      ],
      xScale: 'log',
      yScale: 'log',
    };
    const px = toPixel(logLog, { x: 100, y: 10 });
    expect(px.x).toBeCloseTo(300, 6);
    expect(px.y).toBeCloseTo(200, 6);
    const data = toData(logLog, px);
    expect(data.x).toBeCloseTo(100, 6);
    expect(data.y).toBeCloseTo(10, 6);
  });
});
