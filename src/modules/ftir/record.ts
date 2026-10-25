import { processSpectrum } from '../../core/ftir/process';
import { fingerprint, type AnalysisRecord, type RecordData } from '../../ui/report/record';
import { peaksOf } from './analysis';
import { peaksFor, processingFor, type FtirData } from './data';
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
    const peaks = peaksOf(processed, peakSettings);
    records.push({
      name: s.name,
      description: `${s.source}, ${s.wavenumber.length} points, ${n(s.wavenumber[0] as number, 6)} to ${n(s.wavenumber[s.wavenumber.length - 1] as number, 6)} cm⁻¹, values read as ${s.kind}${s.kind === 'transmittance' ? ` (${s.scale})` : ''}, type from ${s.kindOrigin}${s.synthetic ? ', synthetic example data' : ''}`,
      fingerprint: await fingerprint([s.wavenumber, s.values]),
      fromFile: [],
      notes: s.notes,
      steps: [
        {
          name: 'Conversion to absorbance',
          used: s.kind === 'transmittance',
          parameters: [`A = −log10(T)${s.scale === 'percent' ? ', T = %T / 100' : ''}`],
          messages: [],
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
              : 'lowest 0, highest 1',
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
      ],
    });
    const assigned = data.assignments[s.id] ?? [];
    results.push({
      title: `Peaks: ${s.name}`,
      lines: peaks.length
        ? peaks.map((p) => {
            const label = assigned.find((a) => Math.abs(a.wavenumber - p.wavenumber) <= 2)?.label;
            return `${n(p.wavenumber, 6)} cm⁻¹: absorbance ${n(p.height)}${shown.quantity === 'transmittance' ? `, ${n(valueIn('transmittance', p.height))} %T` : ''}, prominence ${n(p.prominence)}${label ? `, assigned (suggestion accepted or typed by the user): ${label}` : ''}`;
          })
        : ['No peaks picked.'],
    });
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
