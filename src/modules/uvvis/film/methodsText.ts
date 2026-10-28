import { HC_EV_NM } from '../../../core/uvvis/conversions';
import type { PlasmonBand } from '../../../core/uvvis/plasmon';
import type { SwanepoelResult } from '../../../core/uvvis/swanepoel';
import type { RegionFit } from '../../../core/xrd/peaks/fit';
import type { FilmData } from './data';

const num = (v: number, digits: number) => v.toFixed(digits);
const PROFILE_NAMES = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'pseudo-Voigt',
};

/** Methods paragraph for a plasmon fit, written from the settings and the fitted numbers. */
export function plasmonMethodsText(data: FilmData, fit: RegionFit, bands: PlasmonBand[]): string {
  const p = data.plasmon;
  const list = bands
    .map(
      (b) =>
        `${num(b.centerEv, 3)} ± ${num(b.centerEvSigma, 3)} eV (${num(b.centerNm, 1)} nm), FWHM ${num(b.fwhmEv, 3)} eV (${num(b.fwhmNm, 1)} nm)`,
    )
    .join('; ');
  const kind =
    data.spectrum?.kind === 'transmittance'
      ? ' (converted from transmittance with A = 2 − log10 %T)'
      : '';
  const synthetic = data.spectrum?.synthetic
    ? ' The spectrum is synthetic example data, not a measurement.'
    : '';
  return `The absorbance spectrum${kind} was converted to photon energy, E = hc/λ with hc = ${num(HC_EV_NM, 3)} eV nm, and fitted from ${num(Math.min(p.fromNm ?? 0, p.toNm ?? 0), 0)} to ${num(Math.max(p.fromNm ?? 0, p.toNm ?? 0), 0)} nm with ${bands.length} ${PROFILE_NAMES[p.profile]} band${bands.length === 1 ? '' : 's'} plus a straight background by Levenberg–Marquardt least squares (R² = ${num(fit.rSquared, 5)}). Band position and full width at half maximum: ${list}; uncertainties are standard errors of the fit.${synthetic}`;
}

/** Methods paragraph for the Swanepoel envelope method. */
export function swanepoelMethodsText(
  data: FilmData,
  substrate: number,
  r: SwanepoelResult,
): string {
  const first = r.rows[r.rows.length - 1];
  const last = r.rows[0];
  const w = data.swanepoel;
  const sub =
    w.substrateBy === 'index'
      ? `a substrate refractive index s = ${substrate}`
      : `a substrate index s = ${num(substrate, 4)} from the bare substrate transmittance of ${w.substrateTPct} % (s = 1/Ts + √(1/Ts² − 1))`;
  const synthetic = data.spectrum?.synthetic
    ? ' The spectrum is synthetic example data, not a measurement.'
    : '';
  return `The refractive index and thickness of the film were obtained from the interference fringes of the transmittance by the envelope method of Swanepoel (J. Phys. E 16 (1983) 1214), with ${sub}. ${r.rows.length} alternating extrema (fringe height at least ${w.prominencePct} % T) from ${num(first?.wavelengthNm ?? NaN, 0)} to ${num(last?.wavelengthNm ?? NaN, 0)} nm were used; the opposite envelope at each extremum was interpolated linearly. The index followed from n = [N + (N² − s²)^½]^½ with N = 2s(TM − Tm)/(TM Tm) + (s² + 1)/2. A first thickness of ${num(r.d1, 0)} ± ${num(r.d1Sd, 0)} nm (mean ± standard deviation of neighbouring pairs) gave the order numbers from 2nd = mλ, and the final thickness is d = ${num(r.d2, 0)} ± ${num(r.d2Sd, 0)} nm, with the refined index n = mλ/(2d) from ${num(first?.n2 ?? NaN, 3)} at ${num(first?.wavelengthNm ?? NaN, 0)} nm to ${num(last?.n2 ?? NaN, 3)} at ${num(last?.wavelengthNm ?? NaN, 0)} nm. The film was treated as uniform and weakly absorbing; absorption coefficients were not calculated.${synthetic}`;
}
