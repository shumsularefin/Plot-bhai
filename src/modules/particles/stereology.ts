import {
  areaFraction,
  astmGrainSize,
  countIntercepts,
  meanIntercept,
  sumCounts,
  type InterceptCounts,
} from '../../core/particles/stereology';
import type { ParticleData } from './data';
import { keptParticles } from './sizes';

export interface StereologyResult {
  /** Detected regions counted (the filters of step 3 apply, except the edge filter). */
  regions: number;
  /** Area fraction of the regions in the analysis area, 0 to 1. */
  areaFraction: number;
  horizontal: InterceptCounts;
  vertical: InterceptCounts;
  /** Mean lineal intercept of each direction and of both together, in `unit`, or null. */
  meanHorizontal: number | null;
  meanVertical: number | null;
  mean: number | null;
  /** Total number of intercepts of both directions. */
  intercepts: number;
  unit: 'nm' | 'px';
  /** ASTM E112 grain size number; only with a scale. */
  astmG: number | null;
}

/** Area fraction and line intercepts of the detected particles of the image on screen. */
export function stereologyOf(data: ParticleData): StereologyResult | null {
  if (!data.image || data.detect.particles.length === 0) return null;
  const { kept, scale, perPixelNm, edgeArea } = keptParticles(data, true);
  if (edgeArea.width < 1 || edgeArea.height < 1) return null;
  const regions = kept.map((p) => p.runs);
  const { structure, lines } = data.stereology;
  const horizontal = countIntercepts(regions, edgeArea, 'horizontal', lines);
  const vertical = countIntercepts(regions, edgeArea, 'vertical', lines);
  // Working copy pixels to original pixels, then to nm when the image has a scale.
  const toUnit = (perPixelNm ?? 1) / scale;
  const mean = (c: Parameters<typeof meanIntercept>[0]) => {
    const value = meanIntercept(c, structure);
    return value === null ? null : value * toUnit;
  };
  const both = mean(sumCounts([horizontal, vertical]));
  return {
    regions: kept.length,
    areaFraction: areaFraction(regions, edgeArea),
    horizontal,
    vertical,
    meanHorizontal: mean(horizontal),
    meanVertical: mean(vertical),
    mean: both,
    intercepts: horizontal.intercepts + vertical.intercepts,
    unit: perPixelNm === null ? 'px' : 'nm',
    astmG: perPixelNm !== null && both !== null ? astmGrainSize(both * 1e-6) : null,
  };
}

const n = (value: number, digits = 4) => String(Number(value.toPrecision(digits)));

/** Sentences for the methods text, written from the settings used and the numbers found. */
export function stereologyMethods(
  result: StereologyResult,
  settings: ParticleData['stereology'],
): string {
  const parts = [
    `The area fraction of the detected regions in the analysis area was ${n(result.areaFraction * 100, 3)} %.`,
  ];
  if (result.mean !== null) {
    parts.push(
      `The mean lineal intercept length was measured on ${result.horizontal.lines} horizontal and ${result.vertical.lines} vertical evenly spaced test lines (ASTM E112-13, intercept method, end segments scored as one half; ${n(result.intercepts, 6)} intercepts)${settings.structure === 'grains' ? ' as the test line length divided by the number of grains intercepted' : ' as the line length inside the detected phase divided by its number of intercepts'}: ℓ̄ = ${n(result.mean)} ${result.unit}${result.meanHorizontal !== null && result.meanVertical !== null ? ` (horizontal ${n(result.meanHorizontal)}, vertical ${n(result.meanVertical)} ${result.unit})` : ''}${result.astmG !== null ? `, ASTM grain size number G = ${result.astmG.toFixed(1)}` : ''}.`,
    );
  }
  if (settings.xrdSizeNm !== null && settings.xrdSizeNm > 0 && result.unit === 'nm') {
    parts.push(
      `For comparison, the crystallite size from XRD${settings.xrdMethod.trim() ? ` (${settings.xrdMethod.trim()})` : ''} was ${n(settings.xrdSizeNm)} nm.`,
    );
  }
  return parts.join(' ');
}
