import { thermalMethodsParagraph, type ThermalMethodsInput } from '../../core/thermal/methods';
import type { StepResult } from '../../core/thermal/steps';
import type { CalcinationSuggestion } from '../../core/thermal/calcination';
import { theoryView } from './analysis';
import type { ThermalData } from './data';

const SOFTWARE = 'XRD Toolkit (free, runs in the browser; version not recorded)';

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(
  data: ThermalData,
  steps: readonly StepResult[],
  calcination: CalcinationSuggestion | null,
): ThermalMethodsInput {
  const theory = theoryView(data, steps);
  const used = theory.step !== null && theory.result.ok;
  return {
    software: SOFTWARE,
    synthetic: data.file?.synthetic ?? false,
    atmosphere: data.info.atmosphere,
    atmosphereOther: data.info.atmosphereOther,
    heatingRate: data.info.heatingRate,
    initialMassMg: data.info.initialMassMg,
    sample: data.info.sample,
    category: data.info.category,
    clean: {
      fromC: data.clean.fromC,
      toC: data.clean.toC,
      smoothWindowC: data.clean.smoothWindowC,
      normaliseAtC: data.clean.normaliseAtC,
      blank: data.clean.useBlank && data.blank !== null,
    },
    dtgWindowC: data.steps.dtgWindowC,
    prominencePercent: data.steps.detect.prominencePercent,
    minSeparationC: data.steps.detect.minSeparationC,
    limitsEditedByHand: data.steps.limits !== null,
    stepCount: steps.length,
    assignmentsAccepted: steps.filter((s) => {
      const a = data.assignments[s.id];
      return a !== undefined && a.status !== 'rejected';
    }).length,
    rangeSource: 'typical temperature ranges that are not yet checked against a published source',
    theory:
      used && theory.result.ok
        ? {
            precursor: data.theory.reaction.precursor,
            product: data.theory.reaction.product,
            lossPct: theory.result.lossPct,
          }
        : null,
    calcination:
      calcination?.ok === true
        ? {
            marginC: data.calcination.marginC,
            minLossPct: data.calcination.minLossPct,
            minimumC: calcination.minimumC,
          }
        : null,
  };
}

export const methodsText = (
  data: ThermalData,
  steps: readonly StepResult[],
  calcination: CalcinationSuggestion | null,
): string => thermalMethodsParagraph(methodsInput(data, steps, calcination));
