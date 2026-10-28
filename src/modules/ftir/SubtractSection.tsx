import { useMemo, useState } from 'preact/hooks';
import { subtractionFactor, subtractSpectrum } from '../../core/ftir/bands';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { NumberInput } from '../xrd/NumberInput';
import type { BandContext } from './BandsStep';
import { newId } from './data';
import { FtirPlot, type FtirCurve } from './FtirPlot';

/** Subtracts k × another loaded spectrum (solvent, matrix, support, water vapour) from this one. */
export function SubtractSection({
  data,
  update,
  spectrum,
  processed,
  all,
  settings,
  set,
  select,
}: BandContext) {
  const st = settings.subtract;
  const [status, setStatus] = useState<string | null>(null);
  const others = data.spectra.filter((s) => s.id !== spectrum.id);
  const reference = others.find((s) => s.id === st.referenceId) ?? null;
  const refProcessed = reference ? all[data.spectra.indexOf(reference)] : undefined;
  const difference = useMemo(
    () =>
      refProcessed
        ? subtractSpectrum(
            processed.wavenumber,
            processed.absorbance,
            refProcessed.wavenumber,
            refProcessed.absorbance,
            st.factor,
          )
        : null,
    [processed, refProcessed, st.factor],
  );
  const curves = useMemo((): FtirCurve[] => {
    if (!refProcessed || !reference || !difference) return [];
    return [
      { id: 'sample', name: spectrum.name, ...processed, colorIndex: 0 },
      {
        id: 'reference',
        name: `${formatNumber(st.factor, 4)} × ${reference.name}`,
        wavenumber: refProcessed.wavenumber,
        absorbance: refProcessed.absorbance.map((v) => st.factor * v),
        colorIndex: 1,
        dashed: true,
      },
      { id: 'difference', name: 'Difference', ...difference, colorIndex: 2 },
    ];
  }, [processed, refProcessed, reference, difference, spectrum.name, st.factor]);

  const findFactor = () => {
    if (!refProcessed || st.fromCm === null || st.toCm === null) return;
    const k = subtractionFactor(
      processed.wavenumber,
      processed.absorbance,
      refProcessed.wavenumber,
      refProcessed.absorbance,
      st.fromCm,
      st.toCm,
    );
    if (k === null) {
      setStatus('The reference does not absorb in this range, so no factor could be found.');
      return;
    }
    set({ subtract: { factor: Number(k.toPrecision(6)) } });
    setStatus(`k = ${formatNumber(k, 4)} removes the reference best between these wavenumbers.`);
  };

  const addDifference = () => {
    if (!difference || !reference) return;
    const id = newId();
    const name = `${spectrum.name} − ${formatNumber(st.factor, 4)} × ${reference.name}`;
    update({
      spectra: [
        ...data.spectra,
        {
          id,
          name,
          source: 'computed',
          wavenumber: difference.wavenumber,
          values: difference.absorbance,
          kind: 'absorbance',
          scale: 'percent',
          kindOrigin: 'generated',
          synthetic: spectrum.synthetic || reference.synthetic,
          notes: [
            {
              level: 'info',
              text: `Difference spectrum made here: processed absorbance of "${spectrum.name}" minus ${formatNumber(st.factor, 4)} × processed absorbance of "${reference.name}" (interpolated linearly onto the same wavenumbers). Its processing in step 2 starts switched off, so it is not processed twice.`,
            },
          ],
        },
      ],
    });
    select(id);
    setStatus(`Added "${name}" and selected it. Go back to Pick peaks to pick its peaks.`);
  };

  return (
    <section class="process-step is-on" aria-labelledby="subtract-title">
      <h3 id="subtract-title" class="process-step-title">
        Spectrum subtraction{' '}
        <HelpTip term="spectrum subtraction">
          <p>
            Subtracts a scaled reference from this spectrum: A_difference = A_sample − k ·
            A_reference, with the reference interpolated onto the same wavenumbers. Use it to remove
            a solvent, a matrix (for example KBr or a polymer), a bare support or water vapour.
          </p>
          <p>
            To find k, give a range where only the reference absorbs: k is then the least-squares
            factor that makes the difference there as close to zero as possible. Too large a k gives
            negative bands, too small leaves the reference visible.
          </p>
        </HelpTip>
      </h3>
      {others.length === 0 ? (
        <p class="field-hint">
          Load a second spectrum in step 1 (for example the solvent, the matrix or the bare support)
          to subtract it from this one.
        </p>
      ) : (
        <>
          <div class="radiation-fields">
            <label class="inline-field">
              Reference to subtract
              <select
                value={reference?.id ?? ''}
                onChange={(e) => set({ subtract: { referenceId: e.currentTarget.value || null } })}
              >
                <option value="">None</option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {reference && (
              <NumberInput
                label="Scale factor k"
                value={st.factor}
                onChange={(factor) => factor !== null && set({ subtract: { factor } })}
              />
            )}
          </div>
          {reference && (
            <>
              <div class="radiation-fields">
                <NumberInput
                  label="Reference-only range from (cm⁻¹)"
                  value={st.fromCm}
                  min={0}
                  onChange={(fromCm) => set({ subtract: { fromCm } })}
                />
                <NumberInput
                  label="to (cm⁻¹)"
                  value={st.toCm}
                  min={0}
                  onChange={(toCm) => set({ subtract: { toCm } })}
                />
                <button
                  type="button"
                  class="btn"
                  disabled={st.fromCm === null || st.toCm === null}
                  onClick={findFactor}
                >
                  Find k in this range
                </button>
              </div>
              {status && (
                <p class="field-hint" role="status">
                  {status}
                </p>
              )}
              {difference && difference.wavenumber.length === 0 ? (
                <p class="message is-warning">
                  <strong>Check:</strong> the two spectra share no wavenumbers, so nothing can be
                  subtracted.
                </p>
              ) : (
                <>
                  <FtirPlot
                    curves={curves}
                    quantity="absorbance"
                    settings={data.plot}
                    onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
                    exportName={`${spectrum.name}-subtraction`}
                    showOverlayOptions={false}
                  />
                  <div class="export-actions">
                    <button type="button" class="btn btn-primary" onClick={addDifference}>
                      Add the difference as a new spectrum
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
