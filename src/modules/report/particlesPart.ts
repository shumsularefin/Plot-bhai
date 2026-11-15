import { formatNumber } from '../../core/xrd/parsers/numbers';
import type { ReportPart } from '../../ui/report/sampleReport';
import { SIZE_MEASURE_NAMES, type ParticleData } from '../particles/data';
import { distributionResults } from '../particles/results';

const num = (value: number, digits = 4) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '–';

/**
 * The particle size part of the sample report: the same numbers as the distribution step, with
 * the weighting of each stated. Null when no particles are measured. Works without the image.
 */
export function particlesPart(data: ParticleData): ReportPart | null {
  const r = distributionResults(data);
  const { summary, stats, lognormal, unitLabel: u } = r;
  if (!summary) return null;
  const measure = SIZE_MEASURE_NAMES[data.distribution.measure].toLowerCase();
  const results = [
    {
      title: `Size distribution, ${measure} (number-based)`,
      lines: [
        `${summary.count} particles from ${r.collected.sources.length} image(s)`,
        `Mean ${num(summary.mean)} ${u}, SD ${num(summary.sd)} ${u} (sample, n − 1)${stats ? `, CV ${formatNumber(stats.cv * 100, 1)} %` : ''}`,
        ...(stats?.interval
          ? [
              `95 % confidence interval of the mean: ${num(stats.interval.lower)}–${num(stats.interval.upper)} ${u} (Student t, standard error ${num(stats.interval.sem)} ${u})`,
            ]
          : []),
        `D10 ${num(summary.d10)}, D50 ${num(summary.d50)}, D90 ${num(summary.d90)} ${u}; span ${num(summary.span, 3)}`,
        ...(lognormal
          ? [
              `Lognormal fit: median ${num(lognormal.median)} ${u}, geometric SD ${num(lognormal.geometricSd, 3)}`,
            ]
          : []),
      ],
    },
  ];
  if (stats)
    results.push({
      title: 'Surface- and volume-weighted values (estimates assuming spheres)',
      lines: [
        `D[3,2] (Sauter) ${num(stats.moments.d32)} ${u}, D[4,3] (De Brouckere) ${num(stats.moments.d43)} ${u}`,
        `Dv10 ${num(stats.volume.dv10)}, Dv50 ${num(stats.volume.dv50)}, Dv90 ${num(stats.volume.dv90)} ${u}`,
      ],
    });
  return {
    tool: 'Particle size (SEM/TEM)',
    data: r.collected.sources.map((source) => source.name),
    example: data.image?.synthetic === true && r.collected.sources.length <= 1,
    results,
    methods: r.methods,
  };
}
