import {
  heatCapacityBySapphire,
  type CpResult,
  type HeatFlowCurve,
} from '../../../core/thermal/heatCapacity';
import { oxidationInductionTime, type OitOutcome } from '../../../core/thermal/oit';
import { rampIndices } from '../../../core/thermal/process';
import { vantHoffPurity, type PurityOutcome } from '../../../core/thermal/purity';
import { mappingProblem, runOf } from '../analysis';
import type { LoadedTable } from '../data';
import { ROLE_LABELS, ROLES, type DscMethod, type DscMethodsData } from './data';
import { SAPPHIRE } from './example';

/** The heating ramp of a file, heat flow made endothermic positive. Null when the columns are not usable. */
export function rampOf(loaded: LoadedTable | undefined, exoUp: boolean): HeatFlowCurve | null {
  const run = runOf(loaded ?? null);
  if (!run?.heatFlow) return null;
  const flow = run.heatFlow;
  const idx = rampIndices(run.temperatureC);
  return {
    temperatureC: Float64Array.from(idx, (i) => run.temperatureC[i] as number),
    heatFlow: Float64Array.from(idx, (i) => (exoUp ? -1 : 1) * (flow[i] as number)),
  };
}

/**
 * Time (min) and exothermic-positive heat flow of an isothermal run, in file order. Read straight
 * from the chosen columns, because the temperature of an isothermal export may never change.
 */
export function isothermOf(
  loaded: LoadedTable | undefined,
  exoUp: boolean,
): { timeMin: Float64Array; exo: Float64Array } | null {
  if (!loaded) return null;
  const { mapping, table } = loaded;
  const time = mapping.time === null ? undefined : table.columns[mapping.time];
  const flow = mapping.heatFlow === null ? undefined : table.columns[mapping.heatFlow];
  if (!time || !flow || mapping.time === mapping.heatFlow) return null;
  return {
    timeMin: mapping.timeUnit === 's' ? time.map((t) => t / 60) : time,
    exo: flow.map((v) => (exoUp ? v : -v)),
  };
}

/** Why one loaded file cannot be used by the method, or null. */
export function fileProblem(method: DscMethod, file: LoadedTable): string | null {
  if (method === 'oit') {
    return isothermOf(file, true)
      ? null
      : 'Choose a time column and a heat flow column (two different columns).';
  }
  return mappingProblem(file) ?? (runOf(file)?.heatFlow ? null : 'Choose the heat flow column.');
}

/** Why step 1 is not complete, or null. */
export function uploadProblem(data: DscMethodsData): string | null {
  for (const role of ROLES[data.method]) {
    const file = data.files[role];
    if (!file) {
      return `Load the ${ROLE_LABELS[role].toLowerCase()}, or press Try with example data.`;
    }
    const problem = fileProblem(data.method, file);
    if (problem) return `${ROLE_LABELS[role]}: ${problem}`;
  }
  if (data.method === 'cp') {
    if (
      !(data.sapphireMassMg && data.sapphireMassMg > 0) ||
      !(data.sampleMassMg && data.sampleMassMg > 0)
    ) {
      return 'Type the sapphire and sample masses.';
    }
    if (data.heatFlowUnit !== 'mW') {
      return 'The sapphire method needs heat flow in mW (not divided by mass), because the blank has no mass.';
    }
  }
  if (data.method === 'purity') {
    if (!(data.rateKPerMin && data.rateKPerMin > 0)) return 'Type the heating rate.';
    if (data.heatFlowUnit === 'mW' && !(data.sampleMassMg && data.sampleMassMg > 0)) {
      return 'Type the sample mass, needed to turn mW into W/g.';
    }
  }
  return null;
}

export type DscMethodsOutcome =
  | { method: 'cp'; ok: true; result: CpResult }
  | { method: 'purity'; outcome: PurityOutcome; ok: true }
  | { method: 'oit'; outcome: OitOutcome; ok: true }
  | { ok: false; error: string };

/** Runs the chosen method on the saved data. */
export function analyse(data: DscMethodsData): DscMethodsOutcome {
  const problem = uploadProblem(data);
  if (problem) return { ok: false, error: problem };
  if (data.method === 'cp') {
    const [blank, sapphire, sample] = (['blank', 'sapphire', 'sample'] as const).map((r) =>
      rampOf(data.files[r], data.exoUp),
    );
    if (!blank || !sapphire || !sample) return { ok: false, error: 'A file could not be read.' };
    const lo = Math.max(blank.temperatureC[0] as number, sample.temperatureC[0] as number);
    const hi = Math.min(
      blank.temperatureC[blank.temperatureC.length - 1] as number,
      sample.temperatureC[sample.temperatureC.length - 1] as number,
    );
    return {
      method: 'cp',
      ok: true,
      result: heatCapacityBySapphire(
        SAPPHIRE,
        blank,
        sapphire,
        sample,
        { sapphireMg: data.sapphireMassMg as number, sampleMg: data.sampleMassMg as number },
        { fromC: data.cp.fromC ?? lo, toC: data.cp.toC ?? hi, stepC: data.cp.stepC },
      ),
    };
  }
  if (data.method === 'purity') {
    const ramp = rampOf(data.files.sample, data.exoUp);
    if (!ramp) return { ok: false, error: 'The file could not be read.' };
    const perGram = data.heatFlowUnit === 'W/g' ? 1 : 1 / (data.sampleMassMg as number);
    const T = ramp.temperatureC;
    return {
      method: 'purity',
      ok: true,
      outcome: vantHoffPurity({
        temperatureC: T,
        endo: ramp.heatFlow.map((v) => v * perGram),
        fromC: data.purity.fromC ?? (T[0] as number),
        toC: data.purity.toC ?? (T[T.length - 1] as number),
        rateKPerMin: data.rateKPerMin as number,
        molarMass: data.purity.molarMass ?? NaN,
        fMin: data.purity.fMin,
        fMax: data.purity.fMax,
      }),
    };
  }
  const iso = isothermOf(data.files.sample, data.exoUp);
  if (!iso) return { ok: false, error: 'The file could not be read.' };
  return {
    method: 'oit',
    ok: true,
    outcome:
      data.oit.switchMin === null
        ? { ok: false, error: 'Type the time of the gas switch.' }
        : oxidationInductionTime({ ...iso, ...data.oit, switchMin: data.oit.switchMin }),
  };
}
