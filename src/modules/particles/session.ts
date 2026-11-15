import { createSessionCodec } from '../../ui/persist/sessionFile';
import { migrateParticleData, PARTICLE_STATE_VERSION, type ParticleData } from './data';

const isRuns = (runs: unknown): boolean => runs instanceof Int32Array && runs.length % 3 === 0;

const isNumbers = (list: unknown): boolean =>
  Array.isArray(list) && list.every((v) => typeof v === 'number');

/**
 * Saves and reads a particle analysis as a versioned JSON file. The image itself is not in the
 * file (it can be tens of megabytes); its name, pixel size, file size and SHA-256 are, so the
 * upload step can tell whether the image loaded again is the same one. Everything measured on it
 * is kept: the scale, the crop, every setting, the detected and hand-edited particles (as runs of
 * pixels), the hand measurements and the pooled images.
 */
export const particleSession = createSessionCodec<ParticleData>({
  kind: 'particles-session',
  label: 'particle size',
  version: PARTICLE_STATE_VERSION,
  migrate: migrateParticleData,
  check: (data) => {
    if (!data.detect || !Array.isArray(data.detect.particles) || !Array.isArray(data.pool))
      return 'The session file is incomplete or damaged: no particles or pool found.';
    if (!data.detect.particles.every((p) => isRuns(p.runs)))
      return 'The session file is damaged: a particle outline is not readable.';
    if (
      !data.pool.every(
        (e) => isNumbers(e.equalArea) && isNumbers(e.longest) && isNumbers(e.shortest),
      )
    )
      return 'The session file is damaged: a pooled image has unreadable sizes.';
    return null;
  },
});

/** What the particle session file holds and leaves out, shown beside its buttons. */
export const PARTICLE_SESSION_HINT =
  'The session file holds every setting, the scale, the particles you detected or drew, your hand measurements and the pooled images, but not the image itself, which stays on your device. Opened later (or on another computer), the distribution, tables and pooled images work at once; to see the particles on the image, load the same image file in step 1, which is checked against the fingerprint of the file. Opening a file replaces the analysis you have now.';
