import type { DetectSettings } from './detect/pipeline';
import {
  BIN_METHOD_NAMES,
  type BinMethod,
  type LognormalFit,
  type NormalFit,
} from './distribution';

/**
 * Methods paragraph for a paper, written from the settings the analysis actually used. Every
 * number comes from the input; a step that was not used is left out, and nothing is said about
 * the microscope because image files do not state it reliably.
 */
export interface ParticleMethodsInput {
  software: string;
  /** True when the only image is the generated example; then no measurement is described. */
  allSynthetic: boolean;
  /** Number of images pooled (1 for a single image). */
  images: number;
  /** Pixel size in nm of the image on screen, when it has a scale. */
  nmPerPixel: number | null;
  /** Detection settings, when detected particles were used; null otherwise. */
  detection: {
    settings: DetectSettings;
    /** True when particles were merged, cut, added or deleted by hand after detection. */
    edited: boolean;
    /** Typical diameter used to separate clumps, in pixels of the working copy; null otherwise. */
    diameterUsed: number | null;
    filters: {
      unit: string;
      minDiameter: number | null;
      maxDiameter: number | null;
      minCircularity: number | null;
      excludeEdge: boolean;
    };
  } | null;
  /** Hand measurements that went into the distribution. */
  handCount: number;
  /** Which diameter was used, in words, for example "equal-area diameter". */
  measureName: string;
  /** Unit of the sizes, for example "nm". */
  unit: string;
  count: number;
  mean: number;
  sd: number;
  d10: number;
  d50: number;
  d90: number;
  bins: { method: BinMethod; count: number };
  fits: { normal: NormalFit | null; lognormal: LognormalFit | null };
}

const number = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();

function detectionSentence(d: NonNullable<ParticleMethodsInput['detection']>): string {
  const { settings: s, filters: f } = d;
  const parts: string[] = [];
  if (s.invert) parts.push('the image was inverted so that dark particles became bright');
  parts.push(
    s.denoise.method === 'gaussian'
      ? `smoothed with a Gaussian filter (σ = ${number(s.denoise.size)} px)`
      : `smoothed with a median filter (radius ${number(s.denoise.size)} px)`,
  );
  parts.push(
    s.threshold.method === 'otsu'
      ? 'thresholded with Otsu’s method'
      : s.threshold.method === 'adaptive'
        ? `thresholded adaptively (neighbourhood radius ${number(s.threshold.adaptiveRadius)} px, offset ${number(s.threshold.adaptiveOffset)} grey levels)`
        : `thresholded at grey level ${number(s.threshold.manual)}`,
  );
  const clean: string[] = [];
  if (s.open > 0) clean.push(`opening (radius ${number(s.open)} px)`);
  if (s.close > 0) clean.push(`closing (radius ${number(s.close)} px)`);
  if (s.fillHoles) clean.push('hole filling');
  if (clean.length > 0) parts.push(`cleaned by ${clean.join(', ')}`);
  if (s.split.enabled && s.split.method === 'necks') {
    parts.push(
      `and touching particles were separated with a distance-transform watershed (neck threshold ${number(s.split.neckPercent)} %)`,
    );
  } else if (s.split.enabled && d.diameterUsed !== null) {
    parts.push(
      `and clumps were separated into particles by finding particle centres with a circular Hough transform on the edges (typical diameter ${number(d.diameterUsed, 3)} px${s.split.diameter === null ? ', estimated from the image' : ''}, radii 0.7 to 1.3 times half of it; centres needing at least ${number(s.split.outlinePercent)} % of a whole outline) and giving each mask pixel to the nearest centre`,
    );
  }
  const limits: string[] = [];
  const unit = f.unit;
  if (f.minDiameter !== null) limits.push(`smaller than ${number(f.minDiameter)} ${unit}`);
  if (f.maxDiameter !== null) limits.push(`larger than ${number(f.maxDiameter)} ${unit}`);
  if (f.minCircularity !== null) limits.push(`with circularity below ${number(f.minCircularity)}`);
  if (f.excludeEdge) limits.push('touching the edge of the analysed area');
  const filter = limits.length > 0 ? ` Particles ${limits.join(' or ')} were left out.` : '';
  const edit = d.edited
    ? ' The outlines were reviewed and corrected by hand (merged, cut, added or deleted particles).'
    : ' The outlines were reviewed.';
  return `Particles were detected automatically: the image was ${parts.join(', ')}.${filter}${edit}`;
}

/** The paragraph, as plain text. */
export function particleMethodsParagraph(input: ParticleMethodsInput): string {
  const sentences: string[] = [];
  const unit = input.unit;
  if (input.allSynthetic) {
    sentences.push(
      'The image analysed here is a generated example, not a micrograph, so no sample or instrument is described.',
    );
  }
  const where =
    input.images > 1 ? `${input.images} SEM or TEM images were pooled` : 'The image was analysed';
  sentences.push(
    input.nmPerPixel !== null
      ? `${where} with ${input.software}; lengths were calibrated from the scale bar of the image (${number(input.nmPerPixel)} nm per pixel${input.images > 1 ? ' for the image on screen' : ''}).`
      : `${where} with ${input.software}; no scale was set, so sizes are in pixels.`,
  );
  if (input.detection) sentences.push(detectionSentence(input.detection));
  if (input.handCount > 0) {
    sentences.push(
      `${input.handCount} particle${input.handCount === 1 ? ' was' : 's were'} also measured by hand.`,
    );
  }
  const binText =
    input.bins.method === 'manual'
      ? `${input.bins.count} bins chosen by hand`
      : `${input.bins.count} bins by the ${BIN_METHOD_NAMES[input.bins.method]} rule`;
  sentences.push(
    `The size distribution is based on the ${input.measureName} of ${input.count} particles (${binText}). The mean is ${number(input.mean)} ${unit} with a standard deviation of ${Number.isFinite(input.sd) ? number(input.sd) : 'not defined'} ${unit} (sample standard deviation); D10, D50 and D90, the sizes below which 10 %, 50 % and 90 % of the particles by number lie, are ${number(input.d10)}, ${number(input.d50)} and ${number(input.d90)} ${unit}.`,
  );
  const { lognormal, normal } = input.fits;
  if (lognormal) {
    sentences.push(
      `A lognormal distribution fitted by maximum likelihood has a median of ${number(lognormal.median)} ${unit} and a geometric standard deviation of ${number(lognormal.geometricSd)}.`,
    );
  }
  if (normal) {
    sentences.push(
      `A normal distribution fitted by maximum likelihood has a mean of ${number(normal.mean)} ${unit} and a standard deviation of ${number(normal.sigma)} ${unit}.`,
    );
  }
  return sentences.join(' ');
}
