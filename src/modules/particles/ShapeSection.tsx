import { useMemo, useState } from 'preact/hooks';
import { cleanSizes, histogram, summarise } from '../../core/particles/distribution';
import { HelpTip } from '../../ui/HelpTip';
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '../../ui/plot/export';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { SHAPE_MEASURE_NAMES, type ParticleData, type ShapeMeasure } from './data';
import { HistogramChart } from './HistogramChart';
import { collectShapes } from './sizes';

const SHAPES = Object.keys(SHAPE_MEASURE_NAMES) as ShapeMeasure[];

const fmt = (value: number, digits = 3) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '–';

/**
 * Distributions of aspect ratio (longest over shortest caliper), circularity (4π area /
 * perimeter², ImageJ's Circ.) and solidity (area over convex hull area) of the detected particles,
 * pooled like the sizes. Hand measurements have no outline and are left out.
 */
export function ShapeSection({
  data,
  update,
  stem,
}: Pick<StepContext<ParticleData>, 'data' | 'update'> & { stem: string }) {
  const s = data.distribution;
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    ...DEFAULT_EXPORT_SETTINGS,
    heightMm: 65,
  });
  const all = useMemo(
    () =>
      Object.fromEntries(
        SHAPES.map((shape) => {
          const { values, missing } = collectShapes(data, shape);
          const sorted = cleanSizes(values);
          return [shape, { sorted, summary: summarise(sorted), missing }];
        }),
      ) as Record<
        ShapeMeasure,
        { sorted: Float64Array; summary: ReturnType<typeof summarise>; missing: string[] }
      >,
    [data],
  );
  const chosen = all[s.shape];
  const hist = useMemo(
    () => histogram(chosen.sorted, s.binMethod, s.manualBins),
    [chosen, s.binMethod, s.manualBins],
  );
  if (!all.aspectRatio.summary) return null;
  const name = SHAPE_MEASURE_NAMES[s.shape];
  const missing = chosen.missing;

  const downloadShapes = () =>
    downloadCsv(
      `${stem}-shape-summary`,
      'Shape numbers of the detected particles (hand measurements have no outline and are not included), counted by number. Aspect ratio = longest / shortest caliper; circularity = 4 pi area / perimeter^2 with the traced perimeter of ImageJ (a circle drawn in pixels reads about 0.9); solidity = area / convex hull area. P10, P50 and P90 are percentiles by linear interpolation.',
      SHAPES.flatMap((shape) => {
        const summary = all[shape].summary;
        return summary ? [{ shape, summary }] : [];
      }),
      [
        { header: 'Shape', value: (r) => SHAPE_MEASURE_NAMES[r.shape] },
        { header: 'Count', value: (r) => r.summary.count },
        { header: 'Mean', value: (r) => r.summary.mean },
        { header: 'SD (n - 1)', value: (r) => r.summary.sd },
        { header: 'P10', value: (r) => r.summary.d10 },
        { header: 'Median', value: (r) => r.summary.median },
        { header: 'P90', value: (r) => r.summary.d90 },
        { header: 'Smallest', value: (r) => r.summary.min },
        { header: 'Largest', value: (r) => r.summary.max },
      ],
    );

  return (
    <section aria-labelledby="dist-shape">
      <h3 id="dist-shape" class="export-title">
        Shape distributions{' '}
        <HelpTip term="shape numbers">
          <p>
            Aspect ratio is the longest over the shortest caliper (Feret) diameter: 1 for a circle,
            larger for elongated particles. Circularity is 4π · area / perimeter², 1 for a perfect
            circle; it uses the same traced perimeter as ImageJ, so a circle drawn in pixels reads
            about 0.9, not 1, and small particles read lower. Solidity is the area over the area of
            the convex hull: below 1 for particles with dents, or for touching particles that were
            not split. Compare these numbers between samples measured the same way rather than
            reading them as exact shapes.
          </p>
        </HelpTip>
      </h3>
      <p class="field-hint">
        Detected particles only; hand measurements have no outline. Counted by number.
      </p>
      {missing.length > 0 && (
        <p class="message is-warning">
          <strong>Check:</strong> {missing.join(', ')} {missing.length === 1 ? 'was' : 'were'} saved
          for pooling before shape numbers were kept, so {missing.length === 1 ? 'it' : 'they'} add
          nothing here. Load {missing.length === 1 ? 'it' : 'them'} again and save to include the
          shapes.
        </p>
      )}
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Shape numbers, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Shape</th>
              <th scope="col">Count</th>
              <th scope="col">Mean</th>
              <th scope="col">SD</th>
              <th scope="col">P10</th>
              <th scope="col">Median</th>
              <th scope="col">P90</th>
            </tr>
          </thead>
          <tbody>
            {SHAPES.map((shape) => {
              const summary = all[shape].summary;
              return (
                <tr key={shape}>
                  <th scope="row">{SHAPE_MEASURE_NAMES[shape]}</th>
                  <td>{summary?.count ?? 0}</td>
                  <td>{summary ? fmt(summary.mean) : '–'}</td>
                  <td>{summary ? fmt(summary.sd) : '–'}</td>
                  <td>{summary ? fmt(summary.d10) : '–'}</td>
                  <td>{summary ? fmt(summary.median) : '–'}</td>
                  <td>{summary ? fmt(summary.d90) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="export-grid">
        <label class="export-field">
          Histogram of{' '}
          <select
            value={s.shape}
            onChange={(e) =>
              update({ distribution: { ...s, shape: e.currentTarget.value as ShapeMeasure } })
            }
          >
            {SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {SHAPE_MEASURE_NAMES[shape]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {chosen.summary ? (
        <HistogramChart
          figure={{
            histogram: hist,
            fit: null,
            cumulative: null,
            xLabel: name,
            yLabel: 'Number of particles',
          }}
          name="shape-histogram"
          label={`${name} histogram`}
          description={`Histogram of the ${name.toLowerCase()} of ${chosen.summary.count} particles`}
          exportName={`${stem}-${s.shape}-histogram`}
          settings={exportSettings}
          onSettings={(patch) => setExportSettings({ ...exportSettings, ...patch })}
        />
      ) : (
        <p class="field-hint">No {name.toLowerCase()} values yet.</p>
      )}
      <p class="field-hint">The bins follow the choice made for the size histogram above.</p>
      <div class="export-actions">
        <button type="button" class="btn" onClick={downloadShapes}>
          Shape summary (CSV)
        </button>
      </div>
    </section>
  );
}
