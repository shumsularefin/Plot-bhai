import type { DscEvent } from './dsc';
import { isOxidising, temperatureFit, type Confidence } from './events';
import type { Atmosphere, SampleCategory } from './types';

/** One row of data/thermal/dsc-events.json: a kind of DSC event and where it typically appears. */
export interface DscRule {
  id: string;
  name: string;
  direction: 'endo' | 'exo' | 'either';
  /** The scans this applies to. */
  scans: ('heating' | 'cooling')[];
  /** Typical range of the peak temperature, °C. */
  fromC: number;
  toC: number;
  atmosphere: 'any' | 'oxidising';
  /** Sample categories this event is typical for; empty means any. */
  categories: SampleCategory[];
  /** Usual peak shape; only described in the reason, never used to rank. */
  shape: 'narrow' | 'broad' | 'any';
  notes: string;
  source: string;
}

export interface DscRuleTable {
  verification: string;
  rangesFor: string;
  events: DscRule[];
}

export interface DscGuidance {
  rule: DscRule;
  /** 0 to 1, only used to rank. It is not a probability. */
  score: number;
  /** "high" is never given from DSC alone; the combined TGA-DSC view can support a suggestion. */
  confidence: Exclude<Confidence, 'high'>;
  reason: string;
}

/** The event to interpret and the conditions of the run. */
export interface DscEvidence {
  event: Pick<DscEvent, 'direction' | 'peakC' | 'onsetC' | 'endsetC'>;
  scan: 'heating' | 'cooling';
  atmosphere: Atmosphere;
  category: SampleCategory;
}

const MAX_GUIDANCE = 3;

export const DSC_NO_CERTAINTY_NOTE =
  'DSC alone cannot tell what happened in the sample. These are ranked suggestions from the direction, temperature and conditions of the event. TGA (is there a mass change?), XRD, microscopy or a repeat scan show what really happened.';

/**
 * Up to three ranked interpretations for one DSC event. Rules that do not apply to the scan
 * (heating or cooling), that need oxygen in a non-oxidising atmosphere, or whose direction is
 * the opposite of the event are dropped; peaks more than 50 °C outside a rule's range are dropped.
 * Score = 0.5 · temperature fit + 0.3 · direction (1 for a matching direction, 0.5 for a rule that
 * allows either) + 0.1 · sample category (1 match, 0.5 unspecific, 0 mismatch) + 0.1 · scan.
 * Confidence is "medium" when the peak is inside the range and the direction matches exactly,
 * otherwise "low". These are estimates for ranking, never identifications.
 */
export function guidanceFor(evidence: DscEvidence, rules: readonly DscRule[]): DscGuidance[] {
  const out: DscGuidance[] = [];
  for (const rule of rules) {
    if (!rule.scans.includes(evidence.scan)) continue;
    if (rule.atmosphere === 'oxidising' && !isOxidising(evidence.atmosphere)) continue;
    if (rule.direction !== 'either' && rule.direction !== evidence.event.direction) continue;
    const fit = temperatureFit(evidence.event.peakC, rule.fromC, rule.toC);
    if (fit === 0) continue;
    const inside = evidence.event.peakC >= rule.fromC && evidence.event.peakC <= rule.toC;
    const exact = rule.direction === evidence.event.direction;
    const specific = rule.categories.length > 0 && evidence.category !== 'unspecified';
    const categoryScore = !specific ? 0.5 : rule.categories.includes(evidence.category) ? 1 : 0;
    const score = 0.5 * fit + 0.3 * (exact ? 1 : 0.5) + 0.1 * categoryScore + 0.1;
    out.push({
      rule,
      score,
      confidence: inside && exact ? 'medium' : 'low',
      reason: reason(evidence, rule, inside, specific),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_GUIDANCE);
}

function reason(evidence: DscEvidence, rule: DscRule, inside: boolean, specific: boolean): string {
  const { event } = evidence;
  const kind =
    event.direction === 'endo' ? 'an endotherm (heat absorbed)' : 'an exotherm (heat released)';
  const parts = [
    rule.direction === 'either'
      ? `The event is ${kind}; this kind of event can go either way.`
      : `The event is ${kind}, as expected for this kind of event.`,
    inside
      ? `Its peak at ${Math.round(event.peakC)} °C lies inside the typical range of ${rule.fromC} to ${rule.toC} °C.`
      : `Its peak at ${Math.round(event.peakC)} °C is outside the typical range of ${rule.fromC} to ${rule.toC} °C, so this is a weak match.`,
  ];
  const width = event.endsetC - event.onsetC;
  if (Number.isFinite(width) && rule.shape !== 'any') {
    parts.push(
      `This kind of event usually gives a ${rule.shape} peak; this one spans ${Math.round(Math.abs(width))} °C from onset to endset.`,
    );
  }
  if (rule.atmosphere === 'oxidising') {
    parts.push(`It needs oxygen, and the atmosphere is ${evidence.atmosphere}.`);
  }
  if (specific) {
    parts.push(
      rule.categories.includes(evidence.category)
        ? 'It is typical for the sample type you chose.'
        : 'It is not typical for the sample type you chose.',
    );
  }
  return parts.join(' ');
}
