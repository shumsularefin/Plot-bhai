import { migrateXrdData, XRD_STATE_VERSION, type XrdData } from './data';
import { sessionReplacer, sessionReviver } from '../../ui/persist/sessionJson';
import type { WizardState } from '../../ui/wizard/types';

/** Marks a file as an XRD Toolkit session, so other JSON files are refused with a clear message. */
const APP = 'xrd-toolkit';
const KIND = 'xrd-session';

export interface SessionFile {
  app: typeof APP;
  kind: typeof KIND;
  /** Version of the saved shape (XRD_STATE_VERSION when written). */
  version: number;
  savedAt: string;
  state: WizardState<XrdData>;
}

/** The whole analysis as a JSON string that `parseSession` restores. */
export function serialiseSession(state: WizardState<XrdData>, now: Date = new Date()): string {
  const file: SessionFile = {
    app: APP,
    kind: KIND,
    version: XRD_STATE_VERSION,
    savedAt: now.toISOString(),
    state,
  };
  return JSON.stringify(file, sessionReplacer);
}

export type ParsedSession =
  { ok: true; state: WizardState<XrdData> } | { ok: false; reason: string };

const isPattern = (p: unknown): boolean => {
  const pattern = p as Partial<Record<'twoTheta' | 'intensity', unknown>> | null;
  return (
    !!pattern &&
    pattern.twoTheta instanceof Float64Array &&
    pattern.intensity instanceof Float64Array &&
    pattern.twoTheta.length === pattern.intensity.length
  );
};

/** Reads a session file written by `serialiseSession`, upgrading older versions. */
export function parseSession(text: string): ParsedSession {
  let file: Partial<SessionFile>;
  try {
    file = JSON.parse(text, sessionReviver) as Partial<SessionFile>;
  } catch {
    return { ok: false, reason: 'This file is not valid JSON, so it cannot be a session file.' };
  }
  if (!file || file.app !== APP || file.kind !== KIND)
    return { ok: false, reason: 'This is not an XRD Toolkit session file.' };
  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return { ok: false, reason: 'The session file has no valid version number.' };
  if (version > XRD_STATE_VERSION)
    return {
      ok: false,
      reason: `This session was saved by a newer version of the app (file version ${version}, this app reads up to ${XRD_STATE_VERSION}). Update the app and try again.`,
    };
  const state = version === XRD_STATE_VERSION ? file.state : migrateXrdData(file.state, version);
  if (!state || typeof state !== 'object' || !state.data || !Array.isArray(state.data.patterns))
    return { ok: false, reason: 'The session file is incomplete or damaged: no patterns found.' };
  if (!state.data.patterns.every(isPattern))
    return {
      ok: false,
      reason: 'The session file is damaged: a pattern has missing or unequal data columns.',
    };
  return { ok: true, state };
}
