import { useMemo } from 'preact/hooks';
import { derivativeBands, secondDerivative } from '../../core/ftir/bands';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import type { BandContext } from './BandsStep';
import { FtirPlot } from './FtirPlot';

const ORDERS = [2, 3, 4, 5];

/** Second derivative (Savitzky–Golay) and the bands it resolves. */
export function DerivativeSection({
  data,
  update,
  spectrum,
  processed,
  settings,
  set,
}: BandContext) {
  const st = settings.derivative;
  const fit = settings.fit;
  const d2 = useMemo(
    () => secondDerivative(processed.wavenumber, processed.absorbance, st.window, st.order),
    [processed, st.window, st.order],
  );
  const bands = useMemo(
    () => (d2 ? derivativeBands(processed.wavenumber, d2, st.depthPercent) : []),
    [processed, d2, st.depthPercent],
  );
  const curves = useMemo(
    () =>
      d2
        ? [
            {
              id: 'd2',
              name: 'Second derivative',
              wavenumber: processed.wavenumber,
              absorbance: d2,
            },
          ]
        : [],
    [processed, d2],
  );
  const inFitRange =
    fit.fromCm !== null && fit.toCm !== null
      ? bands.filter(
          (b) =>
            b.wavenumber >= Math.min(fit.fromCm as number, fit.toCm as number) &&
            b.wavenumber <= Math.max(fit.fromCm as number, fit.toCm as number),
        )
      : [];

  return (
    <section class="process-step is-on" aria-labelledby="derivative-title">
      <h3 id="derivative-title" class="process-step-title">
        Second derivative{' '}
        <HelpTip term="second derivative">
          <p>
            The second derivative d²A/dν̃² turns every band into a sharp minimum, so bands that
            overlap into one peak, or hide as a shoulder, show up separately. It is calculated with
            a Savitzky–Golay filter: a polynomial is fitted to a window of points around each point
            and differentiated. A wider window smooths more but merges close bands.
          </p>
          <p>
            Noise is amplified, so small minima may not be real bands. Use the positions as starting
            values for band fitting, not as proof.
          </p>
        </HelpTip>
      </h3>
      <div class="radiation-fields">
        <NumberInput
          label="Window (points, odd)"
          value={st.window}
          min={4}
          max={201}
          step={2}
          onChange={(v) =>
            v !== null &&
            Math.round(v) % 2 === 1 &&
            Math.round(v) > st.order &&
            set({ derivative: { window: Math.round(v) } })
          }
        />
        <label class="inline-field">
          Polynomial order
          <select
            value={st.order}
            onChange={(e) => set({ derivative: { order: Number(e.currentTarget.value) } })}
          >
            {ORDERS.filter((o) => o < st.window).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <NumberInput
          label="Smallest minimum kept (% of the deepest)"
          value={st.depthPercent}
          min={0}
          max={100}
          onChange={(v) => v !== null && set({ derivative: { depthPercent: v } })}
        />
      </div>
      {!d2 ? (
        <p class="message is-warning">
          <strong>Check:</strong> the second derivative needs evenly spaced wavenumbers (steps equal
          to within 1 %) and at least as many points as the window. Use a smaller window, or a
          spectrum recorded on an even grid.
        </p>
      ) : (
        <>
          <FtirPlot
            curves={curves}
            quantity="absorbance"
            settings={data.plot}
            onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
            exportName={`${spectrum.name}-second-derivative`}
            showOverlayOptions={false}
            yLabel="d²A/dν̃² (cm²)"
          />
          <p class="field-hint">
            {bands.length} minima found (bands point down).{' '}
            {bands.length > 0 &&
              `At ${bands
                .slice()
                .reverse()
                .map((b) => formatNumber(b.wavenumber, 1))
                .join(', ')} cm⁻¹.`}
          </p>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              disabled={inFitRange.length === 0}
              title={
                fit.fromCm === null || fit.toCm === null
                  ? 'Set the fit range below first.'
                  : undefined
              }
              onClick={() => {
                set({
                  derivative: { used: true },
                  fit: {
                    centres: inFitRange.map((b) => Number(b.wavenumber.toFixed(1))),
                    result: null,
                  },
                });
              }}
            >
              Use the minima in the fit range as starting bands
            </button>
            <button
              type="button"
              class="btn"
              disabled={bands.length === 0}
              onClick={() =>
                downloadCsv(
                  `${spectrum.name}-second-derivative`,
                  `Second derivative of the processed absorbance of ${spectrum.name}, Savitzky-Golay, ${st.window}-point window, polynomial order ${st.order}. Minima deeper than ${st.depthPercent} % of the deepest.`,
                  bands,
                  [
                    { header: 'Wavenumber (cm-1)', value: (b) => b.wavenumber },
                    { header: 'd2A/dv2 (cm2)', value: (b) => b.value },
                  ],
                )
              }
            >
              Minima (CSV)
            </button>
          </div>
        </>
      )}
    </section>
  );
}
