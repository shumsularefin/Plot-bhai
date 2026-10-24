import type { Atmosphere, SampleCategory } from './types';

/** One row of data/thermal/events.json: a kind of thermal event and where it is typically seen. */
export interface EventRule {
  id: string;
  name: string;
  /** Typical temperature range in °C. Null while the table has no cited range for the event. */
  range: { fromC: number; toC: number } | null;
  atmosphere: 'any' | 'oxidising' | 'inert';
  /** Sample categories the range was reported for. */
  categories: readonly string[];
  /** "sourced": copied from the cited source. "todo": range still to be supplied. */
  status: 'sourced' | 'todo';
  /** The sentence of the source the range comes from. */
  quote?: string;
  overlap: string;
  sourceId?: string;
}

/** What the ranking needs to know about a step (temperatures in °C). */
export interface StepEvidence {
  onsetC: number;
  peakC: number;
  endsetC: number;
  lossPct: number;
}

export interface RunContext {
  atmosphere: Atmosphere;
  category: SampleCategory;
}

/** Never "high": TGA alone cannot identify the evolved species. */
export type Confidence = 'low' | 'medium';

export interface Candidate {
  ruleId: string;
  name: string;
  confidence: Confidence;
  /** Plain-language reason, shown next to the candidate. */
  reason: string;
}

/** At most this many candidates are suggested for a step. */
export const MAX_CANDIDATES = 3;

export const isOxidising = (atmosphere: Atmosphere): boolean =>
  atmosphere === 'air' || atmosphere === 'oxygen';

/**
 * Ranks the rules for one step. Score = 0.5 · (share of the step, onset to endset, inside the
 * rule's range) + 0.3 · (the DTG peak is inside the range) + 0.2 · (the sample category is one
 * the range was reported for). Rules without a range, rules whose atmosphere condition is not
 * met, and rules that do not overlap the step are left out. The confidence is "medium" when the
 * peak is inside the range and the category matches, and "low" otherwise. These weights are a
 * simple convention of this site, not a published method.
 */
export function rankEvents(
  step: StepEvidence,
  context: RunContext,
  rules: readonly EventRule[],
): Candidate[] {
  const width = Math.max(step.endsetC - step.onsetC, 1e-9);
  const scored: { rule: EventRule; score: number; candidate: Candidate }[] = [];
  for (const rule of rules) {
    if (!rule.range) continue;
    if (rule.atmosphere === 'oxidising' && !isOxidising(context.atmosphere)) continue;
    if (rule.atmosphere === 'inert' && isOxidising(context.atmosphere)) continue;
    const { fromC, toC } = rule.range;
    const overlap = Math.max(0, Math.min(step.endsetC, toC) - Math.max(step.onsetC, fromC));
    if (overlap <= 0) continue;
    const share = Math.min(1, overlap / width);
    const peakInside = step.peakC >= fromC && step.peakC <= toC;
    const known = context.category !== 'unspecified';
    const categoryMatch = known && rule.categories.includes(context.category);
    const score = 0.5 * share + 0.3 * (peakInside ? 1 : 0) + 0.2 * (categoryMatch ? 1 : 0);
    const confidence: Confidence = peakInside && categoryMatch ? 'medium' : 'low';
    const parts = [
      `The step runs from ${step.onsetC.toFixed(0)} to ${step.endsetC.toFixed(0)} °C and the fastest loss is at ${step.peakC.toFixed(0)} °C; the listed range for this event is ${fromC} to ${toC} °C (${Math.round(share * 100)} % of the step lies inside it${peakInside ? ', including the peak' : ', but the peak is outside it'}).`,
      known
        ? categoryMatch
          ? 'It was reported for samples of the kind you chose.'
          : 'It was not reported for the kind of sample you chose.'
        : 'You did not say what kind of sample this is, which would help.',
      `The mass loss is ${step.lossPct.toFixed(1)} %; compare that with what the event could lose.`,
    ];
    scored.push({
      rule,
      score,
      candidate: { ruleId: rule.id, name: rule.name, confidence, reason: parts.join(' ') },
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.candidate);
}

/** Shown wherever events are assigned. */
export const EVOLVED_SPECIES_NOTE =
  'TGA alone cannot tell which substance is lost in a step. Coupled mass spectrometry or FTIR of the evolved gas, or other characterisation, is needed for certainty.';
