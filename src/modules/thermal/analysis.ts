import { useMemo } from 'preact/hooks';
import eventsFile from '../../../data/thermal/events.json';
import weightsFile from '../../../data/thermal/atomic-weights.json';
import type { CalcinationSuggestion } from '../../core/thermal/calcination';
import { suggestCalcination } from '../../core/thermal/calcination';
import {
  rankEvents,
  type EventCandidate,
  type EventRule,
  type EventTable,
} from '../../core/thermal/events';
import {
  theoreticalLoss,
  type AtomicWeights,
  type TheoreticalResult,
} from '../../core/thermal/formula';
import { buildRun } from '../../core/thermal/import';
import { cleanRun, interpolate, type CleanResult } from '../../core/thermal/process';
import { dtg } from '../../core/thermal/smooth';
import {
  analyseSteps,
  detectSteps,
  massAtTemperature,
  temperatureAtMass,
  type StepAnalysis,
  type StepLimit,
  type StepResult,
} from '../../core/thermal/steps';
import type { ThermalRun } from '../../core/thermal/types';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { PlotBand } from '../../ui/plot/types';
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

export const eventTable = eventsFile as EventTable;
export const eventRules: readonly EventRule[] = eventTable.events;

/** Standard atomic weights in g/mol by symbol (data/thermal/atomic-weights.json, CIAAW 2024). */
export const atomicWeights: AtomicWeights = Object.fromEntries(
  weightsFile.elements.map((e) => [e.symbol, e.weight]),
);

export const ATOMIC_WEIGHTS_CITATION = `${weightsFile.source.citation}, ${weightsFile.source.url}`;

/** The cleaned curve and its steps in one place, for the steps after step 3. */
export function useThermalView(data: ThermalData) {
  const { cleaned } = useCleaned(data);
  const view = useStepsView(data, cleaned);
  const curve = cleaned?.ok ? cleaned.curve : null;
  return { cleaned, curve, view };
}

export interface TheoryView {
  result: TheoreticalResult;
  /** The step compared with, if one is chosen and exists. */
  step: StepResult | null;
  /** Measured loss as % of the mass just before the step, the basis of the theoretical value. */
  measuredPct: number | null;
  /** Measured minus theoretical, in % points. */
  differencePct: number | null;
  agrees: boolean;
}

/** Theoretical loss of the entered reaction and its comparison with the chosen step. */
export function theoryView(data: ThermalData, steps: readonly StepResult[]): TheoryView {
  const result = theoreticalLoss(data.theory.reaction, atomicWeights);
  const step = steps.find((s) => s.id === data.theory.stepId) ?? null;
  const measuredPct =
    step && step.massBeforePct > 0 ? (step.lossPct / step.massBeforePct) * 100 : null;
  const differencePct = result.ok && measuredPct !== null ? measuredPct - result.lossPct : null;
  return {
    result,
    step,
    measuredPct,
    differencePct,
    agrees: differencePct !== null && Math.abs(differencePct) <= data.theory.agreeWithinPct,
  };
}

/** Ranked suggestions for every step. The theory agreement raises the confidence of the compared step only. */
export function candidatesFor(
  data: ThermalData,
  steps: readonly StepResult[],
  theory: TheoryView,
): Map<number, EventCandidate[]> {
  const out = new Map<number, EventCandidate[]>();
  for (const step of steps) {
    out.set(
      step.id,
      rankEvents(
        {
          peakC: step.peakC,
          lossPct: step.lossPct,
          theoryAgrees: theory.step?.id === step.id && theory.agrees,
        },
        { atmosphere: data.info.atmosphere, category: data.info.category },
        eventRules,
      ),
    );
  }
  return out;
}

/** Shaded step regions with their numbers, for the plots. */
export function stepBands(steps: readonly StepResult[]): PlotBand[] {
  return steps.map((s) => ({ fromX: s.fromC, toX: s.toC, label: String(s.id) }));
}

/** Calcination suggestion from the cleaned curve and the steps in use. */
export function calcinationOf(
  data: ThermalData,
  curve: { temperatureC: Float64Array; massPct: Float64Array } | null,
  steps: readonly StepResult[],
): CalcinationSuggestion | null {
  return curve
    ? suggestCalcination(curve.temperatureC, curve.massPct, steps, data.calcination)
    : null;
}

/** The event text of a step as the user settled it ('' when accepted nothing or rejected). */
export function assignedLabel(data: ThermalData, stepId: number): string {
  const a = data.assignments[stepId];
  return a && a.status !== 'rejected' ? a.label : '';
}

/** Mass at each step's DTG peak, for numbering the steps on the mass curve. */
export function stepNumberLabels(
  steps: readonly StepResult[],
  temperatureC: Float64Array,
  massPct: Float64Array,
): PeakLabelSet {
  return {
    labels: steps.map((s) => ({
      x: s.peakC,
      y: interpolate(temperatureC, massPct, s.peakC),
      text: String(s.id),
    })),
    key: [],
  };
}
