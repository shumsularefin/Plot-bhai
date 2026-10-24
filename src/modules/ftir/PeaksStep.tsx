import { useMemo } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { downloadCsv } from '../xrd/csv';
import { peaksOf, processAll } from './analysis';
import { DEFAULT_PEAK_SETTINGS, peaksFor, type FtirData, type PeakSettings } from './data';
import { curveOf, FtirPlot } from './FtirPlot';
import { useSelectedSpectrum } from './useSelected';

/** More peaks than this is probably noise or an over-sensitive threshold. */
const MANY_PEAKS = 60;

/** Wizard step 3: pick the peaks of a spectrum with a prominence threshold. */
export function PeaksStep({ data, update }: StepContext<FtirData>) {
  const { spectrum, select } = useSelectedSpectrum(data.spectra);
  const processed = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const result = spectrum ? processed[data.spectra.indexOf(spectrum)] : undefined;
  const settings = spectrum ? peaksFor(data, spectrum.id) : DEFAULT_PEAK_SETTINGS;
  const peaks = useMemo(() => (result ? peaksOf(result, settings) : []), [result, settings]);
  const labels = useMemo<PeakLabelSet>(
    () => ({
      labels: peaks.map((p) => ({
        x: -p.wavenumber,
        y: p.height,
        text: String(Math.round(p.wavenumber)),
      })),
      key: [],
    }),
    [peaks],
  );
  const curves = useMemo(
    () => (spectrum && result ? [curveOf(spectrum.id, spectrum.name, result)] : []),
    [spectrum, result],
  );

  if (!spectrum || !result) return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  const change = (patch: Partial<PeakSettings>) =>
    update({ peaks: { ...data.peaks, [spectrum.id]: { ...settings, ...patch } } });
  const processing = data.processing[spectrum.id];
  const unprocessed = !processing?.baseline.enabled;

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
        Peaks are picked on the absorbance spectrum from step 2 (after the steps you switched on).
        Positions come from a parabola through the highest point and its two neighbours.
      </p>

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

      <FtirPlot
        curves={curves}
        quantity="absorbance"
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        exportName={`${spectrum.name}-peaks`}
        showOverlayOptions={false}
        peakLabels={labels}
      />

      <section class="peak-table-section" aria-labelledby="peak-table-title">
        <div class="peak-table-header">
          <h3 id="peak-table-title" class="process-step-title">
            Peak table ({peaks.length})
          </h3>
          <button
            type="button"
            class="btn"
            disabled={peaks.length === 0}
            onClick={() =>
              downloadCsv(
                `${spectrum.name}-peaks`,
                `FTIR peaks of ${spectrum.name}, picked on the processed absorbance with a minimum prominence of ${settings.prominencePercent} % of the absorbance range.`,
                peaks,
                [
                  { header: 'Wavenumber (cm-1)', value: (p) => p.wavenumber },
                  { header: 'Absorbance', value: (p) => p.height },
                  { header: 'Relative intensity (%)', value: (p) => p.relative },
                  { header: 'Prominence', value: (p) => p.prominence },
                ],
              )
            }
          >
            Download CSV
          </button>
        </div>
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
                <th scope="col">Absorbance</th>
                <th scope="col">Relative intensity (%)</th>
                <th scope="col">Prominence</th>
              </tr>
            </thead>
            <tbody>
              {[...peaks].reverse().map((p) => (
                <tr key={p.wavenumber}>
                  <th scope="row">{formatNumber(p.wavenumber, 1)}</th>
                  <td>{formatNumber(p.height, 4)}</td>
                  <td>{formatNumber(p.relative, 1)}</td>
                  <td>{formatNumber(p.prominence, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
