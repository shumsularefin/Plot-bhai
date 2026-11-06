import { otsuThreshold } from './threshold';

/*
 * Global automatic thresholds from a 256-level histogram, the ones ImageJ offers under
 * Image › Adjust › Auto Threshold (G. Landini's Auto_Threshold plugin). Every function returns a
 * grey level t: pixels brighter than t are the foreground (particles). The equations follow the
 * papers cited; where ImageJ adds its own details they are noted, and results can differ from
 * ImageJ by a grey level because of rounding.
 */

export type AutoThresholdMethod =
  | 'default'
  | 'intermodes'
  | 'li'
  | 'maxentropy'
  | 'mean'
  | 'minimum'
  | 'moments'
  | 'otsu'
  | 'triangle';

export const AUTO_THRESHOLD_NAMES: Record<AutoThresholdMethod, string> = {
  default: 'Default (IsoData variant)',
  intermodes: 'Intermodes',
  li: 'Li',
  maxentropy: 'MaxEntropy',
  mean: 'Mean',
  minimum: 'Minimum',
  moments: 'Moments',
  otsu: 'Otsu',
  triangle: 'Triangle',
};

/** Methods-text names with their source. */
export const AUTO_THRESHOLD_CITATIONS: Record<AutoThresholdMethod, string> = {
  default:
    'the iterative intermeans (IsoData) method of Ridler and Calvard (1978) in the form ImageJ uses as its Default',
  intermodes: 'the intermodes method of Prewitt and Mendelsohn (1966)',
  li: 'Li’s minimum cross entropy method (Li and Tam, 1998)',
  maxentropy: 'the maximum entropy method of Kapur, Sahoo and Wong (1985)',
  mean: 'the mean grey level (Glasbey, 1993)',
  minimum: 'the minimum method of Prewitt and Mendelsohn (1966)',
  moments: 'Tsai’s moment-preserving method (Tsai, 1985)',
  otsu: 'Otsu’s method (Otsu, 1979)',
  triangle: 'the triangle method of Zack, Rogers and Latt (1977)',
};

/** One-line explanations for the method list. */
export const AUTO_THRESHOLD_HINTS: Record<AutoThresholdMethod, string> = {
  default: 'ImageJ’s own default. Midway between the mean of the dark and the bright pixels.',
  intermodes: 'Midway between the two peaks of the smoothed histogram. Needs two clear peaks.',
  li: 'Good for soft edges and a small share of particles.',
  maxentropy: 'Keeps the most information in both parts. Often marks fewer pixels.',
  mean: 'The average grey level. Simple, often marks too much.',
  minimum: 'The valley between the two peaks of the smoothed histogram. Needs two clear peaks.',
  moments: 'Keeps the first three moments of the histogram.',
  otsu: 'Best separation of two groups of grey levels. A good first choice.',
  triangle: 'For a few small bright particles on a large background peak.',
};

export const AUTO_THRESHOLD_METHODS = Object.keys(AUTO_THRESHOLD_NAMES) as AutoThresholdMethod[];

const levels = 256;
const at = (hist: ArrayLike<number>, i: number) => hist[i] as number;

/**
 * ImageJ's Default: the iterative intermeans (IsoData) rule of T. W. Ridler and S. Calvard,
 * IEEE Trans. Syst. Man Cybern. 8 (1978) 630–632. Starting at the darkest level present, the
 * candidate g moves up one level at a time until g + 1 > (μ_low(g) + μ_high(g)) / 2, where μ_low
 * and μ_high are the mean levels at or below g and above it; that average, rounded, is t. As in
 * ImageJ, the counts of levels 0 and 255 are ignored (clipped pixels).
 */
export function isoDataThreshold(hist: ArrayLike<number>): number {
  const h = Array.from({ length: levels }, (_, i) =>
    i === 0 || i === levels - 1 ? 0 : at(hist, i),
  );
  let min = 0;
  while (min < levels - 1 && h[min] === 0) min++;
  let max = levels - 1;
  while (max > 0 && h[max] === 0) max--;
  if (min >= max) return levels / 2;
  let g = min;
  let result: number;
  do {
    let s1 = 0;
    let n1 = 0;
    let s2 = 0;
    let n2 = 0;
    for (let i = min; i <= g; i++) {
      s1 += i * (h[i] as number);
      n1 += h[i] as number;
    }
    for (let i = g + 1; i <= max; i++) {
      s2 += i * (h[i] as number);
      n2 += h[i] as number;
    }
    result = (s1 / n1 + s2 / n2) / 2;
    g++;
  } while (g + 1 <= result && g < max - 1);
  return Math.round(result);
}

/**
 * Minimum cross entropy (C. H. Li and C. K. Lee, Pattern Recognit. 26 (1993) 617–625), iterated
 * as in C. H. Li and P. K. S. Tam, Pattern Recognit. Lett. 19 (1998) 771–776: starting from the
 * mean, t ← round((μ_b − μ_o) / (ln μ_b − ln μ_o)) until it changes by at most half a level, where
 * μ_b and μ_o are the mean levels at or below t and above it.
 */
export function liThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < levels; i++) {
    total += at(hist, i);
    sum += i * at(hist, i);
  }
  if (total === 0) return 0;
  let next = sum / total;
  let t = 0;
  for (let iteration = 0; iteration < 1000; iteration++) {
    const previous = next;
    t = Math.floor(previous + 0.5);
    let sb = 0;
    let nb = 0;
    for (let i = 0; i <= t; i++) {
      sb += i * at(hist, i);
      nb += at(hist, i);
    }
    const so = sum - sb;
    const no = total - nb;
    const mb = nb === 0 ? 0 : sb / nb;
    const mo = no === 0 ? 0 : so / no;
    if (!(mb > 0) || !(mo > 0) || mb === mo) break;
    const value = (mb - mo) / (Math.log(mb) - Math.log(mo));
    next = Math.floor(value + 0.5);
    if (Math.abs(next - previous) <= 0.5) break;
  }
  return t;
}

/**
 * Maximum entropy (J. N. Kapur, P. K. Sahoo and A. K. C. Wong, Comput. Vis. Graph. Image Process.
 * 29 (1985) 273–285): with p_i the share of pixels at level i and P(t) = Σ_{i≤t} p_i, t maximises
 * H_b + H_o = −Σ_{i≤t} (p_i/P) ln(p_i/P) − Σ_{i>t} (p_i/(1−P)) ln(p_i/(1−P)).
 */
export function maxEntropyThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < levels; i++) total += at(hist, i);
  if (total === 0) return 0;
  const p = Array.from({ length: levels }, (_, i) => at(hist, i) / total);
  const cumulative: number[] = [];
  let c = 0;
  for (let i = 0; i < levels; i++) cumulative.push((c += p[i] as number));
  let best = 0;
  let bestEntropy = -Infinity;
  for (let t = 0; t < levels - 1; t++) {
    const pb = cumulative[t] as number;
    const po = 1 - pb;
    if (pb <= 0 || po <= 0) continue;
    let entropy = 0;
    for (let i = 0; i <= t; i++) {
      const q = (p[i] as number) / pb;
      if (q > 0) entropy -= q * Math.log(q);
    }
    for (let i = t + 1; i < levels; i++) {
      const q = (p[i] as number) / po;
      if (q > 0) entropy -= q * Math.log(q);
    }
    if (entropy > bestEntropy) {
      bestEntropy = entropy;
      best = t;
    }
  }
  return best;
}

/** The mean grey level, rounded down (C. A. Glasbey, CVGIP: Graph. Models Image Process. 55 (1993) 532–537). */
export function meanThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < levels; i++) {
    total += at(hist, i);
    sum += i * at(hist, i);
  }
  return total === 0 ? 0 : Math.floor(sum / total);
}

/**
 * Moment preserving (W.-H. Tsai, Comput. Vis. Graph. Image Process. 29 (1985) 377–393): the two
 * levels z0 < z1 and the share p0 at z0 that keep the first three moments m1, m2, m3 of the
 * histogram solve z² + c1 z + c0 = 0 with c0 = (m1 m3 − m2²) / (m2 − m1²) and
 * c1 = (m1 m2 − m3) / (m2 − m1²), and p0 = (z1 − m1) / (z1 − z0). t is the first level at which
 * the cumulative share exceeds p0.
 */
export function momentsThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < levels; i++) total += at(hist, i);
  if (total === 0) return 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < levels; i++) {
    const p = at(hist, i) / total;
    m1 += i * p;
    m2 += i * i * p;
    m3 += i * i * i * p;
  }
  const cd = m2 - m1 * m1;
  if (!(cd > 0)) return Math.floor(m1);
  const c0 = (m1 * m3 - m2 * m2) / cd;
  const c1 = (m1 * m2 - m3) / cd;
  const root = Math.sqrt(Math.max(0, c1 * c1 - 4 * c0));
  const z0 = 0.5 * (-c1 - root);
  const z1 = 0.5 * (-c1 + root);
  const p0 = (z1 - m1) / (z1 - z0);
  let cumulative = 0;
  for (let i = 0; i < levels; i++) {
    cumulative += at(hist, i) / total;
    if (cumulative > p0) return i;
  }
  return levels - 1;
}

/** The local maxima of a histogram, ignoring flat tops' repeats: positions of strict rises then falls. */
function peaks(h: readonly number[]): number[] {
  const found: number[] = [];
  for (let i = 1; i < h.length - 1; i++) {
    if ((h[i - 1] as number) < (h[i] as number) && (h[i + 1] as number) < (h[i] as number))
      found.push(i);
  }
  return found;
}

/**
 * Smooths the histogram with a running mean of three levels (the end levels average with their
 * one neighbour) until it has exactly two peaks, as in J. M. S. Prewitt and M. L. Mendelsohn,
 * Ann. N. Y. Acad. Sci. 128 (1966) 1035–1053. Returns null when that does not happen within
 * 10 000 passes (for example a histogram with one peak).
 */
function bimodal(hist: ArrayLike<number>): { h: number[]; peaks: [number, number] } | null {
  let h = Array.from({ length: levels }, (_, i) => at(hist, i));
  for (let pass = 0; pass <= 10000; pass++) {
    const found = peaks(h);
    if (found.length === 2) return { h, peaks: found as [number, number] };
    if (found.length < 2 && pass > 0) return null;
    h = h.map((v, i) => {
      if (i === 0) return (v + (h[1] as number)) / 2;
      if (i === levels - 1) return (v + (h[i - 1] as number)) / 2;
      return ((h[i - 1] as number) + v + (h[i + 1] as number)) / 3;
    });
  }
  return null;
}

/** Intermodes: midway between the two peaks of the smoothed histogram, rounded down. Null without two peaks. */
export function intermodesThreshold(hist: ArrayLike<number>): number | null {
  const found = bimodal(hist);
  return found ? Math.floor((found.peaks[0] + found.peaks[1]) / 2) : null;
}

/** Minimum: the lowest level of the smoothed histogram between its two peaks. Null without two peaks. */
export function minimumThreshold(hist: ArrayLike<number>): number | null {
  const found = bimodal(hist);
  if (!found) return null;
  let best = found.peaks[0];
  for (let i = found.peaks[0]; i <= found.peaks[1]; i++)
    if ((found.h[i] as number) < (found.h[best] as number)) best = i;
  return best;
}

/**
 * Triangle (G. W. Zack, W. E. Rogers and S. A. Latt, J. Histochem. Cytochem. 25 (1977) 741–753):
 * a line joins the histogram peak to the far end of its longer tail (the first empty level past
 * the last occupied one); t is the level between them whose histogram point lies farthest below
 * that line. When the longer tail is on the dark side, t is one level below that point, so that
 * in both cases the point itself goes with the peak's side.
 */
export function triangleThreshold(hist: ArrayLike<number>): number {
  let first = 0;
  while (first < levels - 1 && at(hist, first) === 0) first++;
  let last = levels - 1;
  while (last > 0 && at(hist, last) === 0) last--;
  if (first >= last) return first;
  let peak = first;
  for (let i = first; i <= last; i++) if (at(hist, i) > at(hist, peak)) peak = i;
  // The end of the longer tail, one level beyond the last occupied level (an empty level).
  const brightTail = last - peak >= peak - first;
  const end = brightTail ? Math.min(levels - 1, last + 1) : Math.max(0, first - 1);
  const height = at(hist, peak);
  const dx = end - peak;
  let best = peak;
  let bestDistance = -1;
  const lo = Math.min(peak, end);
  const hi = Math.max(peak, end);
  for (let i = lo; i <= hi; i++) {
    // Distance from (i, h_i) to the line through (peak, height) and (end, h_end), up to a constant factor.
    const lineY = height + ((i - peak) / dx) * (at(hist, end) - height);
    const d = lineY - at(hist, i);
    if (d > bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return brightTail ? best : best - 1;
}

/** The threshold of the chosen method; methods that need two histogram peaks fall back to Otsu without them. */
export function autoThreshold(
  method: AutoThresholdMethod,
  hist: Int32Array,
): { level: number; fellBack: boolean } {
  switch (method) {
    case 'default':
      return { level: isoDataThreshold(hist), fellBack: false };
    case 'li':
      return { level: liThreshold(hist), fellBack: false };
    case 'maxentropy':
      return { level: maxEntropyThreshold(hist), fellBack: false };
    case 'mean':
      return { level: meanThreshold(hist), fellBack: false };
    case 'moments':
      return { level: momentsThreshold(hist), fellBack: false };
    case 'triangle':
      return { level: triangleThreshold(hist), fellBack: false };
    case 'intermodes':
    case 'minimum': {
      const level = method === 'minimum' ? minimumThreshold(hist) : intermodesThreshold(hist);
      return level === null
        ? { level: otsuThreshold(hist), fellBack: true }
        : { level, fellBack: false };
    }
    case 'otsu':
      return { level: otsuThreshold(hist), fellBack: false };
  }
}
