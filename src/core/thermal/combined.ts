import { formatNumber } from '../xrd/parsers/numbers';
import type { CalcinationSuggestion } from './calcination';
import type { DscEvent } from './dsc';
import { guidanceFor, type DscEvidence, type DscGuidance, type DscRule } from './dscGuidance';
import type { Confidence, EventCandidate } from './events';
import { interpolate } from './process';
import type { StepResult } from './steps';

/** A TGA mass curve and a DSC curve on one temperature axis (the DSC temperatures). */
export interface AlignedCurves {
  temperatureC: Float64Array;
  /** Mass in % of the reference mass, interpolated linearly onto `temperatureC`. */
  massPct: Float64Array;
  /** Exo-positive heat flow at the same temperatures (not changed). */
  exo: Float64Array;
  fromC: number;
  toC: number;
}

/**
 * Puts the mass on the DSC temperatures. Both inputs must have increasing temperature. Only DSC
 * points inside the temperature range covered by both curves are kept, so no mass value is
 * extrapolated; each kept point gets the mass interpolated linearly between its two TGA
 * neighbours. Returns null if the ranges do not overlap by at least 10 DSC points.
 */
export function alignOnTemperature(
  dsc: { temperatureC: Float64Array; exo: Float64Array },
  tga: { temperatureC: Float64Array; massPct: Float64Array },
): AlignedCurves | null {
  const lo = Math.max(dsc.temperatureC[0] as number, tga.temperatureC[0] as number);
  const hi = Math.min(
    dsc.temperatureC[dsc.temperatureC.length - 1] as number,
    tga.temperatureC[tga.temperatureC.length - 1] as number,
  );
  const keep: number[] = [];
  for (let i = 0; i < dsc.temperatureC.length; i++) {
    const t = dsc.temperatureC[i] as number;
    if (t >= lo && t <= hi) keep.push(i);
  }
  if (keep.length < 10) return null;
  const temperatureC = Float64Array.from(keep, (i) => dsc.temperatureC[i] as number);
  return {
    temperatureC,
    massPct: Float64Array.from(temperatureC, (t) => interpolate(tga.temperatureC, tga.massPct, t)),
    exo: Float64Array.from(keep, (i) => dsc.exo[i] as number),
    fromC: lo,
    toC: hi,
  };
}

export type MassChange = 'loss' | 'none' | 'gain';

/** The four correlations of the specification, plus a note for a mass gain. */
export type CorrelationKind =
  'loss-endo' | 'loss-exo' | 'none-exo' | 'none-endo' | 'gain-endo' | 'gain-exo';

export interface Correlation {
  eventId: number;
  direction: 'endo' | 'exo';
  /** Mass at the end of the event minus mass at its start, % points of the reference mass (negative = loss). */
  massChangePct: number;
  change: MassChange;
  kind: CorrelationKind;
  /** Plain-language reading, shown as guidance. */
  text: string;
  /** Ids of DSC rules this supports and counts against (data/thermal/dsc-events.json). */
  supports: string[];
  against: string[];
}

/** A mass change smaller than this (% points of the reference mass) counts as "no mass change". My own default; adjustable. */
export const DEFAULT_MASS_THRESHOLD_PCT = 0.5;

const WITHOUT_MASS_LOSS = ['melting', 'crystallisation', 'solid-solid'];
const WITH_MASS_LOSS = ['dehydration-evaporation', 'oxidation', 'decomposition'];

/**
 * Reads one DSC event against the mass change over its limits. With Δm = m(end) − m(start) (in %
 * points) and the threshold θ: loss if Δm ≤ −θ, gain if Δm ≥ θ, otherwise no change. Rules:
 *  - loss + endotherm: dehydration, evaporation or decomposition;
 *  - loss + exotherm: combustion or oxidation;
 *  - no change + exotherm: crystallisation, a phase transition or structural ordering;
 *  - no change + endotherm: melting or a solid-solid transition.
 * Only the first group's rules count against events without a mass change and vice versa. A mass
 * gain is reported without re-ranking anything. All of this is guidance, not identification.
 */
export function correlateEvent(
  event: Pick<DscEvent, 'id' | 'direction' | 'fromC' | 'toC'>,
  tga: { temperatureC: Float64Array; massPct: Float64Array },
  thresholdPct: number = DEFAULT_MASS_THRESHOLD_PCT,
): Correlation {
  const delta =
    interpolate(tga.temperatureC, tga.massPct, event.toC) -
    interpolate(tga.temperatureC, tga.massPct, event.fromC);
  const change: MassChange =
    delta <= -thresholdPct ? 'loss' : delta >= thresholdPct ? 'gain' : 'none';
  const endo = event.direction === 'endo';
  const base = { eventId: event.id, direction: event.direction, massChangePct: delta, change };
  const size = `${formatNumber(Math.abs(delta), 2)} % of the reference mass`;
  if (change === 'loss') {
    return endo
      ? {
          ...base,
          kind: 'loss-endo',
          text: `Mass is lost (${size}) while heat is absorbed: this suggests dehydration, evaporation or decomposition.`,
          supports: ['dehydration-evaporation', 'decomposition'],
          against: WITHOUT_MASS_LOSS,
        }
      : {
          ...base,
          kind: 'loss-exo',
          text: `Mass is lost (${size}) while heat is released: this suggests combustion or oxidation.`,
          supports: ['oxidation'],
          against: WITHOUT_MASS_LOSS,
        };
  }
  if (change === 'gain') {
    return {
      ...base,
      kind: endo ? 'gain-endo' : 'gain-exo',
      text: `Mass increases (${size}) during this ${endo ? 'endotherm' : 'exotherm'}. That can be a reaction with the gas, such as oxidation, or a buoyancy or drift artefact; check the baseline of the TGA. No suggestion is re-ranked.`,
      supports: [],
      against: [],
    };
  }
  return endo
    ? {
        ...base,
        kind: 'none-endo',
        text: `The mass does not change (less than ${formatNumber(thresholdPct, 2)} % points) while heat is absorbed: this suggests melting or a solid-solid transition.`,
        supports: ['melting', 'solid-solid'],
        against: WITH_MASS_LOSS,
      }
    : {
        ...base,
        kind: 'none-exo',
        text: `The mass does not change (less than ${formatNumber(thresholdPct, 2)} % points) while heat is released: this suggests crystallisation, a phase transition or structural ordering.`,
        supports: ['crystallisation', 'solid-solid'],
        against: WITH_MASS_LOSS,
      };
}

/** Score added for a rule the mass evidence supports and removed for one it counts against. My own weights; they only order the suggestions. */
export const CORRELATION_WEIGHT = 0.25;

export interface CombinedGuidance extends Omit<DscGuidance, 'confidence'> {
  confidence: Confidence;
  /** 'supported', 'against' or 'neutral' from the mass evidence. */
  mass: 'supported' | 'against' | 'neutral';
}

/**
 * DSC guidance for one event re-ranked with the mass evidence: score + 0.25 for a supported rule,
 * − 0.25 for one counted against, then the best three. A supported rule that was already "medium"
 * (peak inside the range, direction matches) becomes "high"; a rule counted against drops one
 * level. Only the combined view can give "high".
 */
export function rerankDscGuidance(
  evidence: DscEvidence,
  rules: readonly DscRule[],
  correlation: Correlation,
): CombinedGuidance[] {
  const all = guidanceFor(evidence, rules, rules.length);
  const down: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };
  return all
    .map<CombinedGuidance>((g) => {
      const mass = correlation.supports.includes(g.rule.id)
        ? 'supported'
        : correlation.against.includes(g.rule.id)
          ? 'against'
          : 'neutral';
      const sign = mass === 'supported' ? 1 : mass === 'against' ? -1 : 0;
      const confidence: Confidence =
        mass === 'supported' && g.confidence === 'medium'
          ? 'high'
          : mass === 'against'
            ? down[g.confidence]
            : g.confidence;
      const extra =
        mass === 'supported'
          ? 'The mass curve supports it.'
          : mass === 'against'
            ? 'The mass curve counts against it.'
            : '';
      return {
        ...g,
        score: g.score + sign * CORRELATION_WEIGHT,
        confidence,
        mass,
        reason: `${g.reason} ${correlation.text}${extra ? ` ${extra}` : ''}`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * Re-ranks the TGA step suggestions with the DSC events whose peak lies inside the step's limits.
 * `usual` gives the usual heat flow direction of each TGA rule ('endo', 'exo' or 'either'); a
 * candidate gets +0.25 when the event direction equals it and −0.25 when it is the opposite.
 * A candidate that is counted against drops one confidence level. Steps with no DSC event inside
 * are returned unchanged.
 */
export function rerankStepCandidates(
  step: Pick<StepResult, 'fromC' | 'toC'>,
  candidates: readonly EventCandidate[],
  events: readonly Pick<DscEvent, 'id' | 'direction' | 'peakC'>[],
  usual: Readonly<Record<string, 'endo' | 'exo' | 'either'>>,
): { candidates: EventCandidate[]; event: Pick<DscEvent, 'id' | 'direction' | 'peakC'> | null } {
  const event = events.find((e) => e.peakC >= step.fromC && e.peakC <= step.toC) ?? null;
  if (!event) return { candidates: [...candidates], event: null };
  const down: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };
  const word = event.direction === 'endo' ? 'an endotherm' : 'an exotherm';
  const ranked = candidates
    .map<EventCandidate>((c) => {
      const expected = usual[c.rule.id] ?? 'either';
      const sign = expected === 'either' ? 0 : expected === event.direction ? 1 : -1;
      const note =
        sign === 1
          ? `DSC event ${event.id} in this step is ${word}, as usual for this kind of event.`
          : sign === -1
            ? `DSC event ${event.id} in this step is ${word}, which is unusual for this kind of event.`
            : `DSC event ${event.id} in this step is ${word}; this kind of event can go either way.`;
      return {
        ...c,
        score: c.score + sign * CORRELATION_WEIGHT,
        confidence: sign === -1 ? down[c.confidence] : c.confidence,
        reason: `${c.reason} ${note}`,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { candidates: ranked, event };
}

/** A crystallisation-like exotherm above the last mass loss step, for the calcination suggestion. */
export interface CalcinationMark {
  eventId: number;
  peakC: number;
  /** Candidate temperatures (from the TGA suggestion) that lie below the exotherm's peak. */
  candidatesBelowC: number[];
  text: string;
}

/**
 * Marks exotherms without mass change whose peak lies above the endset of the last significant
 * mass loss step (the correlation 'none-exo': crystallisation, a phase transition or ordering).
 * A calcination temperature below such an exotherm may leave the sample before that change, so the
 * text recommends checking by XRD. Guidance only.
 */
export function calcinationMarks(
  suggestion: CalcinationSuggestion,
  correlations: readonly Correlation[],
  events: readonly Pick<DscEvent, 'id' | 'peakC' | 'onsetC'>[],
): CalcinationMark[] {
  if (!suggestion.ok) return [];
  const marks: CalcinationMark[] = [];
  for (const c of correlations) {
    if (c.kind !== 'none-exo') continue;
    const event = events.find((e) => e.id === c.eventId);
    if (!event || !(event.peakC > suggestion.step.endsetC)) continue;
    const candidatesBelowC = suggestion.candidatesC.filter((t) => t < event.peakC);
    const t = formatNumber(event.peakC, 0);
    marks.push({
      eventId: event.id,
      peakC: event.peakC,
      candidatesBelowC,
      text:
        `DSC event ${event.id} is an exotherm at ${t} °C without a mass change, above the last mass loss step (which ends at ${formatNumber(suggestion.step.endsetC, 0)} °C). It may be crystallisation, a phase transition or structural ordering. ` +
        (candidatesBelowC.length > 0
          ? `Candidate temperatures ${candidatesBelowC.map((x) => formatNumber(x, 0)).join(', ')} °C lie below it, so the sample may not have changed that way yet. Check by XRD of samples calcined below and above ${t} °C.`
          : `All candidate temperatures lie above it. Check by XRD that the phase you want has formed.`),
    });
  }
  return marks;
}
