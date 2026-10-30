import { SOFTWARE } from '../../ui/software';
import { useMemo, useState } from 'preact/hooks';
import {
  betterFit,
  BIN_METHOD_NAMES,
  cleanSizes,
  countWarning,
  cumulative,
  fitLognormal,
  fitNormal,
  histogram,
  lognormalPdf,
  normalPdf,
  summarise,
  type BinMethod,
} from '../../core/particles/distribution';
import { NM_PER_UNIT, UNIT_LABELS, type LengthUnit } from '../../core/particles/geometry';
import { particleMethodsParagraph } from '../../core/particles/methods';
import { HelpTip } from '../../ui/HelpTip';
import { DEFAULT_EXPORT_SETTINGS, downloadBlob, fileStem } from '../../ui/plot/export';
import type { ExportSettings } from '../../ui/plot/export';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { annotatedImage } from './annotate';
import {
  newId,
  SIZE_MEASURE_NAMES,
  type DistributionSettings,
  type ParticleData,
  type SizeMeasure,
} from './data';
import { downloadParticles } from './DetectStep';
import { grayOf } from './grayImage';
import { HistogramChart } from './HistogramChart';
import { GREY_GROUPS, measureColumns } from './measureColumns';
import { useImage } from './useImage';
import { collectSizes, imageSizes, keptParticles, poolEntryOf } from './sizes';
import { stereologyMethods, stereologyOf } from './stereology';
import { StereologySection } from './StereologySection';

const MEASURE_WORDS: Record<SizeMeasure, string> = {
  'equal-area': 'equal-area diameter',
  longest: 'longest caliper (Feret) diameter',
  shortest: 'shortest caliper (Feret) diameter',
};

const fmt = (value: number, digits = 4) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '–';

/** Wizard step 5: size distribution, fits, pooling of images, and export of figure, tables and text. */
export function DistributionStep({ data, update }: StepContext<ParticleData>) {
  const s = data.distribution;
  const set = (patch: Partial<DistributionSettings>) =>
    update({ distribution: { ...s, ...patch } });
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    ...DEFAULT_EXPORT_SETTINGS,
    heightMm: 65,
  });
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const imageState = useImage(data.image);

  const collected = useMemo(() => collectSizes(data), [data]);
  const current = useMemo(() => imageSizes(data, s.includeHand), [data, s.includeHand]);
  const scaled = collected.unit === 'nm';
  const unitLabel = scaled ? UNIT_LABELS[s.unit] : 'px';
  const factor = scaled ? 1 / NM_PER_UNIT[s.unit] : 1;
  const sorted = useMemo(
    () => cleanSizes(collected.values.map((v) => v * factor)),
    [collected, factor],
  );
  const summary = useMemo(() => summarise(sorted), [sorted]);
  const hist = useMemo(
    () => histogram(sorted, s.binMethod, s.manualBins),
    [sorted, s.binMethod, s.manualBins],
  );
  const normal = useMemo(() => fitNormal(sorted), [sorted]);
  const lognormal = useMemo(() => fitLognormal(sorted), [sorted]);
  const better = betterFit(normal, lognormal);
  const warning = countWarning(sorted.length);

  const measureName = SIZE_MEASURE_NAMES[s.measure];
  const xLabel = `${measureName} (${unitLabel})`;
  const figure = useMemo(() => {
    const lo = hist.edges[0] as number;
    const hi = hist.edges[hist.edges.length - 1] as number;
    const points = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
    const fit =
      s.showFit === 'lognormal' && lognormal
        ? {
            name: 'Lognormal fit',
            x: points,
            y: points.map((x) => sorted.length * hist.binWidth * lognormalPdf(x, lognormal)),
          }
        : s.showFit === 'normal' && normal
          ? {
              name: 'Normal fit',
              x: points,
              y: points.map(
                (x) =>
                  sorted.length *
                  hist.binWidth *
                  normalPdf(x, { mean: normal.mean, sigma: normal.sigma }),
              ),
            }
          : null;
    return {
      histogram: hist,
      fit,
      cumulative: s.showCumulative ? cumulative(sorted) : null,
      xLabel,
    };
  }, [hist, s.showFit, s.showCumulative, lognormal, normal, sorted, xLabel]);

  const hasImage = data.image !== null;
  const stereology = useMemo(() => stereologyOf(data), [data]);
  const methods = useMemo(() => {
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
    });
    return stereology
      ? `${paragraph} ${stereologyMethods(stereology, data.stereology)}`
      : paragraph;
  }, [
    summary,
    data,
    s,
    current,
    collected,
    scaled,
    unitLabel,
    hist,
    normal,
    lognormal,
    stereology,
  ]);

  const stem = fileStem(data.image?.name.replace(/\.[^.]+$/, '') ?? 'particles');

  const addToPool = () => {
    if (!data.image || current.equalArea.length === 0) return;
    const name = data.image.name;
    const replaced = data.pool.some((p) => p.name === name);
    update({
      pool: [...data.pool.filter((p) => p.name !== name), poolEntryOf(newId(), name, current)],
    });
    setNote(
      replaced
        ? `Replaced the saved numbers of ${name}.`
        : `Saved ${current.equalArea.length} particles of ${name}. You can load the next image in step 1; the pool is kept.`,
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  const downloadAnnotated = async () => {
    if (imageState.status !== 'ready') return;
    try {
      const blob = await annotatedImage(imageState.image, keptParticles(data).kept, data.crop);
      downloadBlob(blob, `${stem}-annotated.png`);
      setNote(`Saved ${stem}-annotated.png.`);
    } catch {
      setNote('This browser could not create the annotated image.');
    }
  };

  const downloadSummary = () => {
    if (!summary) return;
    const rows = [
      ['Number of particles', summary.count, ''],
      ['Mean', summary.mean, unitLabel],
      ['Standard deviation (sample, n - 1)', summary.sd, unitLabel],
      ['Median', summary.median, unitLabel],
      ['Smallest', summary.min, unitLabel],
      ['Largest', summary.max, unitLabel],
      ['D10', summary.d10, unitLabel],
      ['D50', summary.d50, unitLabel],
      ['D90', summary.d90, unitLabel],
      ['Span (D90 - D10) / D50', summary.span, ''],
      ...(lognormal
        ? [
            ['Lognormal median (exp mu)', lognormal.median, unitLabel],
            ['Lognormal mean', lognormal.mean, unitLabel],
            ['Lognormal geometric SD (exp sigma)', lognormal.geometricSd, ''],
            ['Lognormal mu (of ln of the size in ' + unitLabel + ')', lognormal.mu, ''],
            ['Lognormal sigma (of ln of the size)', lognormal.sigma, ''],
          ]
        : []),
      ...(normal
        ? [
            ['Normal mean', normal.mean, unitLabel],
            ['Normal sigma (maximum likelihood, n)', normal.sigma, unitLabel],
          ]
        : []),
    ] as [string, number, string][];
    downloadCsv(
      `${stem}-distribution-summary`,
      `Size distribution of the ${MEASURE_WORDS[s.measure]} from ${collected.sources.length} image(s). D10, D50 and D90 are number-based percentiles (linear interpolation between sorted values).`,
      rows,
      [
        { header: 'Quantity', value: (r) => r[0] },
        { header: 'Value', value: (r) => r[1] },
        { header: 'Unit', value: (r) => r[2] },
      ],
    );
  };

  const downloadSizes = () => {
    const rows: { source: string; n: number; value: number }[] = [];
    let at = 0;
    for (const source of collected.sources) {
      for (let i = 0; i < source.count; i++) {
        rows.push({
          source: source.name,
          n: i + 1,
          value: (collected.values[at++] as number) * factor,
        });
      }
    }
    downloadCsv(
      `${stem}-sizes`,
      `${measureName} of every particle used in the distribution, in ${unitLabel}.`,
      rows,
      [
        { header: 'Image', value: (r) => r.source },
        { header: 'Particle', value: (r) => r.n },
        { header: `${measureName} (${unitLabel})`, value: (r) => r.value },
      ],
    );
  };

  const downloadDetected = () => {
    const { kept, scale, perPixelNm, edgeArea } = keptParticles(data);
    downloadParticles(
      kept.slice().sort((a, b) => a.id - b.id),
      scale,
      perPixelNm,
      edgeArea,
      data.image?.name.replace(/\.[^.]+$/, '') ?? 'particles',
      measureColumns(
        // Grey values need the image; leave those columns out while it is not loaded.
        imageState.status === 'ready'
          ? data.detect.columns
          : data.detect.columns.filter((g) => !GREY_GROUPS.has(g)),
        {
          scale,
          gray: imageState.status === 'ready' ? grayOf(imageState.image) : null,
          nmPerPixel: perPixelNm,
        },
      ),
    );
  };

  if (!hasImage && data.pool.length === 0) {
    return <p>No image is loaded. Go back to step 1 to add one.</p>;
  }

  return (
    <div class="export-step dist-step">
      <section aria-labelledby="dist-sources">
        <h3 id="dist-sources" class="export-title">
          What goes into the distribution
        </h3>
        <div class="export-grid">
          <label class="export-field">
            Size measure{' '}
            <select
              value={s.measure}
              onChange={(e) => set({ measure: e.currentTarget.value as SizeMeasure })}
            >
              {(Object.keys(SIZE_MEASURE_NAMES) as SizeMeasure[]).map((key) => (
                <option key={key} value={key}>
                  {SIZE_MEASURE_NAMES[key]}
                </option>
              ))}
            </select>
          </label>
          <HelpTip term="size measure">
            <p>
              The equal-area diameter is the diameter of the circle with the same area as the
              particle: the usual single number for a round-ish particle. The Feret (caliper)
              diameters are the longest and the shortest distance between two parallel lines that
              touch the particle; use the longest one for rods. Say which one you report.
            </p>
          </HelpTip>
          {scaled && (
            <label class="export-field">
              Unit{' '}
              <select
                value={s.unit}
                onChange={(e) => set({ unit: e.currentTarget.value as LengthUnit })}
              >
                {(Object.keys(UNIT_LABELS) as LengthUnit[]).map((key) => (
                  <option key={key} value={key}>
                    {UNIT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {hasImage && (
          <>
            <label class="check">
              <input
                type="checkbox"
                checked={s.useCurrent}
                onChange={(e) => set({ useCurrent: e.currentTarget.checked })}
              />
              Use the particles of {data.image?.name} ({current.equalArea.length - current.hand}{' '}
              detected)
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={s.includeHand}
                onChange={(e) => set({ includeHand: e.currentTarget.checked })}
              />
              Also use the {data.measurements.length} hand measurement
              {data.measurements.length === 1 ? '' : 's'} from step 3
            </label>
            <div class="export-actions">
              <button
                type="button"
                class="btn"
                disabled={current.equalArea.length === 0}
                onClick={addToPool}
              >
                Save this image for pooling
              </button>
              <HelpTip term="pooling">
                <p>
                  One image rarely holds enough particles. Save the numbers of each image here, load
                  the next image in step 1, detect or measure it, and save it too. The distribution
                  below then combines all saved images. Images with a scale and images without
                  (pixels) cannot be combined.
                </p>
              </HelpTip>
            </div>
          </>
        )}
        {data.pool.length > 0 && (
          <ul class="pool-list">
            {data.pool.map((entry) => (
              <li key={entry.id}>
                {entry.name}: {entry.equalArea.length} particles ({entry.unit})
                {collected.skipped.includes(entry) && ' – not used, its unit differs from the rest'}
                {s.useCurrent &&
                  entry.name === data.image?.name &&
                  ' – counted once, from the image on screen'}{' '}
                <button
                  type="button"
                  class="btn"
                  aria-label={`Remove ${entry.name} from the pool`}
                  onClick={() => update({ pool: data.pool.filter((p) => p.id !== entry.id) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {!scaled && sorted.length > 0 && (
          <p class="message is-warning">
            <strong>No scale:</strong> sizes are in pixels. Set the scale bar in step 2 to get nm or
            µm.
          </p>
        )}
        {collected.values.length > sorted.length && (
          <p class="message is-warning">
            {collected.values.length - sorted.length} value(s) of zero or less were left out.
          </p>
        )}
        {note && (
          <p class="export-status" role="status">
            {note}
          </p>
        )}
      </section>

      {!summary ? (
        <p class="message">
          <strong>Nothing to show yet.</strong> Detect particles in step 3 or measure some by hand
          in step 4.
        </p>
      ) : (
        <>
          {warning && (
            <p class="message is-warning" role="alert">
              <strong>Check:</strong> {warning}
            </p>
          )}
          <section aria-labelledby="dist-figure">
            <h3 id="dist-figure" class="export-title">
              Histogram
            </h3>
            <div class="export-grid">
              <label class="export-field">
                Bins{' '}
                <select
                  value={s.binMethod}
                  onChange={(e) => set({ binMethod: e.currentTarget.value as BinMethod })}
                >
                  {(Object.keys(BIN_METHOD_NAMES) as BinMethod[]).map((key) => (
                    <option key={key} value={key}>
                      {BIN_METHOD_NAMES[key]}
                    </option>
                  ))}
                </select>
              </label>
              {s.binMethod === 'manual' && (
                <label class="export-field">
                  Number of bins
                  <input
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={s.manualBins}
                    onChange={(e) => {
                      const value = Number(e.currentTarget.value);
                      if (Number.isFinite(value))
                        set({ manualBins: Math.min(200, Math.max(1, value)) });
                    }}
                  />
                </label>
              )}
              <HelpTip term="number of bins">
                <p>
                  Freedman–Diaconis sets the bin width from the spread of the middle half of the
                  data (2 × IQR / n<sup>1/3</sup>) and copes well with outliers. Sturges uses ⌈log
                  <sub>2</sub> n⌉ + 1 bins and suits roughly bell-shaped data. Either is a starting
                  point; the histogram of a few particles changes a lot with the bins.
                </p>
              </HelpTip>
              <label class="export-field">
                Curve{' '}
                <select
                  value={s.showFit}
                  onChange={(e) =>
                    set({ showFit: e.currentTarget.value as DistributionSettings['showFit'] })
                  }
                >
                  <option value="lognormal">Lognormal fit</option>
                  <option value="normal">Normal fit</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={s.showCumulative}
                  onChange={(e) => set({ showCumulative: e.currentTarget.checked })}
                />
                Cumulative curve
              </label>
            </div>
            <HistogramChart
              figure={figure}
              description={`Histogram of the ${MEASURE_WORDS[s.measure]} of ${summary.count} particles in ${unitLabel}`}
              exportName={`${stem}-histogram`}
              settings={exportSettings}
              onSettings={(patch) => setExportSettings({ ...exportSettings, ...patch })}
            />
          </section>

          <section aria-labelledby="dist-numbers">
            <h3 id="dist-numbers" class="export-title">
              Numbers{' '}
              <HelpTip term="D10, D50, D90">
                <p>
                  D10, D50 and D90 are the sizes below which 10 %, 50 % and 90 % of the particles
                  lie, counted by number (not by volume), using linear interpolation between the
                  sorted values. D50 is the median. The span (D90 − D10) / D50 tells how wide the
                  distribution is compared with its middle.
                </p>
              </HelpTip>
            </h3>
            <div
              class="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Distribution numbers, scrolls sideways"
            >
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">Count</th>
                    <th scope="col">Mean ({unitLabel})</th>
                    <th scope="col">SD ({unitLabel})</th>
                    <th scope="col">Median ({unitLabel})</th>
                    <th scope="col">D10 ({unitLabel})</th>
                    <th scope="col">D50 ({unitLabel})</th>
                    <th scope="col">D90 ({unitLabel})</th>
                    <th scope="col">Span</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{summary.count}</td>
                    <td>{fmt(summary.mean)}</td>
                    <td>{fmt(summary.sd)}</td>
                    <td>{fmt(summary.median)}</td>
                    <td>{fmt(summary.d10)}</td>
                    <td>{fmt(summary.d50)}</td>
                    <td>{fmt(summary.d90)}</td>
                    <td>{fmt(summary.span, 3)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="field-hint">SD is the sample standard deviation (divisor n − 1).</p>
            <h4 class="export-title">
              Fits by maximum likelihood{' '}
              <HelpTip term="maximum likelihood fit">
                <p>
                  The normal fit uses the mean and the spread of the sizes. The lognormal fit does
                  the same for ln(size); size distributions of nanoparticles are often skewed to the
                  right, which a lognormal follows. The higher log-likelihood describes the data
                  better, but neither fit is proved right by it: look at the curve on the histogram.
                  The fits are estimates and depend on the particles chosen.
                </p>
              </HelpTip>
            </h4>
            <div
              class="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Fit results, scrolls sideways"
            >
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">Fit</th>
                    <th scope="col">Centre ({unitLabel})</th>
                    <th scope="col">Spread</th>
                    <th scope="col">Log-likelihood</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Lognormal</th>
                    <td>{lognormal ? `median ${fmt(lognormal.median)}` : '–'}</td>
                    <td>{lognormal ? `geometric SD ${fmt(lognormal.geometricSd, 3)}` : '–'}</td>
                    <td>{lognormal ? fmt(lognormal.logLikelihood, 6) : '–'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Normal</th>
                    <td>{normal ? `mean ${fmt(normal.mean)}` : '–'}</td>
                    <td>{normal ? `σ ${fmt(normal.sigma)} ${unitLabel}` : '–'}</td>
                    <td>{normal ? fmt(normal.logLikelihood, 6) : '–'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {better && (
              <p class="field-hint">
                The {better} fit has the higher log-likelihood for these sizes.
              </p>
            )}
          </section>

          <StereologySection
            data={data}
            update={update}
            stem={stem}
            particleNm={
              scaled
                ? {
                    mean: summary.mean / factor,
                    median: summary.median / factor,
                    measure: MEASURE_WORDS[s.measure],
                  }
                : null
            }
          />

          <section aria-labelledby="dist-export">
            <h3 id="dist-export" class="export-title">
              Export
            </h3>
            <div class="export-actions">
              <button type="button" class="btn btn-primary" onClick={downloadSummary}>
                Summary (CSV)
              </button>
              <button type="button" class="btn" onClick={downloadSizes}>
                All sizes (CSV)
              </button>
              <button
                type="button"
                class="btn"
                disabled={data.detect.particles.length === 0}
                onClick={downloadDetected}
              >
                Detected particles (CSV)
              </button>
              <button
                type="button"
                class="btn"
                disabled={imageState.status !== 'ready' || data.detect.particles.length === 0}
                onClick={() => void downloadAnnotated()}
              >
                Annotated image (PNG)
              </button>
            </div>
            <p class="field-hint">
              The histogram has its own SVG and PNG buttons above. The annotated image shows the
              outline and number of every detected particle that passed the filters.
            </p>
          </section>

          <section aria-labelledby="dist-methods">
            <h3 id="dist-methods" class="export-title">
              Methods text
            </h3>
            <p class="field-hint">
              Written only from the settings you used. Add the microscope, the sample preparation
              and the voltage yourself; the image file does not say them reliably.
            </p>
            <textarea
              class="methods-text"
              readOnly
              rows={10}
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
        </>
      )}
    </div>
  );
}
