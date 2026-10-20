import type { RegionFit } from './fit';

const DEG = Math.PI / 180;

/** One row of the peak table. Angles in degrees unless the name says radians. */
export interface PeakRow {
  /** Region index and peak index within it, to link back to the fit. */
  region: number;
  peak: number;
  twoTheta: number;
  twoThetaSigma: number;
  /** Interplanar spacing d, Å. */
  d: number;
  dSigma: number;
  fwhm: number;
  fwhmSigma: number;
  fwhmRad: number;
  fwhmRadSigma: number;
  /** Integral breadth (area / height), degrees. */
  breadth: number;
  breadthSigma: number;
  height: number;
  heightSigma: number;
  /** Area, intensity × degrees. */
  area: number;
  areaSigma: number;
  /** Height relative to the highest fitted peak, percent. */
  relativeIntensity: number;
  eta: number;
  etaSigma: number;
}

/**
 * Interplanar spacing from Bragg's law (first order): d = λ / (2 sin θ), with θ = 2θ / 2.
 * twoTheta in degrees, λ in Å, d in Å.
 */
export function braggD(twoTheta: number, lambda: number): number {
  return lambda / (2 * Math.sin((twoTheta / 2) * DEG));
}

/**
 * Standard uncertainty of d from that of 2θ (both 2θ values in degrees):
 *   ∂d/∂(2θ) = −λ cos θ / (4 sin² θ)   per radian of 2θ,   σ_d = |∂d/∂(2θ)| · σ_2θ(rad).
 */
export function braggDSigma(twoTheta: number, twoThetaSigma: number, lambda: number): number {
  const theta = (twoTheta / 2) * DEG;
  return Math.abs((lambda * Math.cos(theta)) / (4 * Math.sin(theta) ** 2)) * twoThetaSigma * DEG;
}

/** Builds the peak table from fitted regions. λ (Å) is the wavelength used for d-spacings. */
export function peakTable(regions: readonly RegionFit[], lambda: number): PeakRow[] {
  const all = regions.flatMap((r, region) => r.peaks.map((p, peak) => ({ p, region, peak })));
  const maxHeight = Math.max(0, ...all.map(({ p }) => p.height));
  return all
    .map(({ p, region, peak }) => ({
      region,
      peak,
      twoTheta: p.center,
      twoThetaSigma: p.sigma.center,
      d: braggD(p.center, lambda),
      dSigma: braggDSigma(p.center, p.sigma.center, lambda),
      fwhm: p.fwhm,
      fwhmSigma: p.sigma.fwhm,
      fwhmRad: p.fwhm * DEG,
      fwhmRadSigma: p.sigma.fwhm * DEG,
      breadth: p.breadth,
      breadthSigma: p.breadthSigma,
      height: p.height,
      heightSigma: p.sigma.height,
      area: p.area,
      areaSigma: p.areaSigma,
      relativeIntensity: maxHeight > 0 ? (100 * p.height) / maxHeight : 0,
      eta: p.eta,
      etaSigma: p.sigma.eta,
    }))
    .sort((a, b) => a.twoTheta - b.twoTheta);
}

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => number | string;
}

/** Comma-separated values with a header row. Numbers are written in full precision. */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const cell = (v: number | string) => {
    const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map((c) => cell(c.header)),
    ...rows.map((r) => columns.map((c) => cell(c.value(r)))),
  ]
    .map((line) => line.join(','))
    .join('\r\n')
    .concat('\r\n');
}
