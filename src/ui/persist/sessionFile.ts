import type { WizardState } from '../wizard/types';
import { sessionReplacer, sessionReviver } from './sessionJson';

/** Marks files as belonging to this site's tools, so other JSON files are refused with a clear message. */
const APP = 'xrd-toolkit';

export interface SessionCodecOptions<D> {
  /** Identifies the tool, for example "uvvis-session". */
  kind: string;
  /** Name for messages, for example "UV-Vis". */
  label: string;
  /** Version of the saved shape; bump it with a migration when the shape changes. */
  version: number;
  migrate: (saved: unknown, version: number) => WizardState<D> | undefined;
  /** Returns a plain-language problem with the loaded state, or null when it is usable. */
  check: (data: D) => string | null;
}

export type ParsedSession<D> = { ok: true; state: WizardState<D> } | { ok: false; reason: string };

export interface SessionCodec<D> {
  serialise: (state: WizardState<D>, now?: Date) => string;
  parse: (text: string) => ParsedSession<D>;
}

/** Writes and reads a tool's whole analysis as a versioned JSON file, upgrading older versions. */
export function createSessionCodec<D>(options: SessionCodecOptions<D>): SessionCodec<D> {
  const { kind, label, version: current, migrate, check } = options;
  return {
    serialise(state, now = new Date()) {
      return JSON.stringify(
        { app: APP, kind, version: current, savedAt: now.toISOString(), state },
        sessionReplacer,
      );
    },
    parse(text) {
      let file: { app?: string; kind?: string; version?: unknown; state?: unknown } | null;
      try {
        file = JSON.parse(text, sessionReviver) as typeof file;
      } catch {
        return {
          ok: false,
          reason: 'This file is not valid JSON, so it cannot be a session file.',
        };
      }
      if (!file || file.app !== APP || file.kind !== kind) {
        return { ok: false, reason: `This is not a ${label} session file.` };
      }
      const version = file.version;
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return { ok: false, reason: 'The session file has no valid version number.' };
      }
      if (version > current) {
        return {
          ok: false,
          reason: `This session was saved by a newer version of the app (file version ${version}, this app reads up to ${current}). Update the app and try again.`,
        };
      }
      const state =
        version === current ? (file.state as WizardState<D>) : migrate(file.state, version);
      if (!state || typeof state !== 'object' || !state.data) {
        return { ok: false, reason: 'The session file is incomplete or damaged.' };
      }
      const problem = check(state.data);
      return problem ? { ok: false, reason: problem } : { ok: true, state };
    },
  };
}
