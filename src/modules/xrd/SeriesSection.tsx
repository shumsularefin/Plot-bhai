import { useMemo, useState } from 'preact/hooks';
import type { Anode } from '../../core/xrd/radiation';
import { withUncertainty } from '../../core/xrd/rietveld/report';
import { relativeSlope, scientificText, labelUnit } from '../../core/xrd/rietveld/sequential';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { SeriesPattern, SeriesRequest } from '../../workers/rietveld.worker';
import { downloadCsv } from './csv';
import type { RietveldState, SeriesSettings, XrdData } from './data';
import { TableBox } from './MethodDetails';
import type { RietveldClient } from './rietveldClient';
import { DEFAULT_SERIES, seriesMethodsFor, seriesTrend, seriesValue } from './seriesReport';

interface SeriesSectionProps {
  data: XrdData;
  update: (patch: Partial<XrdData>) => void;
  settings: RietveldState;
  set: (patch: Partial<RietveldState>) => void;
  client: RietveldClient | null;
  /** The shared settings of every pattern, or null when the refinement cannot run yet. */
  request: (patterns: SeriesPattern[], copyForward: boolean) => SeriesRequest | null;
  /** Builds one pattern of the request (cleaning and Kα2 ratio of that pattern). */
  pattern: (id: string, value: number) => SeriesPattern | null;
  /** Key of the shared settings, to tell when the series result is out of date. */
  settingsKey: string;
  anomalous?: Anode;
}

const text = (v: { value: number; esd: number } | null, unit: string) =>
  !v
    ? '–'
    : unit === '%' || unit === ''
      ? withUncertainty(v.value, v.esd, 2)
      : withUncertainty(v.value, v.esd);

/**
 * Sequential refinement (Rietveld step, Advanced): every loaded pattern refined in order of a
 * series value with the settings above, and one refined quantity followed through the series
 * with a weighted straight line (sequential.ts).
 */
export function SeriesSection(props: SeriesSectionProps) {
  const { data, settings, set } = props;
  const series = settings.series ?? DEFAULT_SERIES;
  const setSeries = (patch: Partial<SeriesSettings>) => set({ series: { ...series, ...patch } });
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  const rows = data.patterns.map((p) => ({
    id: p.id,
    name: p.name,
    value: seriesValue(series, data, p.id),
    included: !series.excluded.includes(p.id),
  }));
  const used = rows.filter((r) => r.included);
  const missing = used.some((r) => r.value === null);
  const key = JSON.stringify([
    props.settingsKey,
    used.map((r) => [r.id, r.value]),
    series.copyForward,
  ]);
  const points = series.result?.points ?? null;
  const stale = series.result !== null && series.result.key !== key;
  const unit = labelUnit(series.label);
  const xName = series.label.replace(/\s*\([^()]*\)\s*$/, '').trim() || 'Series value';

  const run = async () => {
    if (!props.client || missing || used.length < 2) return;
    const patterns = used.flatMap((r) => {
      const p = props.pattern(r.id, r.value as number);
      return p ? [p] : [];
    });
    const request = props.request(patterns, series.copyForward);
    if (!request) return;
    setError(null);
    setStage('Starting');
    const result = await props.client.refineSeries(request, setStage, props.anomalous);
    setStage(null);
    if (!result) return;
    if (result.every((p) => p.error))
      setError(result[0]?.error ?? 'The series could not be refined.');
    setSeries({ result: { key, points: result } });
  };

  const { quantities, quantity, trend } = useMemo(
    () =>
      points
        ? seriesTrend(points, series.quantity)
        : { quantities: [], quantity: null, trend: null },
    [points, series.quantity],
  );
  const methods = useMemo(() => seriesMethodsFor(settings.series), [settings.series]);

  const plotted = useMemo(
    () =>
      points && quantity
        ? points
            .flatMap((p, i) => {
              const v = quantity.values[i];
              if (!v || !Number.isFinite(v.value)) return [];
              return [{ x: p.value, y: v.value, ...(v.esd > 0 && { error: v.esd }) }];
            })
            .sort((p, q) => p.x - q.x)
        : [],
    [points, quantity],
  );
  // The plot takes its ranges from the curves: the fitted line, or the points joined when there
  // is no line (R_wp, or a quantity without uncertainties).
  const sources = useMemo<SeriesSource[]>(() => {
    if (plotted.length === 0 || !quantity) return [];
    const unit = quantity.unit;
    if (!trend)
      return [
        {
          id: 'joined',
          name: 'Points joined',
          x: Float64Array.from(plotted, (p) => p.x),
          y: Float64Array.from(plotted, (p) => p.y),
          unit,
          colorIndex: 7,
          dashed: true,
        },
      ];
    const x = Float64Array.from([plotted[0]?.x ?? 0, plotted[plotted.length - 1]?.x ?? 0]);
    return [
      {
        id: 'line',
        name: 'Weighted straight line',
        x,
        y: x.map((v) => trend.fit.intercept + trend.fit.slope * v),
        unit,
        colorIndex: 0,
      },
    ];
  }, [plotted, trend, quantity]);

  const exportCsv = () =>
    points &&
    downloadCsv(
      'rietveld-series',
      `Sequential Rietveld refinement of ${points.length} patterns. ${methods}`,
      points,
      [
        { header: 'Pattern', value: (p) => p.name },
        { header: series.label, value: (p) => p.value },
        ...quantities.flatMap((q) => [
          {
            header: `${q.label}${q.unit ? ` (${q.unit})` : ''}`,
            value: (p: (typeof points)[number]) => q.values[points.indexOf(p)]?.value ?? '',
          },
          {
            header: `${q.label} s.u.`,
            value: (p: (typeof points)[number]) => q.values[points.indexOf(p)]?.esd ?? '',
          },
        ]),
        { header: 'Problem', value: (p) => p.error ?? '' },
      ],
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying was not allowed here. Select the text and copy it by hand.');
    }
  };

  const relative = trend && relativeSlope(trend);

  return (
    <Advanced id="rietveld-series" title="Sequential refinement of a series">
      <p class="field-hint">
        Refines every pattern you loaded with the settings above, one after another in order of a
        value you give each one (temperature, composition, time), and follows a refined quantity
        through the series, for example the lattice parameter against temperature.{' '}
        <HelpTip term="sequential refinement">
          <p>
            As GSAS-II’s sequential refinement with “copy results to next histogram”: with Start
            from the previous result on, each pattern starts from the unit cells refined on the
            pattern before it, and from its atom positions, occupancies and displacement factors
            when the structure is refined, so the peaks line up even when the cell changes a lot
            along the series. Scale, background and peak shape start from the same values on every
            pattern. The phases, the parameters to refine and the 2θ range are the same for every
            pattern; each pattern uses its own cleaning from step 2.
          </p>
        </HelpTip>
      </p>
      <label class="inline-field">
        Series value and unit
        <input
          value={series.label}
          onInput={(e) => setSeries({ label: e.currentTarget.value })}
          placeholder="Temperature (°C)"
        />
      </label>
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Patterns of the series, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Include</th>
              <th scope="col">Pattern</th>
              <th scope="col">{series.label || 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Include ${r.name} in the series`}
                    checked={r.included}
                    onChange={(e) =>
                      setSeries({
                        excluded: e.currentTarget.checked
                          ? series.excluded.filter((id) => id !== r.id)
                          : [...series.excluded, r.id],
                      })
                    }
                  />
                </td>
                <th scope="row">{r.name}</th>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    aria-label={`${series.label || 'Series value'} of ${r.name}`}
                    aria-invalid={r.included && r.value === null}
                    value={r.value ?? ''}
                    onInput={(e) => {
                      const t = e.currentTarget.value.trim();
                      const v = Number(t);
                      if (t === '' || Number.isFinite(v))
                        setSeries({ values: { ...series.values, [r.id]: t === '' ? null : v } });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="field-hint">
        The values are suggested from the last number in each file name; check them.
      </p>
      <label class="check">
        <input
          type="checkbox"
          checked={series.copyForward}
          onChange={(e) => setSeries({ copyForward: e.currentTarget.checked })}
        />
        Start from the previous result{' '}
        <HelpTip term="start from the previous result">
          <p>
            Each pattern starts from the unit cells (and the atoms, when the structure is refined)
            refined on the one before it in the series. Keep it on when the cell changes along the
            series; off, every pattern starts from the reference cells and structures. With a good
            fit both give the same answer.
          </p>
        </HelpTip>
      </label>

      <div class="export-actions">
        {stage === null ? (
          <button
            type="button"
            class="btn btn-primary"
            disabled={!props.client || missing || used.length < 2}
            onClick={() => void run()}
          >
            Refine the series
          </button>
        ) : (
          <button type="button" class="btn" onClick={() => props.client?.cancel()}>
            Cancel
          </button>
        )}
        <p class="export-status" role="status" aria-live="polite">
          {stage !== null
            ? `${stage}…`
            : used.length < 2
              ? 'Include at least two patterns.'
              : missing
                ? 'Type a value for every included pattern.'
                : stale
                  ? 'Settings changed since the series was refined. Refine it again to update the results.'
                  : ''}
        </p>
      </div>
      {error && <p class="message is-warning">{error}</p>}

      {points && (
        <section aria-labelledby="rietveld-series-title">
          <h3 id="rietveld-series-title" class="export-title">
            Series results (estimates)
          </h3>
          {points
            .filter((p) => p.error)
            .map((p) => (
              <p key={p.id} class="message is-warning">
                <strong>{p.name}:</strong> {p.error}
              </p>
            ))}
          {points.some((p) => !p.error && !p.converged) && (
            <p class="message is-warning">
              <strong>Check:</strong> the refinement of{' '}
              {points
                .filter((p) => !p.error && !p.converged)
                .map((p) => p.name)
                .join(', ')}{' '}
              stopped before it converged, so those values are less reliable.
            </p>
          )}
          <TableBox label="Series results" onExport={exportCsv}>
            <thead>
              <tr>
                <th scope="col">Pattern</th>
                <th scope="col">{series.label || 'Value'}</th>
                {quantities.map((q) => (
                  <th key={q.key} scope="col">
                    {q.label}
                    {q.unit && ` (${q.unit})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{p.value}</td>
                  {quantities.map((q) => (
                    <td key={q.key}>{p.error ? '–' : text(q.values[i] ?? null, q.unit)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </TableBox>
          <p class="field-hint">
            Numbers in brackets are standard uncertainties in the last digits, from the refinement
            of each pattern.
          </p>

          {quantities.length > 0 && (
            <label class="inline-field">
              Follow through the series
              <select
                value={quantity?.key ?? ''}
                onChange={(e) => setSeries({ quantity: e.currentTarget.value })}
              >
                {quantities.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {quantity && sources.length > 0 && (
            <PlotPanel
              sources={sources}
              settings={data.plot}
              onSettingsChange={(patch) => props.update({ plot: { ...data.plot, ...patch } })}
              dock="manual"
              labels={() => ({
                x: series.label || 'Series value',
                y: `${quantity.label}${quantity.unit ? ` (${quantity.unit})` : ''}`,
                yValues: true,
              })}
              xName={xName}
              xUnit={unit}
              exportName={`rietveld-series-${quantity.key.replace(/[^A-Za-z0-9]+/g, '-')}`}
              showOverlayOptions={false}
              points={plotted}
            />
          )}
          {plotted.some((p) => p.error) && (
            <p class="field-hint">
              The bars are ± one standard uncertainty of each refinement; where none shows, it is
              smaller than the symbol.
            </p>
          )}
          {trend && relative ? (
            <dl class="fit-values">
              <div>
                <dt>Slope</dt>
                <dd>
                  {scientificText(trend.fit.slope, trend.fit.slopeSigma)} {trend.unit}
                  {unit && ` per ${unit}`}
                </dd>
              </div>
              <div>
                <dt>Intercept</dt>
                <dd>
                  {scientificText(trend.fit.intercept, trend.fit.interceptSigma)} {trend.unit}
                </dd>
              </div>
              <div>
                <dt>
                  Relative slope (1/y₀)·dy/dx{' '}
                  <HelpTip term="relative slope">
                    <p>
                      The slope divided by the fitted value at the lowest {xName.toLowerCase()}. For
                      a lattice parameter against temperature this is the linear thermal expansion
                      coefficient over the range measured.
                    </p>
                  </HelpTip>
                </dt>
                <dd>
                  {scientificText(relative.value, relative.sigma)}
                  {unit && ` per ${unit}`}
                </dd>
              </div>
              <div>
                <dt>R²</dt>
                <dd>{Number.isFinite(trend.fit.rSquared) ? trend.fit.rSquared.toFixed(4) : '–'}</dd>
              </div>
              <div>
                <dt>
                  χ²<sub>ν</sub> of the line{' '}
                  <HelpTip term="χ² of the line">
                    <p>
                      How far the points scatter about the line compared with their standard
                      uncertainties. The slope uncertainty is scaled by its square root, because
                      refinement uncertainties usually underestimate the real scatter. Well above 1
                      also means the change may not be linear.
                    </p>
                  </HelpTip>
                </dt>
                <dd>
                  {Number.isFinite(trend.fit.reducedChi2) ? trend.fit.reducedChi2.toFixed(2) : '–'}
                </dd>
              </div>
            </dl>
          ) : (
            quantity && (
              <p class="field-hint">
                A straight line is fitted only to a refined quantity with standard uncertainties on
                at least two patterns.
              </p>
            )
          )}
          {methods && (
            <>
              <p class="methods-text">{methods}</p>
              <div class="export-actions">
                <button type="button" class="btn" onClick={() => void copy()}>
                  Copy the series methods text
                </button>
                <p class="export-status" role="status" aria-live="polite">
                  {copied}
                </p>
              </div>
            </>
          )}
        </section>
      )}
    </Advanced>
  );
}
