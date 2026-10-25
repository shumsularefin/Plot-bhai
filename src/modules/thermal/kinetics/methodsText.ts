import { DOYLE_COEFFICIENT, GAS_CONSTANT } from '../../../core/thermal/kinetics';
import type { KineticOutcome, Prepared } from './analysis';
import type { KineticsData } from './data';

const num = (v: number, digits: number) => v.toFixed(digits);

/** The methods paragraph, written only from the settings used and the numbers computed. */
export function kineticsMethodsText(
  data: KineticsData,
  prepared: Prepared,
  outcome: KineticOutcome,
): string {
  if (!prepared.ok || !outcome.ok) return '';
  const rates = prepared.runs.map((r) => r.rate).sort((a, b) => a - b);
  const intro = `The apparent activation energy was estimated from ${rates.length} ${prepared.runs[0]?.kind === 'dsc' ? 'DSC' : 'TGA'} runs of the same sample at heating rates of ${rates.join(', ')} K/min, in the window ${num(outcome.window[0], 0)} to ${num(outcome.window[1], 0)} °C`;
  const gas = `with the molar gas constant R = ${GAS_CONSTANT} J mol⁻¹ K⁻¹`;
  const synthetic = data.runs.some((r) => r.synthetic)
    ? ' The runs are synthetic example data, not measurements.'
    : '';
  if (outcome.method === 'kissinger') {
    const signal =
      prepared.runs[0]?.kind === 'dsc'
        ? 'the DSC peak'
        : `the DTG maximum (local quadratic slope over ${data.dtgWindowC} °C)`;
    const r = outcome.result;
    return `${intro}, using the Kissinger method. The peak temperature T_p of the event was taken as ${signal}, refined with a parabola through the highest point and its neighbours, and ln(β/T_p²) was plotted against 1/T_p (β in K/min, T_p in K); the slope equals −E_a/R, ${gas}. This gave E_a = ${num(r.eaKJ, 1)} ± ${num(r.eaSigmaKJ, 1)} kJ/mol (standard error of the straight-line fit; R² = ${num(r.rSquared, 4)}).${synthetic}`;
  }
  const alphas = outcome.levels.map((l) => l.alpha);
  const range = `${alphas[0]} to ${alphas[alphas.length - 1]}`;
  const conversion =
    'The conversion α = (m₀ − m)/(m₀ − m_f) was calculated from the mass at the two ends of the window, and the temperature at which each run reached a fixed α was read by linear interpolation.';
  const lo = Math.min(...outcome.levels.map((l) => l.eaKJ));
  const hi = Math.max(...outcome.levels.map((l) => l.eaKJ));
  const span = `E_a at α = ${range} ranged from ${num(lo, 1)} to ${num(hi, 1)} kJ/mol.`;
  if (outcome.method === 'fwo') {
    return `${intro}, using the Flynn–Wall–Ozawa method. ${conversion} At each α, ln β was plotted against 1/T (T in K) and E_a was obtained from the slope = −${DOYLE_COEFFICIENT} E_a/R (Doyle approximation), ${gas}. ${span}${synthetic}`;
  }
  return `${intro}, using the Kissinger–Akahira–Sunose method. ${conversion} At each α, ln(β/T²) was plotted against 1/T (T in K) and E_a was obtained from the slope = −E_a/R, ${gas}. ${span}${synthetic}`;
}
