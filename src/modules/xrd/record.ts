import { runPipeline } from '../../core/xrd/process/pipeline';
import { ANODES } from '../../core/xrd/radiation';
import { phaseReference } from '../../core/xrd/reference/source';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { stepStats } from '../../core/xrd/summary';
import { formatWithSigma } from '../../ui/format';
import { fingerprint, type AnalysisRecord, type RecordData } from '../../ui/report/record';
import { peaksFor, processingFor, type XrdData } from './data';
import { methodsFor } from './methodsText';
import { METHOD_NAMES, sizeResults } from './sizeResults';

const n = (v: number, digits = 4) => Number(v.toPrecision(digits)).toString();

/** The XRD analysis record (see src/ui/report/record.ts), written from the saved session. */
export async function xrdRecord(
  data: XrdData,
  phases: readonly ReferencePhase[],
): Promise<AnalysisRecord> {
  const lines = ANODES[data.radiation.anode];
  const records: RecordData[] = [];
  const results: AnalysisRecord['results'] = [];
  for (const pattern of data.patterns) {
    const settings = processingFor(data, pattern.id);
    const run = runPipeline(pattern.twoTheta, pattern.intensity, settings, data.radiation);
    const step = stepStats(pattern.twoTheta);
    const b = settings.background;
    const background =
      b.method === 'arpls'
        ? [`arPLS`, `width ${n(b.arplsWidthDeg)}° 2θ`]
        : b.method === 'snip'
          ? ['SNIP', `width ${n(b.snipWidthDeg)}° 2θ`]
          : b.method === 'polynomial'
            ? ['iterative polynomial', `degree ${b.degree}`]
            : ['manual points', `${b.anchors.length} points`];
    const peaks = peaksFor(data, pattern.id);
    const d = peaks.detection;
    records.push({
      name: pattern.name,
      description: `${pattern.source}, ${pattern.twoTheta.length} points, ${n(pattern.twoTheta[0] as number, 6)} to ${n(pattern.twoTheta[pattern.twoTheta.length - 1] as number, 6)}° 2θ, step ${n(step.median)}°${step.uniform ? '' : ' (varies)'}, intensity in ${pattern.intensityUnit} (${pattern.unitOrigin})${pattern.synthetic ? ', synthetic example data' : ''}`,
      fingerprint: await fingerprint([pattern.twoTheta, pattern.intensity]),
      fromFile: pattern.metadata ?? [],
      notes: pattern.notes,
      steps: [
        {
          name: 'Zero shift',
          used: settings.zeroShift.enabled,
          parameters: [`${n(settings.zeroShift.shiftDeg)}° subtracted from 2θ`],
          messages: run.messages.zeroShift ?? [],
        },
        {
          name: 'Savitzky–Golay smoothing',
          used: settings.smoothing.enabled,
          parameters: [
            `window ${settings.smoothing.window} points`,
            `order ${settings.smoothing.order}`,
          ],
          messages: run.messages.smoothing ?? [],
        },
        {
          name: 'Background removal',
          used: b.enabled,
          parameters: background,
          messages: run.messages.background ?? [],
        },
        {
          name: 'Kα2 stripping (Rachinger)',
          used: settings.kAlpha2.enabled && !data.radiation.kAlpha1Only,
          parameters: [`Kα2/Kα1 = ${n(data.radiation.kAlpha2Ratio)}`],
          messages: run.messages.kAlpha2 ?? [],
        },
        {
          name: 'Normalisation',
          used: settings.normalise.enabled,
          parameters: [`highest point = ${settings.normalise.target}`],
          messages: run.messages.normalise ?? [],
        },
        {
          name: 'Peak finding',
          used: peaks.detected,
          parameters: [
            `prominence ≥ ${n(d.prominencePercent)} % of the range`,
            `signal-to-noise ≥ ${n(d.minSnr)}`,
            `width ≥ ${n(d.minWidthSteps)} steps`,
            `separation ≥ ${n(d.minSeparationDeg)}°`,
            `${peaks.guesses.length} peaks kept for fitting`,
          ],
          messages: [],
        },
        {
          name: 'Peak fitting (bounded Levenberg–Marquardt, linear background per region)',
          used: peaks.fit !== null,
          parameters: [
            `profile ${peaks.fitOptions.profile}`,
            ...(peaks.fitOptions.profile === 'pseudo-voigt'
              ? [
                  peaks.fitOptions.fixedEta === null
                    ? 'η fitted'
                    : `η fixed at ${peaks.fitOptions.fixedEta}`,
                ]
              : []),
          ],
          messages: (peaks.fit?.regions ?? []).flatMap((r) =>
            r.messages.map((m) => ({ ...m, text: `${n(r.start, 5)}–${n(r.end, 5)}°: ${m.text}` })),
          ),
        },
      ],
    });

    if (peaks.fit) {
      results.push({
        title: `Fitted peaks: ${pattern.name}`,
        lines: peaks.fit.regions.flatMap((r) => [
          `Region ${n(r.start, 5)}–${n(r.end, 5)}°: ${r.peaks.length} peak(s), R² = ${Number.isFinite(r.rSquared) ? r.rSquared.toFixed(4) : '–'}, reduced χ² = ${Number.isFinite(r.reducedChiSquared) ? r.reducedChiSquared.toFixed(2) : '–'}${r.uncertaintiesOk === false ? ', uncertainties not determined' : ''}${r.converged ? '' : ', did not converge'}`,
          ...r.peaks.map(
            (p) =>
              `  2θ = ${formatWithSigma(p.center, p.sigma.center)}°, FWHM = ${formatWithSigma(p.fwhm, p.sigma.fwhm)}°, height = ${formatWithSigma(p.height, p.sigma.height)}, area = ${formatWithSigma(p.area, p.areaSigma)}, η = ${formatWithSigma(p.eta, p.sigma.eta)}${p.messages.length ? ` (${p.messages.map((m) => m.text).join(' ')})` : ''}`,
          ),
        ]),
      });
    }
    const size = sizeResults(data, pattern.id);
    if (size.kind === 'ok') {
      results.push({
        title: `Crystallite size and strain (estimates): ${pattern.name}`,
        lines: [
          `K = ${n(data.results.k)}, λ = ${n(lines.kAlpha1, 8)} Å, ${size.peaks.filter((p) => p.used).length} peaks used${size.skipped ? ', instrument correction skipped (sizes are lower limits)' : ''}`,
          ...size.summary.map((row) =>
            row.unavailable
              ? `${METHOD_NAMES[row.method]}: not available (${row.unavailable})`
              : `${METHOD_NAMES[row.method]}: size ${row.size ? `${formatWithSigma(row.size.value, row.size.sigma)} nm` : '–'}${row.strain ? `, strain ${formatWithSigma(row.strain.value, row.strain.sigma)}` : ''}${Number.isFinite(row.rSquared) ? `, R² = ${row.rSquared.toFixed(3)}` : ''}, n = ${row.n}`,
          ),
        ],
      });
    }
  }

  const i = data.instrument;
  const shared = [
    `Radiation: ${data.radiation.anode} Kα1 ${lines.kAlpha1} Å (${lines.source})${data.radiation.kAlpha1Only ? ', Kα1 only' : `, Kα2 ${lines.kAlpha2} Å, ratio ${data.radiation.kAlpha2Ratio}`}`,
    `Instrument broadening: ${
      i.source === 'skip'
        ? 'not corrected'
        : i.source === 'constant'
          ? `constant FWHM ${i.constantFwhm ?? '–'}°`
          : i.source === 'caglioti'
            ? `Caglioti U = ${i.caglioti.u ?? '–'}, V = ${i.caglioti.v ?? '–'}, W = ${i.caglioti.w ?? '–'} (${i.caglioti.convention})`
            : `measured standard (${i.standard?.material ?? '–'}, ${i.standard?.pattern.name ?? 'none loaded'})`
    }; correction ${i.method}`,
    `Candidate phases: ${
      phases.length
        ? phases
            .map(
              (p) =>
                `${p.name} (${p.formula}, ${p.spaceGroup.hm}, ${phaseReference(p)})${data.material.phaseIds.includes(p.id) ? ' [used]' : ''}`,
            )
            .join('; ')
        : 'none'
    }; line tolerance ${data.material.toleranceDeg}°`,
  ];
  return {
    tool: 'XRD',
    data: records,
    shared,
    results,
    methods: methodsFor(data, [...phases]),
  };
}
