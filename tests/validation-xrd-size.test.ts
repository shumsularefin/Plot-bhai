import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dislocationDensity,
  halderWagner,
  monshi,
  scherrer,
  sizeStrainPlot,
  williamsonHallUdm,
  type SizePeak,
  type SizeSettings,
} from '../src/core/xrd/size/methods';

interface XrdSizeRef {
  k: number;
  lambdaNm: number;
  trueD: number;
  trueEps: number;
  peaksSize: { twoTheta: number; beta: number }[];
  peaksWh: { twoTheta: number; beta: number }[];
  scipy: {
    scherrerD: number;
    monshiD: number;
    whD: number;
    whEps: number;
    sspD: number;
    sspEps: number;
    hwD: number;
    hwEps: number;
    dislocationDensity: number;
  };
}

const ref = JSON.parse(
  readFileSync(resolve('tests/fixtures/validation/xrd-size-reference.json'), 'utf8'),
) as XrdSizeRef;

const settings: SizeSettings = { k: ref.k, lambdaNm: ref.lambdaNm, modulusGPa: null };
const toPeaks = (rows: { twoTheta: number; beta: number }[]): SizePeak[] =>
  rows.map((r) => ({ twoTheta: r.twoTheta, beta: r.beta, betaSigma: 1e-5, modulusGPa: null }));

describe('XRD size-strain independent validation against SciPy / NumPy', () => {
  it('matches SciPy for Scherrer, Monshi-Scherrer, and Dislocation Density', () => {
    const peaks = toPeaks(ref.peaksSize);
    const sch = scherrer(peaks, settings);
    expect(sch.mean).toBeCloseTo(ref.scipy.scherrerD, 4);

    const ms = monshi(peaks, settings);
    expect(ms.size).not.toBeNull();
    if (ms.size) {
      expect(ms.size.value).toBeCloseTo(ref.scipy.monshiD, 4);
      const rho = dislocationDensity(ms.size);
      expect(
        Math.abs(rho.value - ref.scipy.dislocationDensity) / ref.scipy.dislocationDensity,
      ).toBeLessThan(1e-6);
    }
  });

  it('matches SciPy for Williamson-Hall UDM, Size-Strain Plot, and Halder-Wagner', () => {
    const peaks = toPeaks(ref.peaksWh);
    const wh = williamsonHallUdm(peaks, settings);
    expect(wh.size?.value).toBeCloseTo(ref.scipy.whD, 4);
    expect(wh.strain?.value).toBeCloseTo(ref.scipy.whEps, 6);

    const ssp = sizeStrainPlot(peaks, settings);
    expect(ssp.size?.value).toBeCloseTo(ref.scipy.sspD, 3);
    expect(ssp.strain?.value).toBeCloseTo(ref.scipy.sspEps, 4);

    const hw = halderWagner(peaks, settings);
    expect(hw.size?.value).toBeCloseTo(ref.scipy.hwD, 3);
    expect(hw.strain?.value).toBeCloseTo(ref.scipy.hwEps, 4);
  });
});
