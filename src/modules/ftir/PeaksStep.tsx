import { useMemo, useState } from 'preact/hooks';
import { derivativeBands, secondDerivative } from '../../core/ftir/bands';
import { BROAD_CM, intensityText, MEDIUM_PERCENT, STRONG_PERCENT } from '../../core/ftir/peakShape';
import { ORIGIN_TEXT, peakColumns, peakCsvNote } from './peakText';
import { nearestMaximum } from '../../core/ftir/peaks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PlotInteraction } from '../../ui/plot/PlotPanel';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { downloadCsv } from '../xrd/csv';
import { peaksOf, processAll, SNAP_CM, type TablePeak } from './analysis';
import {
  bandsFor,
  DEFAULT_PEAK_SETTINGS,
  newId,
  NO_PEAK_EDITS,
  peakEditsFor,
  peaksFor,
  type FtirData,
  type PeakEdits,
  type PeakSettings,
} from './data';
import { curveOf, FtirPlot, peakLabelsFor } from './FtirPlot';
import { QuantityChoice } from './QuantityChoice';
import { quantityHeading, shownQuantity, valueIn } from './quantity';
import { useSelectedSpectrum } from './useSelected';

/** More peaks than this is probably noise or an over-sensitive threshold. */
const MANY_PEAKS = 60;

type Mode = 'view' | 'add' | 'remove';
const MODE_LABELS: Record<Mode, string> = {
  view: 'Zoom and pan',
  add: 'Add peaks',
  remove: 'Remove peaks',
};
const MODE_HINTS: Record<Mode, string | undefined> = {
  view: undefined,
  add: 'Click or tap the plot where a peak should be added.',
  remove: 'Click or tap the marker of a peak to remove it.',
};

const dash = (v: number | null | undefined, digits: number) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : formatNumber(v, digits);

/** Wizard step 3: pick the peaks of a spectrum with a prominence threshold, and edit them by hand. */
export function PeaksStep({ data, update }: StepContext<FtirData>) {
  const { spectrum, select } = useSelectedSpectrum(data.spectra);
  const [mode, setMode] = useState<Mode>('view');
  const [typed, setTyped] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const processed = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const result = spectrum ? processed[data.spectra.indexOf(spectrum)] : undefined;
  const settings = spectrum ? peaksFor(data, spectrum.id) : DEFAULT_PEAK_SETTINGS;
  const edits = spectrum ? peakEditsFor(data, spectrum.id) : NO_PEAK_EDITS;
  const peaks = useMemo(
    () => (result ? peaksOf(result, settings, edits) : []),
    [result, settings, edits],
  );
  const derivative = spectrum ? bandsFor(data, spectrum.id).derivative : null;
  // Second-derivative minima with no peak near them: candidate shoulders.
  const shoulders = useMemo(() => {
    if (!result || !derivative) return [];
    const d2 = secondDerivative(
      result.wavenumber,
      result.absorbance,
      derivative.window,
      derivative.order,
    );
    if (!d2) return [];
    return derivativeBands(
      result.wavenumber,
      d2,
      derivative.depthPercent,
      settings.fromCm ?? undefined,
      settings.toCm ?? undefined,
    )
      .map((b) => b.wavenumber)
      .filter((cm) => !peaks.some((p) => Math.abs(p.wavenumber - cm) <= SNAP_CM));
  }, [result, derivative, settings, peaks]);
  const shown = shownQuantity(data, spectrum ? [spectrum] : []);
  const quantity = shown.quantity;
  const labels = useMemo(() => peakLabelsFor(peaks, quantity), [peaks, quantity]);
  const curves = useMemo(
    () => (spectrum && result ? [curveOf(spectrum.id, spectrum.name, result)] : []),
    [spectrum, result],
  );

  if (!spectrum || !result) return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  const change = (patch: Partial<PeakSettings>) =>
    update({ peaks: { ...data.peaks, [spectrum.id]: { ...settings, ...patch } } });
  const setEdits = (next: PeakEdits) =>
    update({ peakEdits: { ...data.peakEdits, [spectrum.id]: next } });
  const processing = data.processing[spectrum.id];
  const unprocessed = !processing?.baseline.enabled;
  const edited = edits.added.length + edits.removed.length > 0;

  /** Adds a peak at the nearest maximum within SNAP_CM of cm, or at cm itself. */
  const addAt = (cm: number, shoulder = false) => {
    const x = result.wavenumber;
    const lo = x[0] as number;
    const hi = x[x.length - 1] as number;
    if (!(cm >= lo && cm <= hi)) {
      setNote(`${formatNumber(cm, 1)} cm⁻¹ is outside the spectrum.`);
      return;
    }
    const at = shoulder ? cm : (nearestMaximum(x, result.absorbance, cm, SNAP_CM) ?? cm);
    const existing = peaks.find((p) => Math.abs(p.wavenumber - at) <= SNAP_CM / 2);
    if (existing) {
      setNote(`There is already a peak at ${formatNumber(existing.wavenumber, 1)} cm⁻¹.`);
      return;
    }
    setNote(`Peak added at ${formatNumber(at, 1)} cm⁻¹.`);
    setEdits({ ...edits, added: [...edits.added, { id: newId(), wavenumber: at, shoulder }] });
  };
  const remove = (peak: TablePeak) => {
    setNote(`Peak at ${formatNumber(peak.wavenumber, 1)} cm⁻¹ removed.`);
    if (peak.handId !== undefined) {
      setEdits({ ...edits, added: edits.added.filter((a) => a.id !== peak.handId) });
    } else {
      setEdits({ ...edits, removed: [...edits.removed, peak.wavenumber] });
    }
  };

  const interaction: PlotInteraction = {
    markers: peaks.map((p) => ({ x: -p.wavenumber, y: valueIn(quantity, p.height) })),
  };
  const hint = MODE_HINTS[mode];
  if (hint) interaction.hint = hint;
  if (mode === 'add') interaction.onPlotClick = (px) => addAt(-px);
  if (mode === 'remove')
    interaction.onMarkerClick = (i) => {
      const peak = peaks[i];
      if (peak) remove(peak);
    };
  const flagged = peaks.filter((p) => p.overlap).length;

  return (
    <div class="clean-step">
      {data.spectra.length > 1 && (
        <div class="clean-toolbar">
          <label class="inline-field">
            Spectrum
            <select value={spectrum.id} onChange={(e) => select(e.currentTarget.value)}>
              {data.spectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p class="field-hint">
        Peaks are picked on the absorbance spectrum from step 2 (after the steps you switched on),
        where bands are maxima; in transmittance the same bands are minima. Positions come from a
        parabola through the highest point and its two neighbours.
      </p>
      <QuantityChoice data={data} update={update} shown={shown} />

      <section class="process-step is-on" aria-labelledby="prom-title">
        <h3 id="prom-title" class="process-step-title">
          Peak picking{' '}
          <HelpTip term="prominence">
            <p>
              Prominence is how far a peak stands above the higher of the two valleys beside it. A
              noise spike has a small prominence; a real band a large one. The slider sets the
              smallest prominence kept, as a percentage of the difference between the highest and
              lowest absorbance.
            </p>
          </HelpTip>
        </h3>
        <label class="slider-field">
          Minimum prominence: <strong>{settings.prominencePercent} %</strong>
          <input
            type="range"
            min={0.5}
            max={50}
            step={0.5}
            value={settings.prominencePercent}
            onInput={(e) => change({ prominencePercent: Number(e.currentTarget.value) })}
          />
        </label>
        <div class="radiation-fields">
          <NumberInput
            label="Search from (cm⁻¹)"
            value={settings.fromCm}
            min={0}
            onChange={(fromCm) => change({ fromCm })}
          />
          <NumberInput
            label="to (cm⁻¹)"
            value={settings.toCm}
            min={0}
            onChange={(toCm) => change({ toCm })}
          />
        </div>
        <p class="field-hint">
          Leave a range box empty to search from the end or to the end of the spectrum.
        </p>
        {peaks.length === 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> no peaks were found. Lower the minimum prominence or widen the
            search range.
          </p>
        )}
        {peaks.length > MANY_PEAKS && (
          <p class="message is-warning">
            <strong>Check:</strong> {peaks.length} peaks is a lot, so many may be noise. Raise the
            minimum prominence or switch smoothing on in step 2.
          </p>
        )}
        {unprocessed && peaks.length > 0 && (
          <p class="field-hint">
            Baseline correction is off. A sloping baseline makes the heights and relative
            intensities below depend on where the band sits.
          </p>
        )}
      </section>

      <section class="process-step is-on" aria-labelledby="edit-title">
        <h3 id="edit-title" class="process-step-title">
          Edit peaks by hand{' '}
          <HelpTip term="editing peaks">
            <p>
              Add a peak the threshold missed, or remove one that is noise. A click within {SNAP_CM}{' '}
              cm⁻¹ of a local maximum adds the peak at the maximum; further away it adds it exactly
              where you clicked, for a shoulder. Edits are kept by position, so they stay when you
              change the processing, and Undo in the bar above takes them back.
            </p>
          </HelpTip>
        </h3>
        <fieldset class="segmented">
          <legend>On the plot</legend>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <label key={m} class={mode === m ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="ftir-peak-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </fieldset>
        <div class="radiation-fields">
          <NumberInput label="Add a peak at (cm⁻¹)" value={typed} min={0} onChange={setTyped} />
          <button
            type="button"
            class="btn"
            disabled={typed === null}
            onClick={() => typed !== null && addAt(typed)}
          >
            Add peak
          </button>
          <button
            type="button"
            class="btn"
            disabled={!edited}
            onClick={() => {
              setEdits(NO_PEAK_EDITS);
              setNote('Hand edits reset.');
            }}
          >
            Reset hand edits
          </button>
        </div>
        <p class="export-status" role="status">
          {note}
        </p>
        {shoulders.length > 0 && (
          <div class="shoulder-suggestions">
            <p class="field-hint">
              Possible shoulders: minima of the second derivative (window {derivative?.window}{' '}
              points, order {derivative?.order}, set in the Bands step) with no peak within{' '}
              {SNAP_CM} cm⁻¹. They are suggestions: a shoulder can also come from noise, so accept
              only those you can see on the spectrum.
            </p>
            <ul class="chip-row">
              {[...shoulders].reverse().map((cm) => (
                <li key={cm}>
                  <button type="button" class="btn btn-quiet" onClick={() => addAt(cm, true)}>
                    Accept shoulder at {formatNumber(cm, 1)} cm⁻¹
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <FtirPlot
        curves={curves}
        quantity={quantity}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        absorbanceName={shown.name}
        edited={result.edited}
        exportName={`${spectrum.name}-peaks`}
        showOverlayOptions={false}
        peakLabels={labels}
        interaction={interaction}
      />

      <section class="peak-table-section" aria-labelledby="peak-table-title">
        <div class="peak-table-header">
          <h3 id="peak-table-title" class="process-step-title">
            Peak table ({peaks.length}){' '}
            <HelpTip term="peak table columns">
              <p>
                Height, width (FWHM) and area are measured above a local baseline: a straight line
                through the lowest point on each side, between the peak and its neighbour. Width is
                the full width where the band falls to half its height above that line; area is the
                integrated absorbance above it (absorbance · cm⁻¹).
              </p>
              <p>
                Intensity classes are this site's own thresholds, as IR tables use strong, medium
                and weak without numeric limits: strong when the height above the local baseline is
                at least {STRONG_PERCENT} % of the highest band, medium from {MEDIUM_PERCENT} %,
                weak below; broad when the width is at least {BROAD_CM} cm⁻¹.
              </p>
            </HelpTip>
          </h3>
          <button
            type="button"
            class="btn"
            disabled={peaks.length === 0}
            onClick={() =>
              downloadCsv(
                `${spectrum.name}-peaks`,
                peakCsvNote(
                  settings.prominencePercent,
                  quantity === 'transmittance',
                  shown.csvName,
                ),
                peaks,
                peakColumns(quantity === 'transmittance', shown.csvName),
              )
            }
          >
            Download CSV
          </button>
        </div>
        {flagged > 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> width and area of the {flagged} flagged{' '}
            {flagged === 1 ? 'peak are' : 'peaks are'} unreliable, because the band overlaps a
            neighbour or a shoulder. Fit the overlapping bands in the Bands step to separate them.
          </p>
        )}
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Peak table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Wavenumber (cm⁻¹)</th>
                <th scope="col">{shown.name}</th>
                {quantity === 'transmittance' && <th scope="col">{quantityHeading(quantity)}</th>}
                <th scope="col">Relative intensity (%)</th>
                <th scope="col">Prominence</th>
                <th scope="col">FWHM (cm⁻¹)</th>
                <th scope="col">Area ({shown.name === 'Absorbance' ? 'A' : shown.name}·cm⁻¹)</th>
                <th scope="col">Intensity</th>
                <th scope="col">Origin</th>
                <th scope="col">
                  <span class="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...peaks].reverse().map((p) => (
                <tr key={`${p.origin}-${p.handId ?? p.wavenumber}`}>
                  <th scope="row">{formatNumber(p.wavenumber, 1)}</th>
                  <td>{formatNumber(p.height, 4)}</td>
                  {quantity === 'transmittance' && (
                    <td>{formatNumber(valueIn(quantity, p.height), 2)}</td>
                  )}
                  <td>{formatNumber(p.relative, 1)}</td>
                  <td>{formatNumber(p.prominence, 4)}</td>
                  <td>
                    {dash(p.shape?.fwhm, 1)}
                    {p.overlap && <span title="Overlaps a neighbour"> ⚠</span>}
                  </td>
                  <td>{dash(p.shape?.area, 3)}</td>
                  <td>{p.intensity ? intensityText(p.intensity) : '–'}</td>
                  <td>{ORIGIN_TEXT[p.origin]}</td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-quiet"
                      aria-label={`Remove peak at ${formatNumber(p.wavenumber, 1)} cm⁻¹`}
                      onClick={() => remove(p)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {flagged > 0 && (
          <p class="field-hint">⚠ overlaps a neighbour: width and area unreliable.</p>
        )}
      </section>
    </div>
  );
}
