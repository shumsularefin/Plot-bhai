import { SOFTWARE } from '../../ui/software';
import {
  betterFit,
  cleanSizes,
  fitLognormal,
  fitNormal,
  histogram,
  summarise,
} from '../../core/particles/distribution';
import { NM_PER_UNIT, UNIT_LABELS } from '../../core/particles/geometry';
import { particleMethodsParagraph } from '../../core/particles/methods';
import { sizeStatistics } from '../../core/particles/statistics';
import type { ParticleData, SizeMeasure } from './data';
import { collectSizes, imageSizes, keptParticles } from './sizes';
import { stereologyMethods, stereologyOf } from './stereology';

/** The chosen diameter in words, for tables and the methods text. */
export const MEASURE_WORDS: Record<SizeMeasure, string> = {
  'equal-area': 'equal-area diameter',
  longest: 'longest caliper (Feret) diameter',
  shortest: 'shortest caliper (Feret) diameter',
};

/**
 * Everything the distribution step shows, from the saved analysis alone (no image needed): the
 * sizes in the display unit, the summary, histogram, fits, further statistics and methods text.
 * The sample report uses the same numbers.
 */
export function distributionResults(data: ParticleData) {
  const s = data.distribution;
  const collected = collectSizes(data);
  const current = imageSizes(data, s.includeHand);
  const scaled = collected.unit === 'nm';
  const unitLabel = scaled ? UNIT_LABELS[s.unit] : 'px';
  const factor = scaled ? 1 / NM_PER_UNIT[s.unit] : 1;
  const sorted = cleanSizes(collected.values.map((v) => v * factor));
  const summary = summarise(sorted);
  const hist = histogram(sorted, s.binMethod, s.manualBins);
  const normal = fitNormal(sorted);
  const lognormal = fitLognormal(sorted);
  const better = betterFit(normal, lognormal);
  const stats = summary ? sizeStatistics(sorted, summary.mean, summary.sd) : null;
  const stereology = stereologyOf(data);
  const methods = (() => {
    if (!summary) return '';
    const usesDetected =
      s.useCurrent && data.detect.particles.length > 0 && current.equalArea.length > current.hand;
    const paragraph = particleMethodsParagraph({
      software: SOFTWARE,
      allSynthetic: data.image?.synthetic === true && collected.sources.length <= 1,
      images: collected.sources.length,
      nmPerPixel: scaled && data.scale && s.useCurrent ? keptParticles(data).perPixelNm : null,
      detection: usesDetected
        ? {
            settings: data.detect.settings,
            edited: data.detect.edited,
            byHand: data.detect.particles.every((p) => p.source === 'added'),
            diameterUsed: data.detect.diameterUsed,
            thresholdUsed: data.detect.thresholdUsed,
            fellBack: data.detect.fellBack,
            filters: data.detect.filters,
          }
        : null,
      handCount: s.useCurrent && s.includeHand ? current.hand : 0,
      measureName: MEASURE_WORDS[s.measure],
      unit: unitLabel,
      count: summary.count,
      mean: summary.mean,
      sd: summary.sd,
      d10: summary.d10,
      d50: summary.d50,
      d90: summary.d90,
      bins: { method: s.binMethod, count: hist.counts.length },
      fits: { normal, lognormal },
      statistics: stats,
    });
    return stereology
      ? `${paragraph} ${stereologyMethods(stereology, data.stereology)}`
      : paragraph;
  })();
  return {
    collected,
    current,
    scaled,
    unitLabel,
    factor,
    sorted,
    summary,
    hist,
    normal,
    lognormal,
    better,
    stats,
    stereology,
    methods,
  };
}
