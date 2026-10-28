import type { Atmosphere, SampleCategory } from './types';

/** The settings that went into the analysis. Every number in the text comes from here. */
export interface ThermalMethodsInput {
  software: string;
  synthetic: boolean;
  /** True when the curve was digitized from a figure image. */
  digitized?: boolean;
  atmosphere: Atmosphere;
  atmosphereOther: string;
  heatingRate: number | null;
  initialMassMg: number | null;
  sample: string;
  category: SampleCategory;
  clean: {
    fromC: number | null;
    toC: number | null;
    smoothWindowC: number;
    normaliseAtC: number | null;
    blank: boolean;
  };
  dtgWindowC: number;
  prominencePercent: number;
  minSeparationC: number;
  limitsEditedByHand: boolean;
  stepCount: number;
  /** Events the user accepted or changed. */
  assignmentsAccepted: number;
  /** The rule table's citation or its TODO flag. */
  rangeSource: string;
  theory: { precursor: string; product: string; lossPct: number } | null;
  calcination: { marginC: number; minLossPct: number; minimumC: number } | null;
  /** Evolved gas signals shown with the DTG: their number and whether time was mapped to temperature. */
  evolved: { signals: number; fromTime: boolean; synthetic: boolean } | null;
}

const num = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();

/** The paragraph, as plain text. */
export function thermalMethodsParagraph(input: ThermalMethodsInput): string {
  const s: string[] = [];
  const gas =
    input.atmosphere === 'other' ? input.atmosphereOther || 'an unspecified gas' : input.atmosphere;
  const run = [
    input.synthetic
      ? 'The thermogravimetric curve analysed here is generated example data, not a measurement.'
      : input.digitized
        ? 'A thermogravimetric (TGA) curve digitized from a figure image was analysed, so the temperatures and mass losses read from it are approximate.'
        : 'A thermogravimetric (TGA) curve was analysed.',
  ];
  const details = [
    `atmosphere: ${gas}`,
    input.heatingRate !== null ? `heating rate: ${num(input.heatingRate)} K/min` : null,
    input.initialMassMg !== null ? `initial sample mass: ${num(input.initialMassMg)} mg` : null,
  ].filter((d): d is string => d !== null);
  run.push(`Run conditions entered by the user (${details.join('; ')}).`);
  if (input.sample.trim() !== '') run.push(`Sample: ${input.sample.trim()}.`);
  s.push(run.join(' '));
  const c = input.clean;
  const cleaning: string[] = [];
  if (c.fromC !== null || c.toC !== null) {
    cleaning.push(
      `the heating ramp was cut to ${c.fromC === null ? 'the start' : `${num(c.fromC)} °C`} to ${c.toC === null ? 'the end' : `${num(c.toC)} °C`}`,
    );
  }
  if (c.blank) cleaning.push('a blank (empty crucible) curve was subtracted');
  if (c.smoothWindowC > 0)
    cleaning.push(`the mass was smoothed with a ${num(c.smoothWindowC)} °C window`);
  if (c.normaliseAtC !== null)
    cleaning.push(`the mass was set to 100 % at ${num(c.normaliseAtC)} °C`);
  if (cleaning.length > 0) s.push(`Before analysis, ${cleaning.join(', ')}.`);
  s.push(
    `The derivative (DTG, −dm/dT) was computed with a local quadratic fit over a ${num(input.dtgWindowC)} °C window. Mass loss steps were taken from DTG peaks at least ${num(input.prominencePercent)} % as prominent as the tallest peak and at least ${num(input.minSeparationC)} °C apart${input.limitsEditedByHand ? ', and their limits were then adjusted by hand' : ''}; ${input.stepCount} step${input.stepCount === 1 ? ' was' : 's were'} analysed. Onset and endset temperatures are extrapolated (tangent at the steepest point against the baselines at the step limits), and mass loss is the difference of the mass at the two limits.`,
  );
  if (input.assignmentsAccepted > 0) {
    s.push(
      `${input.assignmentsAccepted} step${input.assignmentsAccepted === 1 ? ' was' : 's were'} assigned to events by the user from ranked suggestions based on typical temperature ranges (${input.rangeSource}). These assignments are interpretations; TGA alone cannot identify the evolved species.`,
    );
  }
  if (input.theory) {
    s.push(
      `The theoretical mass loss of ${input.theory.precursor} → ${input.theory.product} is ${num(input.theory.lossPct, 4)} %, from IUPAC standard atomic weights.`,
    );
  }
  if (input.calcination) {
    s.push(
      `A minimum calcination temperature of ${num(input.calcination.minimumC, 3)} °C was suggested as the extrapolated endset of the last step losing at least ${num(input.calcination.minLossPct)} % plus a margin of ${num(input.calcination.marginC)} °C; this is a starting point to be confirmed experimentally.`,
    );
  }
  if (input.evolved && input.evolved.signals > 0) {
    const e = input.evolved;
    s.push(
      `${e.signals} evolved gas signal${e.signals === 1 ? ' was' : 's were'} compared with the DTG on a common temperature axis${e.fromTime ? ' (their time axis was converted to temperature with the time and temperature columns of the TGA run; transfer-line delay was not corrected)' : ''}, each scaled to its own maximum${e.synthetic ? '; the signals are synthetic example data' : ''}.`,
    );
  }
  s.push(`Analysis software: ${input.software}.`);
  return s.join(' ');
}
