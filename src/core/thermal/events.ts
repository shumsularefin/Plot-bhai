import type { Atmosphere, SampleCategory } from './types';

/** One row of data/thermal/events.json: a typical temperature range for a kind of event. */
export interface EventRule {
  id: string;
  name: string;
  /** Typical range of the DTG peak temperature, °C. */
  fromC: number;
  toC: number;
  /** "oxidising" rules only apply in air or oxygen. */
  atmosphere: 'any' | 'oxidising';
  /** Sample categories this event is typical for; empty means any. */
  categories: SampleCategory[];
  notes: string;
  source: string;
}

export interface EventTable {
  verification: string;
  rangesFor: string;
  events: EventRule[];
}

export type Confidence = 'low' | 'medium' | 'high';

export interface EventContext {
  atmosphere: Atmosphere;
  category: SampleCategory;
}

/** The step to assign: DTG peak temperature and the size of the mass loss. */
export interface StepEvidence {
  peakC: number;
  lossPct: number;
  /** Theoretical mass loss that agrees with this step (within the tolerance), when one was entered. */
  theoryAgrees?: boolean;
}

export interface EventCandidate {
  rule: EventRule;
  /** 0 to 1, only used to rank. It is not a probability. */
  score: number;
  confidence: Confidence;
  /** Plain-language reason for the ranking. */
  reason: string;
}

/** A DTG peak this far outside a range (°C) still gets a weak candidate. */
const MARGIN_C = 50;
const MAX_CANDIDATES = 3;

export const isOxidising = (atmosphere: Atmosphere): boolean =>
  atmosphere === 'air' || atmosphere === 'oxygen';

/**
 * Temperature fit of a peak to a range: 1 at the centre falling to 0.7 at the edges, then to 0
 * over `MARGIN_C` outside. These weights only order the candidates.
 */
export function temperatureFit(peakC: number, fromC: number, toC: number): number {
  if (peakC >= fromC && peakC <= toC) {
    const half = (toC - fromC) / 2;
    return 1 - 0.3 * (Math.abs(peakC - (fromC + toC) / 2) / half);
  }
  const outside = peakC < fromC ? fromC - peakC : peakC - toC;
  return outside >= MARGIN_C ? 0 : 0.3 * (1 - outside / MARGIN_C);
}

/**
 * Up to three ranked suggestions for one step. Score = 0.6 · temperature fit + 0.3 · sample
 * category (1 match, 0.5 when the rule or the sample is unspecific, 0 mismatch) + 0.1 · 1 for
 * atmosphere. Rules that need oxygen are dropped in other atmospheres. Confidence is "high" only
 * when the peak is inside the range, the category matches and the theoretical mass loss agrees;
 * "medium" when inside the range with a match or no preference; otherwise "low". These are
 * estimates for ranking, never identifications.
 */
export function rankEvents(
  evidence: StepEvidence,
  context: EventContext,
  rules: readonly EventRule[],
): EventCandidate[] {
  const candidates: EventCandidate[] = [];
  for (const rule of rules) {
    if (rule.atmosphere === 'oxidising' && !isOxidising(context.atmosphere)) continue;
    const fit = temperatureFit(evidence.peakC, rule.fromC, rule.toC);
    if (fit === 0) continue;
    const inside = evidence.peakC >= rule.fromC && evidence.peakC <= rule.toC;
    const specific = rule.categories.length > 0 && context.category !== 'unspecified';
    const categoryMatch = rule.categories.includes(context.category);
    const categoryScore = !specific ? 0.5 : categoryMatch ? 1 : 0;
    const score = 0.6 * fit + 0.3 * categoryScore + 0.1;
    let confidence: Confidence = 'low';
    if (inside && (categoryMatch || !specific)) confidence = 'medium';
    if (inside && categoryMatch && evidence.theoryAgrees) confidence = 'high';
    candidates.push({ rule, score, confidence, reason: reason(evidence, context, rule, inside) });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

function reason(
  evidence: StepEvidence,
  context: EventContext,
  rule: EventRule,
  inside: boolean,
): string {
  const t = Math.round(evidence.peakC);
  const parts = [
    inside
      ? `The DTG peak at ${t} °C lies inside the typical range of ${rule.fromC} to ${rule.toC} °C.`
      : `The DTG peak at ${t} °C is outside the typical range of ${rule.fromC} to ${rule.toC} °C, so this is a weak match.`,
  ];
  parts.push(`The step loses ${evidence.lossPct.toFixed(1)} % of the mass.`);
  if (rule.atmosphere === 'oxidising') {
    parts.push(`It needs oxygen, and the atmosphere is ${context.atmosphere}.`);
  }
  if (rule.categories.length > 0 && context.category !== 'unspecified') {
    parts.push(
      rule.categories.includes(context.category)
        ? 'It is typical for the sample category you chose.'
        : 'It is not typical for the sample category you chose.',
    );
  }
  if (evidence.theoryAgrees) parts.push('The theoretical mass loss you entered agrees with it.');
  return parts.join(' ');
}

export const NO_CERTAINTY_NOTE =
  'TGA alone cannot identify the evolved species. These are ranked suggestions from typical temperature ranges. Coupled MS or FTIR of the exhaust gas, or other characterisation such as XRD, is needed for certainty.';
