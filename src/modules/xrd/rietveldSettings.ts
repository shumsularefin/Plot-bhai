import {
  braggTwoTheta,
  MONOCHROMATORS,
  monochromatorFraction,
} from '../../core/xrd/rietveld/sample';
import type { RietveldOptics } from './data';

/** GSAS-II polarisation coefficient P for the chosen optics and the Kα1 wavelength (Å). */
export function polarisationOf(optics: RietveldOptics, lambda: number): number {
  switch (optics.monochromator) {
    case 'none':
      return 0.5;
    case 'custom':
      return Math.min(1, Math.max(0, optics.polarisation));
    default: {
      const m = MONOCHROMATORS[optics.monochromator];
      return monochromatorFraction(braggTwoTheta(lambda, m.d), m.perfect);
    }
  }
}

/** Monochromator Bragg angle 2θ_m (degrees) for a preset, or null. */
export function monochromatorAngle(optics: RietveldOptics, lambda: number): number | null {
  if (optics.monochromator === 'none' || optics.monochromator === 'custom') return null;
  const s = lambda / (2 * MONOCHROMATORS[optics.monochromator].d);
  return s < 1 ? braggTwoTheta(lambda, MONOCHROMATORS[optics.monochromator].d) : null;
}

/**
 * 2θ ranges typed as "38-39, 44.5–45" (any dash, separated by commas or semicolons). Returns null
 * when the text is not of that form; an empty text is no ranges.
 */
export function parseRanges(text: string): [number, number][] | null {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const out: [number, number][] = [];
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!(b > a)) return null;
    out.push([a, b]);
  }
  return out;
}
