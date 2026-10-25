import { TRANSITIONS } from '../../core/uvvis/tauc';
import { formatWithSigma } from '../../ui/format';
import { fingerprint, type AnalysisRecord, type RecordData } from '../../ui/report/record';
import { cleanAll, fitMessages, resultRows } from './analysis';
import { cleaningFor, type UvvisData } from './data';
import { methodsText } from './methodsText';

const n = (v: number, digits = 4) => Number(v.toPrecision(digits)).toString();

/** The UV-Vis analysis record (see src/ui/report/record.ts), written from the saved session. */
export async function uvvisRecord(data: UvvisData): Promise<AnalysisRecord> {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  const rows = resultRows(data);
  const records: RecordData[] = [];
  const results: AnalysisRecord['results'] = [];
  for (const [i, s] of data.spectra.entries()) {
    const settings = cleaningFor(data, s.id);
    const messages = cleaned[i]?.messages ?? {};
    const blank = data.spectra.find((b) => b.id === settings.blank.blankId);
    records.push({
      name: s.name,
      description: `${s.source}, ${s.wavelengthNm.length} points, ${n(s.wavelengthNm[0] as number, 6)} to ${n(s.wavelengthNm[s.wavelengthNm.length - 1] as number, 6)} nm, values read as ${s.kind}${s.kind === 'absorbance' ? '' : ` (${s.scale})`}, type from ${s.kindOrigin}${s.synthetic ? ', synthetic example data' : ''}`,
      fingerprint: await fingerprint([s.wavelengthNm, s.values]),
      fromFile: [],
      notes: s.notes,
      steps: [
        {
          name: 'Blank correction',
          used: settings.blank.enabled,
          parameters: [`blank: ${blank?.name ?? 'none chosen'}`],
          messages: messages.blank ?? [],
        },
        {
          name: 'Baseline offset',
          used: settings.offset.enabled,
          parameters: [
            `mean between ${settings.offset.fromNm} and ${settings.offset.toNm} nm removed`,
          ],
          messages: messages.offset ?? [],
        },
        {
          name: 'Savitzky–Golay smoothing',
          used: settings.smoothing.enabled,
          parameters: [
            `window ${settings.smoothing.window} points`,
            `order ${settings.smoothing.order}`,
          ],
          messages: messages.smoothing ?? [],
        },
      ],
    });
    const row = rows[i];
    if (!row) continue;
    const { analysis, choice } = row;
    const t = TRANSITIONS[choice.transition];
    results.push({
      title: `Band gap and absorption (estimates): ${s.name}`,
      lines: [
        `Signal: ${analysis.signal.unit === 'alpha' ? `α from A with thickness ${choice.thicknessNm} nm` : analysis.signal.unit === 'kubelka-munk' ? 'Kubelka–Munk F(R)' : 'absorbance (proportional to α)'}`,
        `Tauc plot for ${t.label.toLowerCase()} transitions, n = ${t.nText} (the transition type is the user's choice, not deduced from the data)`,
        analysis.fit
          ? `Eg = ${formatWithSigma(analysis.fit.egEv, analysis.fit.egSigma)} eV from a straight line over ${n(analysis.fit.fromEv)}–${n(analysis.fit.toEv)} eV (${analysis.fit.n} points, R² = ${analysis.fit.rSquared.toFixed(4)}, ${analysis.suggested ? 'region suggested automatically' : 'region chosen by the user'})`
          : 'No Tauc fit.',
        ...fitMessages(analysis).map(
          (m) => `${m.level === 'warning' ? 'Warning' : 'Note'}: ${m.text}`,
        ),
        ...(analysis.urbach?.fit
          ? [
              `Urbach energy ${formatWithSigma(analysis.urbach.fit.euEv * 1000, analysis.urbach.fit.euSigma * 1000)} meV`,
            ]
          : []),
        ...(analysis.derivative
          ? [
              `Steepest rise at ${n(analysis.derivative.egEv)} eV${analysis.derivative.atEdge ? ' (at the end of the searched range: not a band gap estimate)' : ''}`,
            ]
          : []),
        ...(row.lambdaMax ? [`Absorption maximum at ${n(row.lambdaMax.wavelengthNm, 5)} nm`] : []),
      ],
    });
  }
  return {
    tool: 'UV-Vis',
    data: records,
    shared: [
      `λmax searched from ${data.lambdaRange.fromNm ?? 'the start'} to ${data.lambdaRange.toNm ?? 'the end'} nm`,
    ],
    results,
    methods: methodsText(data),
  };
}
