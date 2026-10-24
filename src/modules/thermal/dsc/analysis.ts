import { useMemo } from 'preact/hooks';
import rulesFile from '../../../../data/thermal/dsc-events.json';
import {
  analyseEvent,
  analyseGlassTransition,
  crystallinity,
  defaultGlassWindows,
  detectEvents,
  type CrystallinityResult,
  type DscEvent,
  type DscEventLimit,
  type GlassResult,
  type GlassWindows,
} from '../../../core/thermal/dsc';
import { cleanDsc, type DscCleanResult } from '../../../core/thermal/dscClean';
import {
  guidanceFor,
  type DscGuidance,
  type DscRuleTable,
} from '../../../core/thermal/dscGuidance';
import type { ThermalRun } from '../../../core/thermal/types';
import type { PlotBand } from '../../../ui/plot/types';
import { runOf } from '../analysis';
import type { DscData } from './data';

export const dscRules = rulesFile as DscRuleTable;

/** The run, its cleaned DSC curve and every segment's curve (for overlays). */
export function useDscCurve(data: DscData): {
  run: ThermalRun | null;
  cleaned: DscCleanResult | null;
} {
  const { file, info, setup, clean } = data;
  const run = useMemo(() => runOf(file), [file]);
  const cleaned = useMemo(
    () => (run ? cleanDsc(run, setup, info, clean) : null),
    [run, setup, info, clean],
  );
  return { run, cleaned };
}

export interface DscView {
  limits: DscEventLimit[];
  events: DscEvent[];
  glass: GlassResult | null;
  windows: GlassWindows | null;
  crystallinity: {
    melting: DscEvent | null;
    cold: DscEvent | null;
    result: CrystallinityResult | null;
  };
}

/** Event limits in use: the edited ones, else the automatic detection. */
export function useEventLimits(data: DscData, cleaned: DscCleanResult | null): DscEventLimit[] {
  const curve = cleaned?.ok ? cleaned.curve : null;
  return useMemo(
    () =>
      data.limits ??
      (curve ? detectEvents(curve.temperatureC, curve.exo, data.detect, data.baseline) : []),
    [data.limits, data.detect, data.baseline, curve],
  );
}

/** Events, glass transition and crystallinity of the cleaned curve. */
export function useDscView(data: DscData, cleaned: DscCleanResult | null): DscView | null {
  const curve = cleaned?.ok ? cleaned.curve : null;
  const limits = useEventLimits(data, cleaned);
  const { molarMassGPerMol } = data;
  const events = useMemo(() => {
    if (!curve) return [];
    const context = {
      rateKPerMin: curve.rateKPerMin,
      specific: curve.specific,
      cooling: curve.cooling,
      molarMassGPerMol,
    };
    return limits
      .map((l) => analyseEvent(curve.temperatureC, curve.exo, l, context))
      .filter((e): e is DscEvent => e !== null);
  }, [curve, limits, molarMassGPerMol]);
  const windows = useMemo(
    () =>
      data.glassWindows ??
      (curve
        ? defaultGlassWindows(
            curve.temperatureC,
            curve.exo,
            limits.map((l) => [l.fromC, l.toC] as const),
          )
        : null),
    [data.glassWindows, curve, limits],
  );
  const glass = useMemo(
    () =>
      curve && windows
        ? analyseGlassTransition(curve.temperatureC, curve.exo, windows, {
            rateKPerMin: curve.rateKPerMin,
            specific: curve.specific,
            cooling: curve.cooling,
          })
        : null,
    [curve, windows],
  );
  const cryst = useMemo(() => {
    const s = data.crystallinity;
    const endo = events.filter((e) => e.direction === 'endo' && e.enthalpy !== null);
    const exo = events.filter((e) => e.direction === 'exo' && e.enthalpy !== null);
    const melting =
      (s.meltingId !== null ? events.find((e) => e.id === s.meltingId) : null) ??
      endo.reduce<DscEvent | null>(
        (best, e) => (best === null || (e.enthalpy ?? 0) > (best.enthalpy ?? 0) ? e : best),
        null,
      );
    // Cold crystallisation is an exotherm below the melting peak; take the largest by default.
    const cold =
      s.coldId === 'none'
        ? null
        : ((s.coldId !== null ? events.find((e) => e.id === s.coldId) : null) ??
          exo
            .filter((e) => melting === null || e.peakC < melting.peakC)
            .reduce<DscEvent | null>(
              (best, e) => (best === null || (e.enthalpy ?? 0) < (best.enthalpy ?? 0) ? e : best),
              null,
            ));
    const unit = curve?.specific === true && !curve.cooling;
    let result: CrystallinityResult | null = null;
    if (melting && melting.enthalpy !== null && unit) {
      result = crystallinity({
        meltingJPerG: melting.enthalpy,
        coldJPerG: cold?.enthalpy != null ? Math.abs(cold.enthalpy) : 0,
        weightFraction: s.weightFraction,
        fullyCrystallineJPerG: s.fullyCrystallineJPerG ?? 0,
      });
    }
    return { melting, cold, result };
  }, [events, data.crystallinity, curve]);
  if (!curve) return null;
  return { limits, events, glass, windows, crystallinity: cryst };
}

/** The ranked guidance for one event. */
export function guidance(data: DscData, event: DscEvent, cooling: boolean): DscGuidance[] {
  return guidanceFor(
    {
      event,
      scan: cooling ? 'cooling' : 'heating',
      atmosphere: data.info.atmosphere,
      category: data.info.category,
    },
    dscRules.events,
  );
}

export const eventBands = (events: readonly DscEvent[]): PlotBand[] =>
  events.map((e) => ({ fromX: e.fromC, toX: e.toC, label: String(e.id) }));
