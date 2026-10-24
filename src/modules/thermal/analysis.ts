import { useMemo } from 'preact/hooks';
import { buildRun } from '../../core/thermal/import';
import { cleanRun, type CleanResult } from '../../core/thermal/process';
import { dtg } from '../../core/thermal/smooth';
import {
  analyseSteps,
  detectSteps,
  massAtTemperature,
  temperatureAtMass,
  type StepAnalysis,
  type StepLimit,
} from '../../core/thermal/steps';
import type { ThermalRun } from '../../core/thermal/types';
import type { LoadedTable, ThermalData } from './data';

export function runOf(loaded: LoadedTable | null): ThermalRun | null {
  if (!loaded) return null;
  const built = buildRun(loaded.name, loaded.table, loaded.mapping);
  return built.ok ? built.run : null;
}

/** The message to show when the loaded table cannot become a run, else null. */
export function mappingProblem(loaded: LoadedTable | null): string | null {
  if (!loaded) return null;
  const built = buildRun(loaded.name, loaded.table, loaded.mapping);
  return built.ok ? null : built.error;
}

/** The sample run, the optional blank, and the cleaned TGA curve built from them. */
export function useCleaned(data: ThermalData): {
  run: ThermalRun | null;
  blank: ThermalRun | null;
  cleaned: CleanResult | null;
} {
  const { file, blank: blankFile, info, clean } = data;
  const run = useMemo(() => runOf(file), [file]);
  const blank = useMemo(() => runOf(blankFile), [blankFile]);
  const cleaned = useMemo(
    () => (run ? cleanRun(run, blank, info, clean) : null),
    [run, blank, info, clean],
  );
  return { run, blank, cleaned };
}

export interface StepsView {
  /** DTG in %/°C. */
  dtg: Float64Array;
  /** Limits in use: the edited ones, else the automatic detection. */
  limits: StepLimit[];
  analysis: StepAnalysis;
  t5: number | null;
  t10: number | null;
  t50: number | null;
  residuePct: number | null;
}

/** DTG, step limits and numbers of the cleaned curve. The DTG is only recomputed when its inputs change. */
export function useStepsView(data: ThermalData, cleaned: CleanResult | null): StepsView | null {
  const curve = cleaned?.ok ? cleaned.curve : null;
  const { dtgWindowC, detect, limits: edited, residueAtC } = data.steps;
  const slope = useMemo(
    () => (curve ? dtg(curve.temperatureC, curve.massPct, dtgWindowC) : null),
    [curve, dtgWindowC],
  );
  const detected = useMemo(
    () => (curve && slope ? detectSteps(curve.temperatureC, slope, detect) : []),
    [curve, slope, detect],
  );
  const limits = edited ?? detected;
  return useMemo(() => {
    if (!curve || !slope) return null;
    const { temperatureC: T, massPct, referenceMg } = curve;
    return {
      dtg: slope,
      limits,
      analysis: analyseSteps(T, massPct, slope, limits, referenceMg),
      t5: temperatureAtMass(T, massPct, 95),
      t10: temperatureAtMass(T, massPct, 90),
      t50: temperatureAtMass(T, massPct, 50),
      residuePct: residueAtC === null ? null : massAtTemperature(T, massPct, residueAtC),
    };
  }, [curve, slope, limits, residueAtC]);
}
