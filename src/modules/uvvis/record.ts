import { SIGMOID_N } from '../../core/uvvis/crossChecks';
import {
  INDEX_RELATIONS,
  indexFromGap,
  inIndexRange,
  type IndexRelation,
} from '../../core/uvvis/optics';
import { GAP_METHODS, TRANSITIONS } from '../../core/uvvis/tauc';
import { formatWithSigma } from '../../ui/format';
import { powerBaselineText } from './tables';
import { fingerprint, type AnalysisRecord, type RecordData } from '../../ui/report/record';
import {
  baselineUsed,
  cleanAll,
  fitMessages,
  resultJobs,
  rowsFrom,
  type ResultRow,
} from './analysis';
import { analyseJobs } from './bandGapClient';
import { bandRows, ORIGIN_TEXT } from './bands';
import { cleaningFor, type UvvisData } from './data';
import { methodsText } from './methodsText';

const n = (v: number, digits = 4) => Number(v.toPrecision(digits)).toString();

/** The UV-Vis analysis record (see src/ui/report/record.ts), written from the saved session. */
export async function uvvisRecord(data: UvvisData): Promise<AnalysisRecord> {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  // The band gaps come from the worker (and its cache, usually filled by the Results step).
  const pending = resultJobs(data);
  const rows = rowsFrom(pending, await analyseJobs(pending.map((r) => r.job)));
  const bands = bandRows(data);
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
    for (const row of rows.filter((r) => r.spectrum === s)) results.push(gapResult(row));
    const own = bands.filter((r) => r.spectrum === s);
    if (own.length > 0)
      results.push({
        title: `Absorption bands: ${s.name}`,
        lines: own.map(
          (r) =>
            `${n(r.peak.wavelengthNm, 5)} nm (${n(r.peak.energyEv)} eV), value ${n(r.peak.value)}, prominence ${n(r.peak.prominence)}, ${ORIGIN_TEXT[r.peak.origin]}`,
        ),
      });
  }
  return {
    tool: 'UV-Vis',
    data: records,
    shared: [
      `λmax searched from ${data.lambdaRange.fromNm ?? 'the start'} to ${data.lambdaRange.toNm ?? 'the end'} nm`,
    ],
    results,
    methods: methodsText(data, rows),
  };
}

const RELATIONS = Object.keys(INDEX_RELATIONS) as IndexRelation[];

/** The record lines of one result row (one spectrum and transition). */
function gapResult(row: ResultRow): AnalysisRecord['results'][number] {
  const { analysis, choice, spectrum: s } = row;
  const t = TRANSITIONS[choice.transition];
  const baseline = baselineUsed(analysis);
  const path =
    choice.sample === 'solution'
      ? `α of the solution from A with path length ${choice.pathCm} cm`
      : `α from A with film thickness ${choice.thicknessNm} nm`;
  const reflection = analysis.reflection;
  const fit = analysis.fit;
  return {
    title: `Band gap and absorption (estimates): ${s.name}${row.primary ? '' : `, ${t.label.toLowerCase()} (also reported)`}`,
    lines: [
      `Signal: ${analysis.signal.unit === 'alpha' ? path : analysis.signal.unit === 'kubelka-munk' ? 'Kubelka–Munk F(R)' : 'absorbance (proportional to α)'}`,
      ...(reflection
        ? [
            reflection.state === 'corrected'
              ? `Reflection: α corrected with reflectance ${reflection.name} (slab with multiple internal reflections, substrate neglected)`
              : 'Reflection: not corrected (α overestimated where the film reflects)',
          ]
        : []),
      `Tauc plot for ${t.label.toLowerCase()} transitions, n = ${t.nText} (the transition type is the user's choice, not deduced from the data)`,
      fit
        ? `Eg = ${formatWithSigma(fit.egEv, fit.egSigma)} eV from a straight line over ${n(fit.fromEv)}–${n(fit.toEv)} eV (${fit.n} points, R² = ${fit.rSquared.toFixed(4)}, ${analysis.suggested ? 'region suggested automatically' : 'region chosen by the user'}), read as the ${GAP_METHODS[analysis.method].short}${analysis.automatic ? ' (chosen automatically)' : ''}${baseline ? `, baseline region ${n(baseline[0])}–${n(baseline[1])} eV (${analysis.baselineSuggested ? 'suggested' : 'chosen by the user'})` : ''}${analysis.powerBaseline ? `, ${powerBaselineText(analysis)} (a + c·E^m)` : ''}${analysis.component && analysis.componentFactor ? `, second component ${analysis.component.name} subtracted with c = ${analysis.componentFactor.n > 0 ? `${formatWithSigma(analysis.componentFactor.value, analysis.componentFactor.sigma)} (fitted over the baseline region)` : `${n(analysis.componentFactor.value)} (typed by the user)`}` : ''}`
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
      ...(analysis.cody
        ? [
            analysis.cody.fit
              ? `Cody cross-check: Eg = ${formatWithSigma(analysis.cody.fit.egEv, analysis.cody.fit.egSigma)} eV over ${n(analysis.cody.fit.fromEv)}–${n(analysis.cody.fit.toEv)} eV (R² = ${analysis.cody.fit.rSquared.toFixed(4)}, ${analysis.cody.suggested ? 'suggested' : 'chosen by the user'})`
              : 'Cody cross-check: no fit',
          ]
        : []),
      ...(analysis.sigmoid
        ? [
            analysis.sigmoid.fit
              ? `Sigmoid cross-check (Zanatta 2019): E0 = ${formatWithSigma(analysis.sigmoid.fit.e0Ev, analysis.sigmoid.fit.e0Sigma)} eV, δE = ${formatWithSigma(analysis.sigmoid.fit.deltaEv, analysis.sigmoid.fit.deltaSigma)} eV, Eg = E0 − ${SIGMOID_N[analysis.sigmoid.fit.type]}·δE = ${formatWithSigma(analysis.sigmoid.fit.egEv, analysis.sigmoid.fit.egSigma)} eV (${analysis.sigmoid.fit.type}, ${n(analysis.sigmoid.fit.fromEv)}–${n(analysis.sigmoid.fit.toEv)} eV, R² = ${analysis.sigmoid.fit.rSquared.toFixed(4)})`
              : 'Sigmoid cross-check: no fit',
          ]
        : []),
      ...(fit
        ? [
            `Refractive index from Eg (rough empirical estimates): ${RELATIONS.map(
              (r) =>
                `${INDEX_RELATIONS[r].label} ${n(indexFromGap(r, fit.egEv))}${inIndexRange(r, fit.egEv) ? '' : ' (outside its stated range)'}`,
            ).join(', ')}`,
          ]
        : []),
      ...(row.primary && row.lambdaMax
        ? [`Absorption maximum at ${n(row.lambdaMax.wavelengthNm, 5)} nm`]
        : []),
    ],
  };
}
