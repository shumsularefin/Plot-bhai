import { RecordSection } from '../../ui/report/RecordSection';
import { ftirRecord } from './record';
import { useMemo, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { detachedAssignments, peakRows, processAll } from './analysis';
import { bandShift, groupBands } from '../../core/ftir/compare';
import { NumberInput } from '../xrd/NumberInput';
import { DEFAULT_COMPARE_SETTINGS, type CompareSettings, type FtirData } from './data';
import { ORIGIN_TEXT, peakColumns } from './peakText';
import { intensityText } from '../../core/ftir/peakShape';
import { REGION_SOURCE, spectralRegions } from './regions';
import { curveOf, FtirPlot, peakLabelsFor } from './FtirPlot';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import { methodsText } from './methodsText';
import { QuantityChoice } from './QuantityChoice';
import { quantityHeading, shownQuantity, valueIn } from './quantity';
import { ftirSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 5;

/** Wizard step 5: peak table with assignments, figure, processed data, methods text and session. */
export function ResultsStep({ data, update }: StepContext<FtirData>) {
  // Highest wavenumber first within each sample, as FTIR tables and the plot axis read.
  const rows = useMemo(
    () =>
      peakRows(data).sort(
        (a, b) =>
          data.spectra.indexOf(a.spectrum) - data.spectra.indexOf(b.spectrum) ||
          b.peak.wavenumber - a.peak.wavenumber,
      ),
    [data],
  );
  const detached = useMemo(() => detachedAssignments(data), [data]);
  const methods = useMemo(() => methodsText(data), [data]);
  const processed = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const curves = useMemo(
    () =>
      data.spectra.flatMap((s, i) => {
        const p = processed[i];
        return p ? [curveOf(s.id, s.name, p, { colorIndex: i })] : [];
      }),
    [data.spectra, processed],
  );
  const [copied, setCopied] = useState<string | null>(null);
  const compare = data.compare ?? DEFAULT_COMPARE_SETTINGS;
  const setCompare = (patch: Partial<CompareSettings>) =>
    update({ compare: { ...compare, ...patch } });
  const reference =
    data.spectra.find((s) => s.id === compare.referenceId) ?? data.spectra[0] ?? null;
  const bands = useMemo(
    () =>
      groupBands(
        rows.map((r) => ({ sample: r.spectrum.id, wavenumber: r.peak.wavenumber, row: r })),
        compare.toleranceCm,
      ).reverse(),
    [rows, compare.toleranceCm],
  );
  const regions = useMemo(() => {
    if (!compare.regions) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of processed) {
      if (p.wavenumber.length === 0) continue;
      lo = Math.min(lo, p.wavenumber[0] as number);
      hi = Math.max(hi, p.wavenumber[p.wavenumber.length - 1] as number);
    }
    return spectralRegions()
      .filter((r) => r.toCm > lo && r.fromCm < hi)
      .map((r) => ({ ...r, fromCm: Math.max(r.fromCm, lo), toCm: Math.min(r.toCm, hi) }));
  }, [compare.regions, processed]);
  const sameGrid = useMemo(() => {
    const first = processed[0]?.wavenumber;
    return (
      !!first &&
      processed.every(
        (p) =>
          p.wavenumber.length === first.length &&
          p.wavenumber.every((v, k) => Math.abs(v - (first[k] as number)) <= 1e-6),
      )
    );
  }, [processed]);
  const shown = shownQuantity(data, data.spectra);
  const quantity = shown.quantity;
  const peakLabels = useMemo((): PeakLabelSet | undefined => {
    if (compare.labels === 'none' || rows.length === 0) return undefined;
    const sets = data.spectra.map((s) => {
      const own = rows.filter(
        (r) => r.spectrum.id === s.id && (compare.labels !== 'assignment' || r.assignment !== ''),
      );
      return peakLabelsFor(
        own.map((r) => r.peak),
        quantity,
        s.id,
        (p, i) => {
          const wn = String(Math.round(p.wavenumber));
          const label = shorten(own[i]?.assignment ?? '');
          return compare.labels === 'wavenumber'
            ? wn
            : compare.labels === 'assignment'
              ? label
              : label
                ? `${wn} ${label}`
                : wn;
        },
      );
    });
    return {
      labels: sets.flatMap((set) => set.labels),
      key: [],
      ...(quantity === 'transmittance' && { below: true }),
    };
  }, [compare.labels, rows, data.spectra, quantity]);
  if (data.spectra.length === 0) return <p>No spectra are loaded. Go back to Upload to add one.</p>;

  const percentT = quantity === 'transmittance';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  return (
    <div class="export-step">
      <section aria-labelledby="peaks-title">
        <h3 id="peaks-title" class="export-title">
          Peaks and assignments{' '}
          <HelpTip term="results table">
            <p>
              Wavenumbers are the positions of the picked peaks, in cm⁻¹. Intensities are absorbance
              after the processing of step 2 (and, when transmittance is shown, the same point as %T
              = 100 · 10^−A). The assignment column holds only what you accepted or typed in step 4;
              the suggestions come from typical ranges and are estimates, not proof of the groups
              present.
            </p>
          </HelpTip>
        </h3>
        <QuantityChoice data={data} update={update} shown={shown} />
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Peak table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Wavenumber (cm⁻¹)</th>
                <th scope="col">Absorbance</th>
                {percentT && <th scope="col">{quantityHeading(quantity)}</th>}
                <th scope="col">Relative (%)</th>
                <th scope="col">FWHM (cm⁻¹)</th>
                <th scope="col">Intensity</th>
                <th scope="col">Origin</th>
                <th scope="col">Assignment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.spectrum.id}-${r.peak.origin}-${r.peak.wavenumber}`}>
                  <th scope="row">{r.spectrum.name}</th>
                  <td>{formatNumber(r.peak.wavenumber, 1)}</td>
                  <td>{formatNumber(r.peak.height, 4)}</td>
                  {percentT && <td>{formatNumber(valueIn(quantity, r.peak.height), 2)}</td>}
                  <td>{formatNumber(r.peak.relative, 1)}</td>
                  <td>
                    {r.peak.shape?.fwhm != null ? formatNumber(r.peak.shape.fwhm, 1) : '–'}
                    {r.peak.overlap && <span title="Overlaps a neighbour"> ⚠</span>}
                  </td>
                  <td>{r.peak.intensity ? intensityText(r.peak.intensity) : '–'}</td>
                  <td>{ORIGIN_TEXT[r.peak.origin]}</td>
                  <td>{r.assignment || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detached.length > 0 && (
          <p class="message is-warning">
            <strong>Check:</strong>{' '}
            {detached.length === 1 ? '1 assignment is' : `${detached.length} assignments are`} not
            attached to a peak with the current settings, so{' '}
            {detached.length === 1 ? 'it is' : 'they are'} not in the table (
            {detached
              .map((d) => `${d.spectrum.name}: ${formatNumber(d.assignment.wavenumber, 1)} cm⁻¹`)
              .join('; ')}
            ). Step 4 lists {detached.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        {rows.length === 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> no peaks were picked. Go back to step 3 and lower the minimum
            prominence.
          </p>
        )}
        <div class="export-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                'ftir-peaks',
                'FTIR peaks picked on the processed absorbance. Assignments were accepted or typed by the user from typical ranges; they are estimates.',
                rows,
                [
                  { header: 'Sample', value: (r) => r.spectrum.name },
                  ...peakColumns(percentT).map((c) => ({
                    header: c.header,
                    value: (r: (typeof rows)[number]) => c.value(r.peak),
                  })),
                  { header: 'Assignment', value: (r) => r.assignment },
                ],
              )
            }
          >
            Download peaks (CSV)
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => {
              const long = data.spectra.flatMap((s, i) => {
                const p = processed[i];
                return p
                  ? Array.from(p.wavenumber, (wn, k) => ({ s, wn, a: p.absorbance[k] as number }))
                  : [];
              });
              downloadCsv(
                'ftir-processed-spectra',
                `FTIR spectra after the processing of step 2. Absorbance is unitless; measured transmittance was converted with A = 2 - log10(%T) before processing.${percentT ? ' Transmittance (%) = 100 x 10^(-A) of the processed absorbance, the quantity shown in the figure.' : ''}`,
                long,
                [
                  { header: 'Sample', value: (r) => r.s.name },
                  { header: 'Wavenumber (cm-1)', value: (r) => r.wn },
                  { header: 'Absorbance (processed)', value: (r) => r.a },
                  ...(percentT
                    ? [
                        {
                          header: 'Transmittance (%) (processed)',
                          value: (r: (typeof long)[number]) => valueIn(quantity, r.a),
                        },
                      ]
                    : []),
                ],
              );
            }}
          >
            Download processed spectra (CSV)
          </button>
          <button
            type="button"
            class="btn"
            disabled={!sameGrid}
            title={sameGrid ? undefined : 'The spectra have different wavenumber points'}
            onClick={() => {
              const grid = processed[0]?.wavenumber ?? new Float64Array();
              const indices = Array.from(grid, (_, k) => k);
              downloadCsv(
                'ftir-processed-spectra-wide',
                `FTIR spectra after the processing of step 2, one column per sample on the shared wavenumber points. ${percentT ? 'Transmittance (%) = 100 x 10^(-A) of the processed absorbance, the quantity shown in the figure.' : 'Absorbance is unitless.'}`,
                indices,
                [
                  { header: 'Wavenumber (cm-1)', value: (k) => grid[k] as number },
                  ...data.spectra.map((s, i) => ({
                    header: `${s.name} ${percentT ? 'transmittance (%)' : 'absorbance'}`,
                    value: (k: number) => {
                      const a = processed[i]?.absorbance[k] as number;
                      return percentT ? valueIn(quantity, a) : a;
                    },
                  })),
                ],
              );
            }}
          >
            Download processed spectra, one column per sample (CSV)
          </button>
        </div>
        {!sameGrid && data.spectra.length > 1 && (
          <p class="field-hint">
            The one-column-per-sample file needs the same wavenumber points in every spectrum; these
            spectra differ, so only the long form (one row per point and sample) is offered.
          </p>
        )}
      </section>

      {data.spectra.length > 1 && (
        <section aria-labelledby="compare-title">
          <h3 id="compare-title" class="export-title">
            Comparison across samples{' '}
            <HelpTip term="band comparison">
              <p>
                Peaks of different samples within the tolerance are treated as the same band (each
                band holds at most one peak per sample and spans at most the tolerance). The default
                of {DEFAULT_COMPARE_SETTINGS.toleranceCm} cm⁻¹ is this site's choice, 2.5 times the
                common 4 cm⁻¹ resolution. A dash means the sample has no peak in that band. The
                shift is the sample's wavenumber minus the reference sample's.
              </p>
            </HelpTip>
          </h3>
          <div class="radiation-fields">
            <NumberInput
              label="Tolerance (cm⁻¹)"
              value={compare.toleranceCm}
              min={0.5}
              onChange={(v) => v !== null && v > 0 && setCompare({ toleranceCm: v })}
            />
            <label class="inline-field">
              Shifts relative to
              <select
                value={reference?.id ?? ''}
                onChange={(e) => setCompare({ referenceId: e.currentTarget.value })}
              >
                {data.spectra.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={compare.relative}
                onChange={(e) => setCompare({ relative: e.currentTarget.checked })}
              />
              Show relative intensity
            </label>
          </div>
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Comparison table, scrolls sideways"
          >
            <table class="peak-table compare-table">
              <thead>
                <tr>
                  <th scope="col">Band (cm⁻¹)</th>
                  {data.spectra.map((s) => (
                    <th key={s.id} scope="col">
                      {s.name}
                    </th>
                  ))}
                  {data.spectra
                    .filter((s) => s.id !== reference?.id)
                    .map((s) => (
                      <th key={s.id} scope="col">
                        Shift {s.name} (cm⁻¹)
                      </th>
                    ))}
                  <th scope="col">Assignment</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((band) => (
                  <tr key={band.wavenumber}>
                    <th scope="row">{formatNumber(band.wavenumber, 1)}</th>
                    {data.spectra.map((s) => {
                      const p = band.peaks.get(s.id);
                      return (
                        <td key={s.id}>
                          {p
                            ? `${formatNumber(p.wavenumber, 1)}${compare.relative ? ` (${formatNumber(p.row.peak.relative, 0)} %)` : ''}`
                            : '–'}
                        </td>
                      );
                    })}
                    {data.spectra
                      .filter((s) => s.id !== reference?.id)
                      .map((s) => {
                        const shift = reference ? bandShift(band, s.id, reference.id) : null;
                        return <td key={s.id}>{shift === null ? '–' : signed(shift)}</td>;
                      })}
                    <td>{bandAssignment(band) || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              disabled={bands.length === 0}
              onClick={() =>
                downloadCsv(
                  'ftir-band-comparison',
                  `FTIR bands compared across samples: peaks within ${compare.toleranceCm} cm-1 are one band (at most one peak per sample). Empty cells: no peak in that band. Shift = sample wavenumber - wavenumber in ${reference?.name ?? 'the reference'}. Relative intensity = absorbance / highest peak of the same sample x 100. Assignments were accepted or typed by the user; they are estimates.`,
                  bands,
                  [
                    { header: 'Band (cm-1)', value: (b) => b.wavenumber },
                    ...data.spectra.flatMap((s) => [
                      {
                        header: `${s.name} (cm-1)`,
                        value: (b: (typeof bands)[number]) => b.peaks.get(s.id)?.wavenumber ?? '',
                      },
                      ...(compare.relative
                        ? [
                            {
                              header: `${s.name} relative intensity (%)`,
                              value: (b: (typeof bands)[number]) =>
                                b.peaks.get(s.id)?.row.peak.relative ?? '',
                            },
                          ]
                        : []),
                    ]),
                    ...data.spectra
                      .filter((s) => s.id !== reference?.id)
                      .map((s) => ({
                        header: `Shift ${s.name} (cm-1)`,
                        value: (b: (typeof bands)[number]) =>
                          (reference ? bandShift(b, s.id, reference.id) : null) ?? '',
                      })),
                    { header: 'Assignment', value: (b) => bandAssignment(b) },
                  ],
                )
              }
            >
              Download comparison (CSV)
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby="figure-title">
        <h3 id="figure-title" class="export-title">
          Figure
        </h3>
        <p class="field-hint">
          All spectra together. Choose Offset or Stack below the plot to separate them; the peak
          wavenumbers picked in step 3 move with their spectrum.
        </p>
        <div class="radiation-fields">
          <label class="inline-field">
            Label peaks with
            <select
              value={compare.labels}
              onChange={(e) =>
                setCompare({ labels: e.currentTarget.value as CompareSettings['labels'] })
              }
            >
              <option value="wavenumber">their wavenumber</option>
              <option value="assignment">their assignment</option>
              <option value="both">wavenumber and assignment</option>
              <option value="none">no labels</option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={compare.regions}
              onChange={(e) => setCompare({ regions: e.currentTarget.checked })}
            />
            Mark the spectral regions
          </label>
        </div>
        {(compare.labels === 'assignment' || compare.labels === 'both') && (
          <p class="field-hint">
            Assignments longer than {LABEL_CHARS} characters are shortened on the figure; click a
            label on the plot to edit its text.
          </p>
        )}
        {regions && (
          <p class="field-hint">
            Regions:{' '}
            {regions.map((r) => `${r.label} = ${r.name}, ${r.fromCm}–${r.toCm} cm⁻¹`).join('; ')}.
            Each is the full span of the matching rows of the group table ({REGION_SOURCE}); they
            are typical ranges, and bands of a real sample may fall outside them.
          </p>
        )}
        <FtirPlot
          curves={curves}
          quantity={quantity}
          settings={data.plot}
          onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
          exportName="ftir-spectra"
          {...(peakLabels && { peakLabels })}
          {...(regions && { regions })}
        />
      </section>

      <section aria-labelledby="methods-title">
        <h3 id="methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Nothing about the spectrometer is included
          because the data files do not say; add it yourself.
        </p>
        <textarea
          class="methods-text"
          readOnly
          rows={9}
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

      <RecordSection build={() => ftirRecord(data)} stem={data.spectra[0]?.name ?? 'ftir'} />

      <SessionSection
        codec={ftirSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={data.spectra[0]?.name ?? 'ftir'}
      />
    </div>
  );
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatNumber(Math.abs(v), 1)}`;

/** The assignments of the peaks in a band, each once. */
function bandAssignment(band: { peaks: Map<string, { row: { assignment: string } }> }): string {
  const labels = new Set<string>();
  for (const p of band.peaks.values()) if (p.row.assignment) labels.add(p.row.assignment);
  return [...labels].join(' / ');
}

/** Longest assignment label drawn in full on the figure; longer ones end in an ellipsis. */
const LABEL_CHARS = 28;
const shorten = (text: string) =>
  text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1).trimEnd()}…` : text;
