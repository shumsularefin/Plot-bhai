import {
  coatsRedfern,
  friedman,
  isoconversional,
  kissinger,
  peakTemperature,
  rateWarnings,
  resultWarnings,
  type CoatsRedfernResult,
  type IsoPoint,
  type KissingerResult,
  type MassRun,
  type PeakPoint,
} from '../../../core/thermal/kinetics';
import { cleanRun, DEFAULT_CLEAN, rampIndices } from '../../../core/thermal/process';
import { dtg } from '../../../core/thermal/smooth';
import type { DataMessage } from '../../../core/xrd/types';
import { mappingProblem, runOf } from '../analysis';
import type { IsoconversionalMethod, KineticRun, KineticsData } from './data';

/** A run prepared for the analysis: the curve on the heating ramp and the signal the peak is read from. */
export interface PreparedRun {
  id: number;
  name: string;
  rate: number;
  kind: 'tga' | 'dsc';
  temperatureC: Float64Array;
  /** Mass in % (TGA) or heat flow as recorded (DSC). */
  value: Float64Array;
  /** DTG in %/°C (TGA) or the heat flow itself (DSC). */
  signal: Float64Array;
}

export type Prepared = { ok: true; runs: PreparedRun[] } | { ok: false; error: string };

/** Rate checks and column checks that must pass before an analysis is possible. */
export function uploadProblem(runs: readonly KineticRun[]): string | null {
  if (runs.length < 3) {
    return 'Load at least three runs of the same sample at different heating rates. "Try with example data" loads five.';
  }
  for (const r of runs) {
    const problem = mappingProblem(r);
    if (problem) return `${r.name}: ${problem}`;
    if (!(r.rate !== null && r.rate > 0)) return `Enter the heating rate of ${r.name}.`;
  }
  const rates = runs.map((r) => r.rate as number);
  return new Set(rates).size < 3 ? 'At least three different heating rates are needed.' : null;
}

export function prepareRuns(data: KineticsData): Prepared {
  const problem = uploadProblem(data.runs);
  if (problem) return { ok: false, error: problem };
  const out: PreparedRun[] = [];
  for (const loaded of data.runs) {
    const run = runOf(loaded);
    if (!run) return { ok: false, error: `${loaded.name} could not be read.` };
    const rate = loaded.rate as number;
    if (run.mass) {
      const cleaned = cleanRun(run, null, { initialMassMg: null }, DEFAULT_CLEAN);
      if (!cleaned.ok) return { ok: false, error: `${loaded.name}: ${cleaned.error}` };
      const { temperatureC, massPct } = cleaned.curve;
      out.push({
        id: loaded.id,
        name: loaded.name,
        rate,
        kind: 'tga',
        temperatureC,
        value: massPct,
        signal: dtg(temperatureC, massPct, data.dtgWindowC),
      });
    } else if (run.heatFlow) {
      const idx = rampIndices(run.temperatureC);
      const flow = run.heatFlow;
      const heat = Float64Array.from(idx, (i) => flow[i] as number);
      out.push({
        id: loaded.id,
        name: loaded.name,
        rate,
        kind: 'dsc',
        temperatureC: Float64Array.from(idx, (i) => run.temperatureC[i] as number),
        value: heat,
        signal: heat,
      });
    } else {
      return { ok: false, error: `${loaded.name} has neither a mass nor a heat flow column.` };
    }
  }
  return { ok: true, runs: out };
}

/** The window the user chose, or the temperature range every run covers. */
export function windowOf(data: KineticsData, runs: readonly PreparedRun[]): [number, number] {
  const lowest = Math.max(...runs.map((r) => r.temperatureC[0] as number));
  const highest = Math.min(...runs.map((r) => r.temperatureC[r.temperatureC.length - 1] as number));
  return [data.fromC ?? lowest, data.toC ?? highest];
}

/** The conversion levels, for example 0.1, 0.2 … 0.9. */
export function alphaLevels(data: KineticsData): number[] {
  const { alphaFrom, alphaTo, alphaStep } = data;
  if (!(alphaStep > 0) || !(alphaTo >= alphaFrom)) return [];
  const levels: number[] = [];
  for (let a = alphaFrom; a <= alphaTo + 1e-9 && levels.length < 99; a += alphaStep) {
    levels.push(Number(a.toFixed(6)));
  }
  return levels.filter((a) => a > 0 && a < 1);
}

export interface PeakRow extends PeakPoint {
  name: string;
  /** Signal value at the peak, for drawing the marker. */
  signalAtPeak: number;
}

export type KineticOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      method: 'kissinger';
      window: [number, number];
      peaks: PeakRow[];
      result: KissingerResult;
      notes: DataMessage[];
    }
  | {
      ok: true;
      method: IsoconversionalMethod;
      window: [number, number];
      levels: IsoPoint[];
      notes: DataMessage[];
    }
  | {
      ok: true;
      method: 'coats-redfern';
      window: [number, number];
      /** Every run's model fits, best R² first. */
      runs: { name: string; rate: number; fits: CoatsRedfernResult[] }[];
      notes: DataMessage[];
    };

export function analyse(data: KineticsData, prepared: Prepared): KineticOutcome {
  if (!prepared.ok) return prepared;
  const { runs } = prepared;
  const window = windowOf(data, runs);
  if (!(window[1] > window[0])) {
    return { ok: false, error: 'The temperature window is empty: "to" must be above "from".' };
  }
  const notes = rateWarnings(runs.map((r) => r.rate));

  if (data.method === 'kissinger') {
    if (new Set(runs.map((r) => r.kind)).size > 1) {
      return { ok: false, error: 'Use only TGA runs or only DSC runs, not a mix.' };
    }
    const peaks: PeakRow[] = [];
    for (const r of runs) {
      const direction = r.kind === 'tga' || data.peakUp ? 'max' : 'min';
      const peak = peakTemperature(r.temperatureC, r.signal, window[0], window[1], direction);
      if (!peak) {
        return {
          ok: false,
          error: `No peak found in ${r.name} between ${window[0].toFixed(0)} and ${window[1].toFixed(0)} °C. Widen the window${r.kind === 'dsc' ? ' or switch the peak direction' : ''}.`,
        };
      }
      if (peak.atEdge) {
        notes.push({
          level: 'warning',
          text: `The highest point in ${r.name} is at the edge of the window, so the peak is probably cut off. Widen the window.`,
        });
      }
      const i = r.temperatureC.findIndex((t) => t >= peak.tpC);
      peaks.push({
        name: r.name,
        betaKPerMin: r.rate,
        tpC: peak.tpC,
        signalAtPeak: r.signal[Math.max(0, i)] as number,
      });
    }
    const result = kissinger(peaks);
    if (!result) {
      return {
        ok: false,
        error:
          'The peaks do not move to higher temperature at higher heating rates, so no activation energy can be fitted. Check the heating rates and the window.',
      };
    }
    notes.push(...resultWarnings([result.eaKJ], [result.rSquared]));
    return { ok: true, method: 'kissinger', window, peaks, result, notes };
  }

  if (runs.some((r) => r.kind !== 'tga')) {
    return { ok: false, error: 'The isoconversional methods need a mass column in every run.' };
  }
  const alphas = alphaLevels(data);
  if (alphas.length === 0) return { ok: false, error: 'Set conversion levels between 0 and 1.' };
  const massRuns: MassRun[] = runs.map((r) => ({
    betaKPerMin: r.rate,
    temperatureC: r.temperatureC,
    massPct: r.value,
  }));
  if (data.method === 'coats-redfern') {
    const fitted = runs.map((r, i) => ({
      name: r.name,
      rate: r.rate,
      fits: coatsRedfern(
        massRuns[i] as MassRun,
        window[0],
        window[1],
        data.alphaFrom,
        data.alphaTo,
      ),
    }));
    if (fitted.some((f) => f.fits.length === 0)) {
      return {
        ok: false,
        error:
          'Coats–Redfern needs a mass loss step inside the window, with enough points between the conversion limits, in every run.',
      };
    }
    notes.push(
      {
        level: 'info',
        text: 'Coats–Redfern fits each run with each reaction model. The best straight line (highest R²) is not proof of the mechanism: several models often fit almost equally well with very different Ea. Compare with an isoconversional method.',
      },
      {
        level: 'info',
        text: 'A is approximate: the factor (1 − 2RT/Ea) is taken as 1.',
      },
    );
    const best = new Set(fitted.map((f) => f.fits[0]?.model));
    if (best.size > 1) {
      notes.push({
        level: 'warning',
        text: 'The best model is not the same for every heating rate, so no single model describes the process.',
      });
    }
    return { ok: true, method: 'coats-redfern', window, runs: fitted, notes };
  }
  const levels =
    data.method === 'friedman'
      ? friedman(
          runs.map((r, i) => ({ ...(massRuns[i] as MassRun), dtg: r.signal })),
          window[0],
          window[1],
          alphas,
        )
      : isoconversional(massRuns, window[0], window[1], alphas, data.method);
  if (levels.length === 0) {
    return {
      ok: false,
      error:
        'No conversion level could be fitted. The window should cover one complete mass loss step in every run.',
    };
  }
  notes.push(
    {
      level: 'info',
      text: 'Conversion is taken as (m₀ − m) / (m₀ − m_f) between the masses at the two ends of the window, so the window must start before and end after the step.',
    },
    ...resultWarnings(
      levels.map((l) => l.eaKJ),
      levels.map((l) => l.rSquared),
    ),
  );
  return { ok: true, method: data.method, window, levels, notes };
}
