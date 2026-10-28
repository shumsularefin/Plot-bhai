import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import { SessionSection } from '../../../ui/SessionSection';
import type { StepContext } from '../../../ui/wizard/types';
import { downloadCsv } from '../../xrd/csv';
import { TableBox } from '../../xrd/MethodDetails';
import { analyse, isothermOf } from './analysis';
import { METHOD_LABELS, type DscMethodsData } from './data';
import { SAPPHIRE } from './example';
import { dscMethodsText } from './methodsText';
import { dscMethodsSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 2;

interface View {
  headline: string;
  notes: string[];
  sources: SeriesSource[];
  points: { x: number; y: number }[];
  labels: { x: string; y: string };
  xName: string;
  xUnit: string;
  table: JSX.Element;
  exportTable: () => void;
}

/** DSC methods step 3: the result, its plot and table, methods text and export. */
export function DscMethodsResultsStep({ data, update }: StepContext<DscMethodsData>) {
  const outcome = useMemo(() => analyse(data), [data]);
  const methods = useMemo(() => dscMethodsText(data, outcome), [data, outcome]);
  const [copied, setCopied] = useState<string | null>(null);
  const view = useMemo((): View | string => {
    if (!outcome.ok) return outcome.error;
    if (outcome.method === 'cp') {
      const { points, notes } = outcome.result;
      if (points.length === 0) return notes.join(' ') || 'No heat capacity could be calculated.';
      const mean = points.reduce((s, p) => s + p.cp, 0) / points.length;
      return {
        headline: `Specific heat capacity from ${points[0]?.cp.toFixed(3)} J/(g·K) at ${points[0]?.temperatureC.toFixed(0)} °C to ${points[points.length - 1]?.cp.toFixed(3)} J/(g·K) at ${points[points.length - 1]?.temperatureC.toFixed(0)} °C (mean ${mean.toFixed(3)})`,
        notes: [
          ...notes,
          `The sapphire values come from ${SAPPHIRE.source.citation}; ${SAPPHIRE.verification}`,
        ],
        sources: [
          {
            id: 'cp',
            name: 'Sample cp',
            x: Float64Array.from(points, (p) => p.temperatureC),
            y: Float64Array.from(points, (p) => p.cp),
            unit: 'J/(g·K)',
          },
          {
            id: 'sapphire',
            name: 'Sapphire cp (reference)',
            x: Float64Array.from(points, (p) => p.temperatureC),
            y: Float64Array.from(points, (p) => p.sapphireCp),
            unit: 'J/(g·K)',
            dashed: true,
          },
        ],
        points: points.map((p) => ({ x: p.temperatureC, y: p.cp })),
        labels: { x: 'Temperature (°C)', y: 'Specific heat capacity (J g⁻¹ K⁻¹)' },
        xName: 'T',
        xUnit: ' °C',
        table: (
          <>
            <thead>
              <tr>
                <th scope="col">T (°C)</th>
                <th scope="col">cp, sample (J/(g·K))</th>
                <th scope="col">cp, sapphire (J/(g·K))</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.temperatureC}>
                  <td>{p.temperatureC.toFixed(1)}</td>
                  <td>{p.cp.toFixed(4)}</td>
                  <td>{p.sapphireCp.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </>
        ),
        exportTable: () =>
          downloadCsv(
            'dsc-heat-capacity',
            `Specific heat capacity by the sapphire method; sapphire mass ${data.sapphireMassMg} mg, sample mass ${data.sampleMassMg} mg; sapphire values from ${SAPPHIRE.source.citation}`,
            points,
            [
              { header: 'T (degC)', value: (p) => p.temperatureC },
              { header: 'cp sample (J/(g K))', value: (p) => p.cp },
              { header: 'cp sapphire (J/(g K))', value: (p) => p.sapphireCp },
            ],
          ),
      };
    }
    if (outcome.method === 'purity') {
      if (!outcome.outcome.ok) return outcome.outcome.error;
      const r = outcome.outcome.result;
      const xs = r.points.map((p) => p.inverseF);
      const ends = Float64Array.of(Math.min(...xs), Math.max(...xs));
      return {
        headline: `Estimated purity ${r.purityMolPct.toFixed(2)} mol % (impurity ${(100 * r.x2).toFixed(2)} ± ${(100 * r.x2Sigma).toFixed(2)} mol %), T₀ = ${r.t0C.toFixed(2)} °C, ΔHf = ${r.fusionJPerG.toFixed(1)} J/g (${r.fusionKJPerMol.toFixed(2)} kJ/mol)`,
        notes: r.notes,
        sources: [
          {
            id: 'fit',
            name: 'Straight-line fit',
            x: ends,
            y: ends.map((x) => r.intercept + r.slope * x),
            unit: '°C',
          },
        ],
        points: r.points.map((p) => ({ x: p.inverseF, y: p.temperatureC })),
        labels: { x: '1/F (F = fraction melted)', y: 'Sample temperature T_s (°C)' },
        xName: '1/F',
        xUnit: '',
        table: (
          <>
            <thead>
              <tr>
                <th scope="col">1/F</th>
                <th scope="col">F</th>
                <th scope="col">T_s (°C)</th>
              </tr>
            </thead>
            <tbody>
              {r.points.map((p) => (
                <tr key={p.inverseF}>
                  <td>{p.inverseF.toFixed(3)}</td>
                  <td>{(1 / p.inverseF).toFixed(3)}</td>
                  <td>{p.temperatureC.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </>
        ),
        exportTable: () =>
          downloadCsv(
            'dsc-purity',
            `van 't Hoff purity: Ts against 1/F; purity ${r.purityMolPct.toFixed(3)} mol % (estimate), T0 = ${r.t0C.toFixed(3)} degC, dHf = ${r.fusionJPerG.toFixed(2)} J/g`,
            r.points,
            [
              { header: '1/F', value: (p) => p.inverseF },
              { header: 'F', value: (p) => 1 / p.inverseF },
              { header: 'Ts (degC)', value: (p) => p.temperatureC },
            ],
          ),
      };
    }
    if (!outcome.outcome.ok) return outcome.outcome.error;
    const r = outcome.outcome.result;
    const iso = isothermOf(data.files.sample, data.exoUp);
    const t = iso?.timeMin ?? new Float64Array();
    const line = (id: string, a: number, b: number, from: number, to: number): SeriesSource => {
      const x = Float64Array.of(from, to);
      return {
        id,
        name: id === 'baseline' ? 'Baseline' : 'Tangent',
        x,
        y: x.map((v) => a + b * v),
        unit: '',
        dashed: true,
      };
    };
    const rows = [
      ['Gas switch (min)', r.onsetMin - r.oitMin],
      ['Extrapolated onset (min)', r.onsetMin],
      ['OIT (min)', r.oitMin],
      ['Steepest rise (min)', r.steepestMin],
      ['Exothermic maximum (min)', r.peakMin],
    ] as const;
    return {
      headline: `Oxidation induction time OIT = ${r.oitMin.toFixed(2)} min (onset at ${r.onsetMin.toFixed(2)} min)`,
      notes: r.notes,
      sources: [
        {
          id: 'sample',
          name: 'Sample',
          x: t,
          y: iso?.exo ?? new Float64Array(),
          unit: data.heatFlowUnit,
        },
        line('baseline', r.baseline.intercept, r.baseline.slope, r.baseline.fromMin, r.peakMin),
        line('tangent', r.tangent.intercept, r.tangent.slope, r.onsetMin, r.steepestMin),
      ],
      points: [],
      labels: { x: 'Time (min)', y: `Heat flow (${data.heatFlowUnit}), exo up` },
      xName: 't',
      xUnit: ' min',
      table: (
        <tbody>
          {rows.map(([name, v]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{v.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      ),
      exportTable: () =>
        downloadCsv(
          'dsc-oit',
          'Oxidation induction time by the tangent method; times in min',
          [...rows],
          [
            { header: 'Quantity', value: (row) => row[0] },
            { header: 'Value', value: (row) => row[1] },
          ],
        ),
    };
  }, [outcome, data]);

  if (typeof view === 'string') {
    return (
      <p class="message is-error" role="alert">
        {view}
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  return (
    <div class="results-step">
      <p class="message is-info" role="note">
        {METHOD_LABELS[data.method]}: {view.headline}.
      </p>
      <ul class="pattern-messages">
        {view.notes.map((n, i) => (
          <li key={i} class="message is-warning">
            {n}
          </li>
        ))}
      </ul>
      <TableBox label="Results table" onExport={view.exportTable}>
        {view.table}
      </TableBox>
      <PlotPanel
        sources={view.sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => ({ ...view.labels, yValues: true })}
        xName={view.xName}
        xUnit={view.xUnit}
        exportName={`dsc-${data.method}`}
        showOverlayOptions={false}
        points={view.points}
      />
      <section aria-labelledby="dscm-methods-title">
        <h3 id="dscm-methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">Written only from the settings you used and the numbers above.</p>
        <textarea
          class="methods-text"
          readOnly
          rows={8}
          value={methods}
          aria-label="Methods paragraph"
        />
        <div class="export-actions">
          <button type="button" class="btn" onClick={() => void copy()}>
            Copy text
          </button>
        </div>
        <p class="export-status" role="status">
          {copied}
        </p>
      </section>
      <SessionSection
        codec={dscMethodsSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={`dsc-${data.method}`}
      />
    </div>
  );
}
