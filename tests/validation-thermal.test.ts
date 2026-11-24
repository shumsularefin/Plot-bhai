import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseEvent, analyseGlassTransition } from '../src/core/thermal/dsc';
import { friedman, isoconversional, kissinger, vyazovkin } from '../src/core/thermal/kinetics';
import { analyseSteps, temperatureAtMass } from '../src/core/thermal/steps';

interface ThermalRef {
  tga: {
    T: number[];
    massPct: number[];
    dtg: number[];
    expected: {
      steps: { label: string; fromC: number; toC: number; peakC: number; lossPct: number }[];
      residuePct: number;
      t5: number;
      t10: number;
      t50: number;
    };
  };
  dsc: {
    melt: {
      T: number[];
      exo: number[];
      rateKPerMin: number;
      fromC: number;
      toC: number;
      scipyEnthalpyJPerG: number;
      peakC: number;
    };
    tg: {
      T: number[];
      exo: number[];
      rateKPerMin: number;
      pre: [number, number];
      post: [number, number];
      scipyTgC: number;
      scipyDeltaCp: number;
    };
  };
  kinetics: {
    trueEaKJ: number;
    alphas: number[];
    runs: {
      betaKPerMin: number;
      tpC: number;
      T: number[];
      massPct: number[];
      dtg: number[];
    }[];
    scipy: {
      kissingerEaKJ: number;
      kasMeanEaKJ: number;
      fwoMeanEaKJ: number;
      starinkMeanEaKJ: number;
      friedmanMeanEaKJ: number;
    };
  };
}

const ref = JSON.parse(
  readFileSync(resolve('tests/fixtures/validation/thermal-reference.json'), 'utf8'),
) as ThermalRef;

describe('Thermal independent validation against SciPy / NumPy', () => {
  it('matches stoichiometric CaC2O4·H2O TGA steps and T5/T10/T50', () => {
    const T = Float64Array.from(ref.tga.T);
    const m = Float64Array.from(ref.tga.massPct);
    const dtg = Float64Array.from(ref.tga.dtg);
    const limits = ref.tga.expected.steps.map((s, idx) => ({
      id: idx + 1,
      fromC: s.fromC,
      toC: s.toC,
    }));
    const analysis = analyseSteps(T, m, dtg, limits, null);
    expect(analysis.steps).toHaveLength(3);
    analysis.steps.forEach((step, i) => {
      const exp = ref.tga.expected.steps[i];
      expect(exp).toBeDefined();
      if (!exp) return;
      expect(step.peakC).toBeCloseTo(exp.peakC, 1);
      expect(Math.abs(step.lossPct - exp.lossPct)).toBeLessThan(0.15);
    });
    expect(temperatureAtMass(T, m, 95)).toBeCloseTo(ref.tga.expected.t5, 2);
    expect(temperatureAtMass(T, m, 90)).toBeCloseTo(ref.tga.expected.t10, 2);
    expect(temperatureAtMass(T, m, 50)).toBeCloseTo(ref.tga.expected.t50, 2);
  });

  it('matches SciPy DSC melting enthalpy and glass transition Tg / ΔCp', () => {
    const melt = ref.dsc.melt;
    const ev = analyseEvent(
      Float64Array.from(melt.T),
      Float64Array.from(melt.exo),
      { id: 1, fromC: melt.fromC, toC: melt.toC, baseline: 'linear' },
      { rateKPerMin: melt.rateKPerMin, specific: true, cooling: false, molarMassGPerMol: null },
    );
    expect(ev).not.toBeNull();
    if (ev) {
      expect(ev.peakC).toBeCloseTo(melt.peakC, 1);
      expect(ev.enthalpy).not.toBeNull();
      if (ev.enthalpy !== null) {
        expect(Math.abs(ev.enthalpy)).toBeCloseTo(melt.scipyEnthalpyJPerG, 2);
      }
    }

    const tg = ref.dsc.tg;
    const glass = analyseGlassTransition(
      Float64Array.from(tg.T),
      Float64Array.from(tg.exo),
      {
        preFromC: tg.pre[0],
        preToC: tg.pre[1],
        postFromC: tg.post[0],
        postToC: tg.post[1],
      },
      { rateKPerMin: tg.rateKPerMin, specific: true, cooling: false },
    );
    expect(glass.ok).toBe(true);
    if (glass.ok) {
      expect(glass.glass.midpointC).toBeCloseTo(tg.scipyTgC, 1);
      expect(glass.glass.deltaCp).toBeCloseTo(tg.scipyDeltaCp, 2);
    }
  });

  it('matches SciPy on ODE-integrated ICTAC multi-rate kinetics (Kissinger, KAS, FWO, Starink, Friedman)', () => {
    const kin = ref.kinetics;
    const peaks = kin.runs.map((r) => ({ betaKPerMin: r.betaKPerMin, tpC: r.tpC }));
    const kRes = kissinger(peaks);
    expect(kRes).not.toBeNull();
    if (kRes) {
      expect(kRes.eaKJ).toBeCloseTo(kin.scipy.kissingerEaKJ, 2);
    }

    const massRuns = kin.runs.map((r) => ({
      betaKPerMin: r.betaKPerMin,
      temperatureC: Float64Array.from(r.T),
      massPct: Float64Array.from(r.massPct),
      dtg: Float64Array.from(r.dtg),
    }));

    const mean = (pts: { eaKJ: number }[]) => pts.reduce((s, p) => s + p.eaKJ, 0) / pts.length;

    const kas = isoconversional(massRuns, 150, 450, kin.alphas, 'kas');
    const fwo = isoconversional(massRuns, 150, 450, kin.alphas, 'fwo');
    const starink = isoconversional(massRuns, 150, 450, kin.alphas, 'starink');
    const fri = friedman(massRuns, 150, 450, kin.alphas);

    expect(kas.length).toBe(kin.alphas.length);
    expect(mean(kas)).toBeCloseTo(kin.scipy.kasMeanEaKJ, 1);
    expect(mean(fwo)).toBeCloseTo(kin.scipy.fwoMeanEaKJ, 1);
    expect(mean(starink)).toBeCloseTo(kin.scipy.starinkMeanEaKJ, 1);
    expect(mean(fri)).toBeCloseTo(kin.scipy.friedmanMeanEaKJ, 1);

    const vyaz = vyazovkin(massRuns, 150, 450, kin.alphas);
    expect(vyaz.length).toBe(kin.alphas.length);
    expect(Math.abs(mean(vyaz) - kin.trueEaKJ)).toBeLessThan(0.6);
  });
});
