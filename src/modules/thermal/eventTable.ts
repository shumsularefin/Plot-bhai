import eventsFile from '../../../data/thermal/events.json';
import type { EventRule } from '../../core/thermal/events';
import type { EventDecision } from './data';

/** The rule table of data/thermal/events.json. */
export const EVENT_RULES = eventsFile.rules as EventRule[];
export const EVENT_SOURCE = eventsFile.source;
export const EVENT_VERIFICATION = eventsFile.verification;

export const ruleOf = (id: string): EventRule | undefined => EVENT_RULES.find((r) => r.id === id);

/** The name of the event the user chose for a step, or null when it is rejected or undecided. */
export function decisionName(decision: EventDecision | undefined): string | null {
  if (!decision || decision.kind === 'rejected') return null;
  return decision.kind === 'custom' ? decision.text : (ruleOf(decision.ruleId)?.name ?? null);
}
