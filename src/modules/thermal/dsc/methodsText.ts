import { SOFTWARE } from '../../../ui/software';
import { dscMethodsParagraph, type DscMethodsInput } from '../../../core/thermal/dscMethods';
import { displayExoUp, type DscCurve } from '../../../core/thermal/dscClean';
import type { DscView } from './analysis';
import type { CombinedResult } from './combinedAnalysis';
import type { DscData } from './data';

/** The settings that went into the analysis, read from the saved session. */
export function dscMethodsInput(
  data: DscData,
  curve: DscCurve,
  view: DscView,
  combined: CombinedResult,
): DscMethodsInput {
  const cryst = view.crystallinity;
  return {
    software: SOFTWARE,
    synthetic: data.file?.synthetic ?? false,
    digitized: data.file?.digitized ?? false,
    atmosphere: data.info.atmosphere,
    atmosphereOther: data.info.atmosphereOther,
    heatingRate: curve.rateKPerMin,
    initialMassMg: data.info.initialMassMg,
    sample: data.info.sample,
    ramp: curve.segment.label,
    cooling: curve.cooling,
    heatFlowUnit: data.setup.unit,
    specific: curve.specific,
    fileExoUp: data.setup.fileExoUp ?? true,
    displayExoUp: displayExoUp(data.setup),
    smoothWindowC: data.clean.smoothWindowC,
    rangeFromC: data.clean.fromC,
    rangeToC: data.clean.toC,
    eventCount: view.events.length,
    baselines: view.limits.map((l) => l.baseline),
    limitsEditedByHand: data.limits !== null,
    assignmentsAccepted: [
      ...Object.values(data.assignments),
      ...(combined.ok ? Object.values(data.stepAssignments) : []),
    ].filter((a) => a.status !== 'rejected').length,
    rangeSource: 'typical temperature ranges that are not yet checked against a published source',
    glass: view.glass?.ok ? { windowsEditedByHand: data.glassWindows !== null } : null,
    crystallinity:
      cryst.result?.ok && cryst.melting
        ? {
            weightFraction: data.crystallinity.weightFraction,
            fullyCrystallineJPerG: data.crystallinity.fullyCrystallineJPerG ?? 0,
            meltingId: cryst.melting.id,
            coldId: cryst.cold?.id ?? null,
          }
        : null,
    combined: combined.ok
      ? {
          massSource: combined.view.source,
          thresholdPct: data.massThresholdPct,
          stepCount: combined.view.steps.length,
          marks: combined.view.marks.length,
          calcinationMinimumC: combined.view.calcination.ok
            ? combined.view.calcination.minimumC
            : null,
        }
      : null,
  };
}

export const dscMethodsText = (
  data: DscData,
  curve: DscCurve,
  view: DscView,
  combined: CombinedResult,
): string => dscMethodsParagraph(dscMethodsInput(data, curve, view, combined));
