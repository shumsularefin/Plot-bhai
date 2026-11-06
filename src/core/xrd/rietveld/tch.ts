/*
 * Thompson–Cox–Hastings pseudo-Voigt (P. Thompson, D. E. Cox and J. B. Hastings, J. Appl. Cryst.
 * 20 (1987) 79–83), the peak shape of GSAS-II, with the constants as in GSAS-II's GSASIIpwd.py
 * (getgamFW):
 *   H⁵ = H_G⁵ + 2.69269 H_G⁴H_L + 2.42843 H_G³H_L² + 4.47163 H_G²H_L³ + 0.07842 H_G H_L⁴ + H_L⁵
 *   η  = 1.36603 q − 0.47719 q² + 0.11116 q³,  q = H_L / H
 * H_G and H_L are the Gaussian and Lorentzian full widths at half maximum (any one unit) and H,
 * η the width and Lorentzian fraction of the pseudo-Voigt that replaces their Voigt convolution.
 */

/** TCH mixing η for q = H_L/H. */
export const tchEta = (q: number) => 1.36603 * q - 0.47719 * q * q + 0.11116 * q ** 3;

/** TCH total FWHM from the Gaussian and Lorentzian FWHMs. */
export function tchFwhm(hg: number, hl: number): number {
  return (
    (hg ** 5 +
      2.69269 * hg ** 4 * hl +
      2.42843 * hg ** 3 * hl ** 2 +
      4.47163 * hg ** 2 * hl ** 3 +
      0.07842 * hg * hl ** 4 +
      hl ** 5) **
    0.2
  );
}
