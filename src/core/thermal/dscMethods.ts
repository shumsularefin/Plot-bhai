import type { BaselineKind } from './dsc';
import type { Atmosphere } from './types';

/** The settings that went into a DSC analysis. Every number in the text comes from here. */
export interface DscMethodsInput {
  software: string;
  synthetic: boolean;
  atmosphere: Atmosphere;
  atmosphereOther: string;
  heatingRate: number | null;
  initialMassMg: number | null;
  sample: string;
  /** Label of the ramp analysed, for example "Heating 1". */
  ramp: string;
  cooling: boolean;
  heatFlowUnit: string;
  /** True when the heat flow was divided by the sample mass (J/g results). */
  specific: boolean;
  fileExoUp: boolean;
  displayExoUp: boolean;
  smoothWindowC: number;
  rangeFromC: number | null;
  rangeToC: number | null;
  eventCount: number;
  baselines: BaselineKind[];
  limitsEditedByHand: boolean;
  /** Events the user accepted or changed. */
  assignmentsAccepted: number;
  /** The rule table's citation or its TODO flag. */
  rangeSource: string;
  glass: { windowsEditedByHand: boolean } | null;
  crystallinity: {
    weightFraction: number;
    fullyCrystallineJPerG: number;
    meltingId: number;
    coldId: number | null;
  } | null;
  combined: {
    massSource: 'same file' | 'separate TGA file';
    thresholdPct: number;
    stepCount: number;
    marks: number;
    calcinationMinimumC: number | null;
  } | null;
}

const num = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();

const BASELINE_WORDS: Record<BaselineKind, string> = {
  linear: 'linear',
  sigmoidal: 'sigmoidal',
  spline: 'cubic spline',
};

/** The paragraph, as plain text. */
export function dscMethodsParagraph(input: DscMethodsInput): string {
  const s: string[] = [];
  const gas =
    input.atmosphere === 'other' ? input.atmosphereOther || 'an unspecified gas' : input.atmosphere;
  const run = [
    input.synthetic
      ? 'The differential scanning calorimetry (DSC) curve analysed here is generated example data, not a measurement.'
      : 'A differential scanning calorimetry (DSC) curve was analysed.',
  ];
  const details = [
    `atmosphere: ${gas}`,
    input.heatingRate !== null ? `scan rate: ${num(input.heatingRate)} K/min` : null,
    input.initialMassMg !== null ? `sample mass: ${num(input.initialMassMg)} mg` : null,
  ].filter((d): d is string => d !== null);
  run.push(`Run conditions entered by the user (${details.join('; ')}).`);
  if (input.sample.trim() !== '') run.push(`Sample: ${input.sample.trim()}.`);
  s.push(run.join(' '));
  const prep: string[] = [
    `the ${input.cooling ? 'cooling' : 'heating'} ramp "${input.ramp}" was analysed`,
  ];
  if (input.rangeFromC !== null || input.rangeToC !== null) {
    prep.push(
      `it was cut to ${input.rangeFromC === null ? 'the start' : `${num(input.rangeFromC)} °C`} to ${input.rangeToC === null ? 'the end' : `${num(input.rangeToC)} °C`}`,
    );
  }
  if (input.smoothWindowC > 0)
    prep.push(`it was smoothed with a ${num(input.smoothWindowC)} °C window`);
  prep.push(
    input.specific
      ? `the heat flow (${input.heatFlowUnit}) was expressed per gram of sample`
      : 'the heat flow was not divided by the sample mass, so enthalpies are in mJ',
  );
  const prepText = prep.join('; ');
  s.push(`${prepText.charAt(0).toUpperCase()}${prepText.slice(1)}.`);
  s.push(
    `Exothermic peaks point ${input.fileExoUp ? 'up' : 'down'} in the file and are drawn ${input.displayExoUp ? 'up' : 'down'} in the figures; enthalpies are given with the thermodynamic sign (endothermic positive).`,
  );
  const kinds = [...new Set(input.baselines)].map((b) => BASELINE_WORDS[b]).join(', ');
  s.push(
    input.eventCount === 0
      ? 'No thermal events were analysed.'
      : `${input.eventCount} event${input.eventCount === 1 ? ' was' : 's were'} analysed with ${kinds} baseline${new Set(input.baselines).size === 1 ? '' : 's'}${input.limitsEditedByHand ? ', with limits adjusted by hand' : ''}. The enthalpy is ΔH = −(∫ q dT) / β, with q the heat flow above the baseline and β the scan rate; onset and endset temperatures are extrapolated (tangent at the steepest flank against the baseline) and the peak is the largest distance from the baseline.`,
  );
  if (input.glass) {
    s.push(
      `The glass transition was taken as the half-height (midpoint) temperature between straight lines fitted before and after the step${input.glass.windowsEditedByHand ? ' (fit windows chosen by hand)' : ''}; the heat capacity change is the step height divided by the scan rate.`,
    );
  }
  if (input.crystallinity) {
    const c = input.crystallinity;
    s.push(
      `The degree of crystallinity was estimated as Xc = (ΔHm − ΔHcc) / (w · ΔH0) · 100 % from event ${c.meltingId}${c.coldId !== null ? ` (melting) minus event ${c.coldId} (cold crystallisation)` : ''}, with w = ${num(c.weightFraction)} and ΔH0 = ${num(c.fullyCrystallineJPerG)} J/g as entered by the user.`,
    );
  }
  if (input.assignmentsAccepted > 0) {
    s.push(
      `${input.assignmentsAccepted} event${input.assignmentsAccepted === 1 ? ' was' : 's were'} assigned by the user from ranked suggestions based on typical temperature ranges (${input.rangeSource}). These assignments are interpretations; DSC alone cannot identify what happened in the sample.`,
    );
  }
  if (input.combined) {
    const c = input.combined;
    s.push(
      `The mass curve (${c.massSource}) was interpolated onto the DSC temperatures. A DSC event was read as accompanied by a mass change when the mass at its end differed from that at its start by at least ${num(c.thresholdPct)} % points of the reference mass: mass loss with an endotherm suggests dehydration, evaporation or decomposition; mass loss with an exotherm suggests combustion or oxidation; no mass change with an exotherm suggests crystallisation or a phase transition; no mass change with an endotherm suggests melting or a solid-solid transition. These readings only re-rank the suggestions. ${c.stepCount} mass loss step${c.stepCount === 1 ? ' was' : 's were'} found with the default settings.` +
        (c.calcinationMinimumC !== null
          ? ` A calcination starting point of ${num(c.calcinationMinimumC, 3)} °C was suggested from the last mass loss step${c.marks > 0 ? `, with ${c.marks} exotherm${c.marks === 1 ? '' : 's'} without mass change above it marked as possible crystallisation or phase transition` : ''}; it is to be confirmed experimentally, for example by XRD.`
          : ''),
    );
  }
  s.push(`Analysis software: ${input.software}.`);
  return s.join(' ');
}
