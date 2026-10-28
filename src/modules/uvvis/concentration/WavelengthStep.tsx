import { useMemo } from 'preact/hooks';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { absorbanceOf, analyse } from './analysis';
import type { ConcentrationData } from './data';

const num = (v: number | null | undefined, digits = 4) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : formatNumber(v, digits);

/** Step 2: choose the wavelength the absorbance is read at. */
export function WavelengthStep({ data, update }: StepContext<ConcentrationData>) {
  const outcome = useMemo(() => analyse(data), [data]);
  const lambda = outcome.wavelengthNm;
  const withSpectra = data.samples.filter((s) => s.spectrum);
  const sources = useMemo<SeriesSource[]>(
    () =>
      data.samples.flatMap((s, i) => {
        const a = absorbanceOf(s);
        return a && s.spectrum
          ? [{ id: s.id, name: s.name, x: s.spectrum.wavelengthNm, y: a, unit: '', colorIndex: i }]
          : [];
      }),
    [data.samples],
  );
  const half = Math.max(data.halfWidthNm, 0.5);

  return (
    <div class="process-steps">
      {withSpectra.length === 0 ? (
        <p class="message is-info">
          All absorbances were typed, so there is no wavelength to choose. Press Next.
        </p>
      ) : (
        <>
          <p>
            The absorbance of every spectrum is read at one wavelength, usually the maximum of the
            band you follow. It is chosen automatically from the{' '}
            {data.samples.some((s) => s.role === 'timed')
              ? 'first time point'
              : 'strongest standard'}
            ; type another or click the plot to change it.
          </p>
          <div class="run-form">
            <NumberInput
              label="Wavelength (nm)"
              value={lambda}
              min={0}
              onChange={(v) => update({ wavelengthNm: v })}
              help={
                <HelpTip term="analysis wavelength">
                  <p>
                    Usually the absorption maximum (λmax) of the compound, where the absorbance is
                    largest and changes least with small wavelength errors. Use the same wavelength
                    for the standards and the samples.
                  </p>
                </HelpTip>
              }
            />
            {data.wavelengthNm !== null && (
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => update({ wavelengthNm: null })}
              >
                Use the maximum again
              </button>
            )}
            <NumberInput
              label="Average over ± (nm)"
              value={data.halfWidthNm}
              onChange={(v) => update({ halfWidthNm: v !== null && v >= 0 ? v : 0 })}
              help={
                <HelpTip term="averaging window">
                  <p>
                    0 reads the single value at the wavelength (interpolated between points). A few
                    nm averages the points around it, which lowers the effect of noise.
                  </p>
                </HelpTip>
              }
            />
          </div>
          <details>
            <summary>Where the maximum is searched</summary>
            <div class="run-form">
              <NumberInput
                label="From (nm)"
                value={data.searchFromNm}
                min={0}
                onChange={(v) => update({ searchFromNm: v })}
              />
              <NumberInput
                label="To (nm)"
                value={data.searchToNm}
                min={0}
                onChange={(v) => update({ searchToNm: v })}
              />
            </div>
          </details>
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
            labels={() => ({ x: 'Wavelength (nm)', y: 'Absorbance', yValues: true })}
            xName="λ"
            xUnit=" nm"
            exportName="concentration-spectra"
            {...(lambda !== null && {
              bands: [{ fromX: lambda - half, toX: lambda + half, label: `${num(lambda, 1)} nm` }],
            })}
            interaction={{
              onPlotClick: (x) => update({ wavelengthNm: Number(x.toFixed(1)) }),
              hint: 'Click or tap the plot to choose the wavelength.',
            }}
          />
        </>
      )}
      <div class="table-scroll" tabIndex={0} role="region" aria-label="Absorbance of each sample">
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Kind</th>
              <th scope="col">Concentration or time</th>
              <th scope="col">Absorbance</th>
            </tr>
          </thead>
          <tbody>
            {data.samples.map((s) => (
              <tr key={s.id}>
                <th scope="row">{s.name}</th>
                <td>{s.role === 'standard' ? 'Standard' : 'Over time'}</td>
                <td>
                  {num(s.value, 3)} {s.role === 'standard' ? data.unit : 'min'}
                </td>
                <td>
                  {num(outcome.absorbance.get(s.id))}
                  {!s.spectrum && ' (typed)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
