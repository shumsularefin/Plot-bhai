import { intensityText } from '../../core/ftir/peakShape';
import { processSpectrum } from '../../core/ftir/process';
import { ORIGIN_TEXT } from './peakText';
import { fingerprint, type AnalysisRecord, type RecordData } from '../../ui/report/record';
import { ASSIGNMENT_MATCH_CM, attachAssignments, peaksOf } from './analysis';
import { peakEditsFor, peaksFor, processingFor, type FtirData } from './data';
import { methodsText } from './methodsText';
import { shownQuantity, valueIn } from './quantity';

const n = (v: number, digits = 4) => Number(v.toPrecision(digits)).toString();

/** The FTIR analysis record (see src/ui/report/record.ts), written from the saved session. */
export async function ftirRecord(data: FtirData): Promise<AnalysisRecord> {
  const shown = shownQuantity(data, data.spectra);
  const records: RecordData[] = [];
  const results: AnalysisRecord['results'] = [];
  for (const s of data.spectra) {
    const settings = processingFor(data, s.id);
    const processed = processSpectrum(s, settings);
    const b = settings.baseline;
    const baseline =
      b.method === 'arpls'
        ? ['arPLS', `λ = 10^${n(b.logLambda)}`]
        : b.method === 'als'
          ? ['asymmetric least squares', `λ = 10^${n(b.logLambda)}`, `p = ${n(b.p)}`]
          : b.method === 'polynomial'
            ? ['iterative polynomial', `degree ${b.degree}`]
            : ['rubber band (lower convex hull)'];
    const peakSettings = peaksFor(data, s.id);
    const edits = peakEditsFor(data, s.id);
    const peaks = peaksOf(processed, peakSettings, edits);
    records.push({
      name: s.name,
      description: `${s.source}, ${s.wavenumber.length} points, ${n(s.wavenumber[0] as number, 6)} to ${n(s.wavenumber[s.wavenumber.length - 1] as number, 6)} cm⁻¹, values read as ${s.kind}${s.kind !== 'absorbance' ? ` (${s.scale})` : ''}, type from ${s.kindOrigin}${s.synthetic ? ', synthetic example data' : ''}`,
      fingerprint: await fingerprint([s.wavenumber, s.values]),
      fromFile: [],
      notes: s.notes,
      steps: [
        {
          name:
            s.kind === 'reflectance'
              ? 'Conversion of diffuse reflectance'
              : 'Conversion to absorbance',
          used: s.kind !== 'absorbance',
          parameters: [
            s.kind === 'reflectance'
              ? settings.reflectance === 'kubelka-munk'
                ? 'Kubelka–Munk F(R) = (1 − R)² / (2R)'
                : 'log10(1/R)'
              : 'A = −log10(T)',
            ...(s.scale === 'percent'
              ? [`${s.kind === 'reflectance' ? 'R = %R' : 'T = %T'} / 100`]
              : []),
          ],
          messages: [],
        },
        {
          name: 'CO₂ region replaced by a straight line',
          used: settings.co2.enabled,
          parameters: [
            `${n(settings.co2.fromCm)} to ${n(settings.co2.toCm)} cm⁻¹`,
            'no peaks picked there',
          ],
          messages: processed.messages.co2 ?? [],
        },
        {
          name: 'Baseline correction',
          used: b.enabled,
          parameters: baseline,
          messages: processed.messages.baseline ?? [],
        },
        {
          name: 'Savitzky–Golay smoothing',
          used: settings.smoothing.enabled,
          parameters: [
            `window ${settings.smoothing.window} points`,
            `order ${settings.smoothing.order}`,
          ],
          messages: processed.messages.smoothing ?? [],
        },
        {
          name: 'Normalisation',
          used: settings.normalise.enabled,
          parameters: [
            settings.normalise.method === 'max'
              ? 'divide by the highest absorbance'
              : settings.normalise.method === 'minmax'
                ? 'lowest 0, highest 1'
                : `divide by the band ${settings.normalise.band.measure} between ${settings.normalise.band.fromCm ?? '?'} and ${settings.normalise.band.toCm ?? '?'} cm⁻¹, above the straight line between those ends`,
          ],
          messages: processed.messages.normalise ?? [],
        },
        {
          name: 'Peak picking on absorbance',
          used: true,
          parameters: [
            `prominence ≥ ${n(peakSettings.prominencePercent)} % of the absorbance range`,
            `range ${peakSettings.fromCm ?? 'start'} to ${peakSettings.toCm ?? 'end'} cm⁻¹`,
          ],
          messages: [],
        },
        {
          name: 'Peaks edited by hand',
          used: edits.added.length + edits.removed.length > 0,
          parameters: [
            `${edits.added.filter((a) => !a.shoulder).length} added`,
            `${edits.added.filter((a) => a.shoulder).length} shoulders accepted from the second derivative`,
            `${edits.removed.length} picked peaks removed`,
          ],
          messages: [],
        },
      ],
    });
    const { byPeak, detached } = attachAssignments(data.assignments[s.id], peaks);
    const own = shownQuantity(data, [s]).name;
    const quantityName = own === 'Absorbance' ? 'absorbance' : own;
    results.push({
      title: `Peaks: ${s.name}`,
      lines: peaks.length
        ? peaks.map((p, k) => {
            const label = byPeak[k]?.label;
            const shape = p.shape;
            const measures =
              shape && shape.fwhm !== null && shape.area !== null
                ? `, FWHM ${n(shape.fwhm)} cm⁻¹, area ${n(shape.area)} ${quantityName}·cm⁻¹ above the local baseline${p.overlap ? ' (overlaps a neighbour: unreliable)' : ''}`
                : '';
            const origin = p.origin === 'picked' ? '' : `, ${ORIGIN_TEXT[p.origin]}`;
            const strength = p.intensity ? `, ${intensityText(p.intensity)}` : '';
            return `${n(p.wavenumber, 6)} cm⁻¹: ${quantityName} ${n(p.height)}${shown.quantity === 'transmittance' ? `, ${n(valueIn('transmittance', p.height))} %T` : ''}, prominence ${n(p.prominence)}${measures}${strength}${origin}${label ? `, assigned (suggestion accepted or typed by the user): ${label}` : ''}`;
          })
        : ['No peaks picked.'],
    });
    if (detached.length > 0) {
      results.push({
        title: `Assignments not attached to a peak: ${s.name}`,
        lines: detached.map(
          (a) =>
            `${n(a.wavenumber, 6)} cm⁻¹ (where it was made): ${a.label}; no peak within ${ASSIGNMENT_MATCH_CM} cm⁻¹ with the current settings`,
        ),
      });
    }
  }
  return {
    tool: 'FTIR',
    data: records,
    shared: [
      `Presented as ${shown.quantity}${shown.reason ? ` (${shown.reason})` : ''}`,
      `Assignment suggestions within ${data.toleranceCm} cm⁻¹ of a listed range or band`,
    ],
    results,
    methods: methodsText(data),
  };
}
