import { useMemo } from 'preact/hooks';
import combinedFile from '../../../../data/thermal/combined-rules.json';
import {
  suggestCalcination,
  DEFAULT_CALCINATION,
  type CalcinationSuggestion,
} from '../../../core/thermal/calcination';
import {
  alignOnTemperature,
  calcinationMarks,
  correlateEvent,
  rerankDscGuidance,
  rerankStepCandidates,
  type AlignedCurves,
  type CalcinationMark,
  type CombinedGuidance,
  type Correlation,
} from '../../../core/thermal/combined';
import type { DscEvent } from '../../../core/thermal/dsc';
import type { DscCurve } from '../../../core/thermal/dscClean';
import type { EventCandidate } from '../../../core/thermal/events';
import { rankEvents } from '../../../core/thermal/events';
import { cleanRun, DEFAULT_CLEAN } from '../../../core/thermal/process';
import { dtg } from '../../../core/thermal/smooth';
import {
  analyseSteps,
  DEFAULT_DETECT,
  detectSteps,
  type StepResult,
} from '../../../core/thermal/steps';
import type { TgaCurve } from '../../../core/thermal/types';
import { eventRules, runOf } from '../analysis';
import { DEFAULT_STEP_SETTINGS } from '../data';
import { dscRules } from './analysis';
import type { DscData } from './data';

/** Usual heat flow direction of each TGA rule; the file says which are checked and which are placeholders. */
const usualDirection = combinedFile.tgaUsualDirection as Record<string, 'endo' | 'exo' | 'either'>;

/** Shown wherever the combined suggestions appear, because the two rule tables are not checked yet. */
export const COMBINED_UNVERIFIED_NOTE =
  'Partly verified: the endo or exo direction of the DSC events and of moisture, bound water and carbon oxidation is checked against Gaisford, Kett and Haines (2016). The temperature ranges (data/thermal/dsc-events.json) and the usual direction of the other mass loss events (data/thermal/combined-rules.json) are placeholders flagged "TODO, verify". Treat the ranking as a rough guide until you have checked them against your own sources.';

export interface CombinedView {
  tga: TgaCurve;
  aligned: AlignedCurves;
  steps: StepResult[];
  correlations: Correlation[];
  /** Re-ranked DSC suggestions per DSC event id. */
  eventGuidance: Map<number, CombinedGuidance[]>;
  /** Re-ranked TGA suggestions per step id, with the DSC event inside the step if there is one. */
  stepGuidance: Map<number, { candidates: EventCandidate[]; eventId: number | null }>;
  calcination: CalcinationSuggestion;
  marks: CalcinationMark[];
  /** Where the mass curve came from. */
  source: 'same file' | 'separate TGA file';
}

export type CombinedResult = { ok: true; view: CombinedView } | { ok: false; message: string };

/**
 * The mass curve of the combined view, aligned to the DSC temperatures, with the correlation of
 * every event, the re-ranked suggestions and the calcination marks. The mass curve is cleaned with
 * the TGA defaults (heating ramp, no smoothing beyond the default) and its steps are found with the
 * default detection; the separate TGA wizard keeps its own settings.
 */
export function useCombined(
  data: DscData,
  curve: DscCurve | null,
  events: readonly DscEvent[],
): CombinedResult {
  const { file, tgaFile, info, massThresholdPct } = data;
  const source = tgaFile ? tgaFile : file;
  const run = useMemo(() => runOf(source), [source]);
  const massClean = useMemo(
    () => (run?.mass ? cleanRun(run, null, info, DEFAULT_CLEAN) : null),
    [run, info],
  );
  const tga = massClean?.ok ? massClean.curve : null;
  const steps = useMemo(() => {
    if (!tga) return [];
    const slope = dtg(tga.temperatureC, tga.massPct, DEFAULT_STEP_SETTINGS.dtgWindowC);
    const limits = detectSteps(tga.temperatureC, slope, DEFAULT_DETECT);
    return analyseSteps(tga.temperatureC, tga.massPct, slope, limits, tga.referenceMg).steps;
  }, [tga]);

  return useMemo<CombinedResult>(() => {
    if (!curve) return { ok: false, message: 'There is no DSC curve yet.' };
    if (curve.cooling) {
      return {
        ok: false,
        message:
          'The ramp chosen in step 2 is a cooling ramp. The combined view needs a heating ramp, because the mass curve is read on heating. Choose a heating ramp in step 2.',
      };
    }
    if (!run?.mass || !massClean) {
      return {
        ok: false,
        message:
          'There is no mass curve. Choose the mass column of your file in step 1, or load a separate TGA run there.',
      };
    }
    if (!massClean.ok) return { ok: false, message: massClean.error };
    const aligned = alignOnTemperature(curve, massClean.curve);
    if (!aligned) {
      return {
        ok: false,
        message:
          'The temperature ranges of the DSC curve and the mass curve do not overlap enough to compare them.',
      };
    }
    const mass = massClean.curve;
    const correlations = events.map((e) => correlateEvent(e, mass, massThresholdPct));
    const eventGuidance = new Map<number, CombinedGuidance[]>();
    events.forEach((event, i) => {
      eventGuidance.set(
        event.id,
        rerankDscGuidance(
          {
            event,
            scan: 'heating',
            atmosphere: info.atmosphere,
            category: info.category,
          },
          dscRules.events,
          correlations[i] as Correlation,
        ),
      );
    });
    const stepGuidance = new Map<
      number,
      { candidates: EventCandidate[]; eventId: number | null }
    >();
    for (const step of steps) {
      const ranked = rankEvents(
        { peakC: step.peakC, lossPct: step.lossPct },
        { atmosphere: info.atmosphere, category: info.category },
        eventRules,
      );
      const result = rerankStepCandidates(step, ranked, events, usualDirection);
      stepGuidance.set(step.id, {
        candidates: result.candidates,
        eventId: result.event?.id ?? null,
      });
    }
    const calcination = suggestCalcination(
      mass.temperatureC,
      mass.massPct,
      steps,
      DEFAULT_CALCINATION,
    );
    return {
      ok: true,
      view: {
        tga: mass,
        aligned,
        steps,
        correlations,
        eventGuidance,
        stepGuidance,
        calcination,
        marks: calcinationMarks(calcination, correlations, events),
        source: tgaFile ? 'separate TGA file' : 'same file',
      },
    };
  }, [curve, run, massClean, events, steps, massThresholdPct, info, tgaFile]);
}
