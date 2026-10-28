import { GAS_CONSTANT } from '../../../core/thermal/kinetics';
import type { DscMethodsOutcome } from './analysis';
import type { DscMethodsData } from './data';
import { SAPPHIRE } from './example';

const num = (v: number, digits: number) => v.toFixed(digits);

/** The methods paragraph, written only from the settings used and the numbers computed. */
export function dscMethodsText(data: DscMethodsData, outcome: DscMethodsOutcome): string {
  if (!outcome.ok) return '';
  const synthetic = Object.values(data.files).some((f) => f?.synthetic)
    ? ' The runs are synthetic example data, not measurements.'
    : '';
  const sign = `Heat flow was read as ${data.exoUp ? 'exothermic up' : 'exothermic down (endothermic up)'}.`;
  if (outcome.method === 'cp') {
    const p = outcome.result.points;
    if (p.length === 0) return '';
    const rate = data.rateKPerMin ? ` at ${data.rateKPerMin} K/min` : '';
    return `Specific heat capacity was determined by the three-run sapphire (ratio) method${rate}: an empty-pan baseline run, a sapphire run (${data.sapphireMassMg} mg) and a sample run (${data.sampleMassMg} mg). The sample heat capacity was calculated as cp = cp,sapphire · (Ds/Dst) · (mst/ms), where Ds and Dst are the heat flow displacements of the sample and the sapphire from the empty-pan curve at the same temperature, with cp,sapphire from ${SAPPHIRE.source.citation} (linear interpolation, molar mass ${SAPPHIRE.molarMassGPerMol} g/mol). Values are reported every ${data.cp.stepC} °C from ${num(p[0]?.temperatureC as number, 1)} to ${num(p[p.length - 1]?.temperatureC as number, 1)} °C. ${sign}${synthetic}`;
  }
  if (outcome.method === 'purity') {
    if (!outcome.outcome.ok) return '';
    const r = outcome.outcome.result;
    return `The purity was estimated from the melting endotherm with the van ’t Hoff equation, Ts = T0 − (R T0² x2 / ΔHf)(1/F), with R = ${GAS_CONSTANT} J mol⁻¹ K⁻¹. The run was heated at ${data.rateKPerMin} K/min. The peak was integrated above a straight baseline from ${num(r.fromC, 1)} to ${num(r.toC, 1)} °C, giving ΔHf = ${num(r.fusionJPerG, 1)} J/g (${num(r.fusionKJPerMol, 2)} kJ/mol with M = ${data.purity.molarMass} g/mol). The sample temperature was fitted against 1/F by least squares for fractions melted from ${data.purity.fMin} to ${data.purity.fMax} (${r.points.length} points, R² = ${num(r.rSquared, 4)}), giving T0 = ${num(r.t0C, 2)} °C and an impurity of ${num(100 * r.x2, 2)} ± ${num(100 * r.x2Sigma, 2)} mol % (purity ${num(r.purityMolPct, 2)} mol %, an estimate). No linearisation or thermal-lag correction was applied. ${sign}${synthetic}`;
  }
  if (!outcome.outcome.ok) return '';
  const r = outcome.outcome.result;
  return `The oxidation induction time was taken as the time from the gas switch at ${num(r.onsetMin - r.oitMin, 2)} min to the extrapolated onset of the oxidation exotherm, where the tangent at the steepest point of the rising exotherm meets a straight baseline fitted from ${num(r.baseline.fromMin, 2)} to ${num(r.baseline.toMin, 2)} min. OIT = ${num(r.oitMin, 2)} min (onset at ${num(r.onsetMin, 2)} min). ${sign}${synthetic}`;
}
