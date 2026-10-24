import { sessionReplacer, sessionReviver } from '../../ui/persist/sessionJson';
import type { WizardState } from '../../ui/wizard/types';
import { migrateUvvisData, UVVIS_STATE_VERSION, type UvvisData } from './data';

/** Marks a file as a UV-Vis session, so other JSON files (including XRD sessions) are refused. */
const APP = 'xrd-toolkit';
const KIND = 'uvvis-session';

export interface UvvisSessionFile {
  app: typeof APP;
  kind: typeof KIND;
  /** Version of the saved shape (UVVIS_STATE_VERSION when written). */
  version: number;
  savedAt: string;
  state: WizardState<UvvisData>;
}

/** The whole analysis as a JSON string that `parseUvvisSession` restores. */
export function serialiseUvvisSession(
  state: WizardState<UvvisData>,
  now: Date = new Date(),
): string {
  const file: UvvisSessionFile = {
    app: APP,
    kind: KIND,
    version: UVVIS_STATE_VERSION,
    savedAt: now.toISOString(),
    state,
  };
  return JSON.stringify(file, sessionReplacer);
}

export type ParsedUvvisSession =
  { ok: true; state: WizardState<UvvisData> } | { ok: false; reason: string };

const isSpectrum = (s: unknown): boolean => {
  const spectrum = s as Partial<Record<'wavelengthNm' | 'values', unknown>> | null;
  return (
    !!spectrum &&
    spectrum.wavelengthNm instanceof Float64Array &&
    spectrum.values instanceof Float64Array &&
    spectrum.wavelengthNm.length === spectrum.values.length
  );
};

/** Reads a session file written by `serialiseUvvisSession`, upgrading older versions. */
export function parseUvvisSession(text: string): ParsedUvvisSession {
  let file: Partial<UvvisSessionFile>;
  try {
    file = JSON.parse(text, sessionReviver) as Partial<UvvisSessionFile>;
  } catch {
    return { ok: false, reason: 'This file is not valid JSON, so it cannot be a session file.' };
  }
  if (!file || file.app !== APP || file.kind !== KIND)
    return { ok: false, reason: 'This is not a UV-Vis session file.' };
  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return { ok: false, reason: 'The session file has no valid version number.' };
  if (version > UVVIS_STATE_VERSION)
    return {
      ok: false,
      reason: `This session was saved by a newer version of the app (file version ${version}, this app reads up to ${UVVIS_STATE_VERSION}). Update the app and try again.`,
    };
  const state =
    version === UVVIS_STATE_VERSION ? file.state : migrateUvvisData(file.state, version);
  if (!state || typeof state !== 'object' || !state.data || !Array.isArray(state.data.spectra))
    return { ok: false, reason: 'The session file is incomplete or damaged: no spectra found.' };
  if (!state.data.spectra.every(isSpectrum))
    return {
      ok: false,
      reason: 'The session file is damaged: a spectrum has missing or unequal data columns.',
    };
  return { ok: true, state };
}
