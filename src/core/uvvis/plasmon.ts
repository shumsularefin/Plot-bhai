import { fitBandRegion } from '../ftir/bands';
import type { RegionFit } from '../xrd/peaks/fit';
import type { ProfileKind } from '../xrd/peaks/profiles';
import { energyFromWavelength, wavelengthFromEnergy } from './conversions';

export interface PlasmonOptions {
  /** Wavelength range to fit, nm. */
  fromNm: number;
  toNm: number;
  /** Starting band positions, nm. */
  centresNm: readonly number[];
  profile: ProfileKind;
}

export interface PlasmonBand {
  /** Band centre E₀ in eV with its standard error, and the same position as a wavelength hc/E₀ in nm. */
  centerEv: number;
  centerEvSigma: number;
  centerNm: number;
  /** Full width at half maximum w in eV, and the width between hc/(E₀ + w/2) and hc/(E₀ − w/2) in nm. */
  fwhmEv: number;
  fwhmEvSigma: number;
  fwhmNm: number;
  height: number;
  /** Lorentzian fraction η (1 for a Lorentzian, 0 for a Gaussian). */
  eta: number;
  /** Area in absorbance × eV. */
  area: number;
}

export interface PlasmonFit {
  /** The fit on the energy axis (x in eV, increasing). */
  fit: RegionFit;
  /** Photon energy and absorbance of the points, increasing energy. */
  energyEv: Float64Array;
  absorbance: Float64Array;
  bands: PlasmonBand[];
}

/**
 * Fits surface plasmon (or other) absorption bands on the photon energy axis E = hc/λ (eV), where
 * a band's shape is described by a Gaussian, Lorentzian or pseudo-Voigt (see xrd/peaks/profiles.ts)
 * plus a straight background, by least squares (fitBandRegion). Fitting in energy rather than
 * wavelength keeps a symmetric band symmetric. The absorbance itself is not transformed. Returns
 * null with fewer than 10 points in the range.
 */
export function fitPlasmon(
  wavelengthNm: Float64Array,
  absorbance: Float64Array,
  options: PlasmonOptions,
): PlasmonFit | null {
  const n = wavelengthNm.length;
  const energyEv = new Float64Array(n);
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    energyEv[i] = energyFromWavelength(wavelengthNm[n - 1 - i] as number);
    a[i] = absorbance[n - 1 - i] as number;
  }
  const from = energyFromWavelength(Math.max(options.fromNm, options.toNm));
  const to = energyFromWavelength(Math.min(options.fromNm, options.toNm));
  let inside = 0;
  for (const e of energyEv) if (e >= from && e <= to) inside++;
  if (inside < 10) return null;
  const fit = fitBandRegion(
    energyEv,
    a,
    from,
    to,
    options.centresNm.map(energyFromWavelength),
    options.profile,
    ' eV',
  );
  return { fit, energyEv, absorbance: a, bands: plasmonBands(fit) };
}

/** The bands of a fit on the energy axis, with their positions and widths also in nm. */
export function plasmonBands(fit: RegionFit): PlasmonBand[] {
  return fit.peaks.map((p) => ({
    centerEv: p.center,
    centerEvSigma: p.sigma.center,
    centerNm: wavelengthFromEnergy(p.center),
    fwhmEv: p.fwhm,
    fwhmEvSigma: p.sigma.fwhm,
    fwhmNm:
      p.fwhm < 2 * p.center
        ? wavelengthFromEnergy(p.center - p.fwhm / 2) - wavelengthFromEnergy(p.center + p.fwhm / 2)
        : NaN,
    height: p.height,
    eta: p.eta,
    area: p.area,
  }));
}
