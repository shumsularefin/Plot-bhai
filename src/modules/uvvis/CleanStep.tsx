import { useMemo, useRef, useState } from 'preact/hooks';
import {
  availableQuantities,
  cleanSpectrum,
  DEFAULT_CLEANING,
  DISPLAY_LABELS,
  lambdaMax,
  type CleaningSettings,
  type CleaningStep as StepName,
  type DisplayQuantity,
} from '../../core/uvvis/process';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { cleaningFor, type UvvisData, type ViewSettings } from './data';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import { StepSection } from '../xrd/StepSection';
import { UvvisPlot } from './UvvisPlot';
import { shownCurves } from './view';

type Mode = 'selected' | 'all';
const UNDO_LIMIT = 50;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Wizard step 2: choose how each spectrum is shown, then optional, reversible cleaning. */
export function CleanStep({ data, update }: StepContext<UvvisData>) {
  const spectra = data.spectra;
  const [selectedId, setSelectedId] = useState(spectra[0]?.id);
  const [mode, setMode] = useState<Mode>('selected');
  const spectrum = spectra.find((s) => s.id === selectedId) ?? spectra[0];
  const history = useRef<Record<string, CleaningSettings>[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const { cleaning } = data;
  const cleaned = useMemo(
    () =>
      spectra.map((s) => {
        const settings = cleaningFor({ cleaning }, s.id);
        const blank = settings.blank.blankId
          ? spectra.find((b) => b.id === settings.blank.blankId && b.id !== s.id)
          : undefined;
        return cleanSpectrum(s, settings, blank);
      }),
    [spectra, cleaning],
  );
  const view = data.view;
  const index = spectrum ? spectra.indexOf(spectrum) : -1;
  const selectedCleaned = cleaned[index];

  const shown = useMemo(() => {
    if (mode === 'selected' && spectrum && selectedCleaned) {
      return shownCurves(
        [
          {
            spectrum,
            id: `${spectrum.id}-before`,
            name: `${spectrum.name} (before)`,
            wavelengthNm: spectrum.wavelengthNm,
            values: spectrum.values,
            colorIndex: 1,
            dashed: true,
          },
          {
            spectrum,
            id: spectrum.id,
            name: `${spectrum.name} (after)`,
            wavelengthNm: selectedCleaned.wavelengthNm,
            values: selectedCleaned.values,
            colorIndex: 0,
          },
        ],
        view,
      );
    }
    return shownCurves(
      spectra.map((s, i) => ({
        spectrum: s,
        id: s.id,
        name: s.name,
        wavelengthNm: (cleaned[i] ?? s).wavelengthNm,
        values: (cleaned[i] ?? s).values,
        colorIndex: i,
      })),
      view,
    );
  }, [mode, spectrum, selectedCleaned, spectra, cleaned, view]);

  const peaks = useMemo(
    () =>
      spectra.map((s, i) => {
        const c = cleaned[i];
        return {
          spectrum: s,
          max: c
            ? lambdaMax(
                c.wavelengthNm,
                c.values,
                s,
                data.lambdaRange.fromNm ?? -Infinity,
                data.lambdaRange.toNm ?? Infinity,
              )
            : null,
        };
      }),
    [spectra, cleaned, data.lambdaRange],
  );

  if (!spectrum || !selectedCleaned) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  }
  const settings = cleaningFor(data, spectrum.id);

  const remember = () => {
    history.current = [...history.current, data.cleaning].slice(-UNDO_LIMIT);
    setCanUndo(true);
  };
  const setSettings = (next: CleaningSettings) => {
    remember();
    update({ cleaning: { ...data.cleaning, [spectrum.id]: next } });
  };
  const patch = <K extends StepName>(step: K, value: Partial<CleaningSettings[K]>) =>
    setSettings({ ...settings, [step]: { ...settings[step], ...value } });
  const resetStep = (step: StepName) => patch(step, DEFAULT_CLEANING[step]);
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ cleaning: last });
  };
  const applyToAll = () => {
    remember();
    const cleaning = { ...data.cleaning };
    for (const s of spectra) {
      if (s.id === spectrum.id) continue;
      // A blank belongs to the measurement it was recorded with, so it is not copied.
      cleaning[s.id] = { ...settings, blank: cleaningFor(data, s.id).blank };
    }
    update({ cleaning });
  };
  const setView = (value: Partial<ViewSettings>) => update({ view: { ...view, ...value } });

  const blanks = spectra.filter((s) => s.id !== spectrum.id && s.kind === spectrum.kind);
  const quantities: DisplayQuantity[] = [
    ...new Set(spectra.flatMap((s) => availableQuantities(s.kind))),
  ];
  const message = (step: StepName) => selectedCleaned.messages[step];
  const rangeHint =
    data.lambdaRange.fromNm !== null || data.lambdaRange.toNm !== null
      ? ''
      : ' Detector noise at the very ends of a scan can look like a maximum, so narrow the range if needed.';

  return (
    <div class="clean-step">
      <div class="clean-toolbar">
        {spectra.length > 1 && (
          <label class="inline-field">
            Spectrum
            <select value={spectrum.id} onChange={(e) => setSelectedId(e.currentTarget.value)}>
              {spectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div class="clean-actions">
          <button type="button" class="btn" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => setSettings(DEFAULT_CLEANING)}
            disabled={same(settings, DEFAULT_CLEANING)}
          >
            Reset all steps
          </button>
          {spectra.length > 1 && (
            <button type="button" class="btn" onClick={applyToAll}>
              Use these settings for all spectra
            </button>
          )}
        </div>
      </div>
      <p class="field-hint">
        Every step is optional and can be switched off again at any time. Your original data are
        never changed. Check the data type of each spectrum in step 1 first; the steps below depend
        on it.
      </p>

      <section class="process-step" aria-labelledby="view-title">
        <h3 id="view-title" class="process-step-title">
          How to show the spectra{' '}
          <HelpTip term="Kubelka–Munk function">
            <p>
              Showing a spectrum as another quantity does not change your data. Absorbance and
              transmittance convert into each other: A = 2 − log₁₀(%T). For diffuse reflectance R of
              a powder, the Kubelka–Munk function F(R) = (1 − R)² / (2R) (R as a fraction) is used
              in place of absorbance. Photon energy is E = hc/λ, about 1239.84 eV·nm divided by the
              wavelength in nm.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Show as
            <select
              value={view.quantity}
              onChange={(e) =>
                setView({ quantity: e.currentTarget.value as ViewSettings['quantity'] })
              }
            >
              <option value="measured">As measured</option>
              {quantities.map((q) => (
                <option key={q} value={q}>
                  {DISPLAY_LABELS[q]}
                </option>
              ))}
            </select>
          </label>
          <fieldset class="segmented">
            <legend>Horizontal axis</legend>
            {(['nm', 'ev'] as const).map((unit) => (
              <label key={unit} class={view.xUnit === unit ? 'is-selected' : undefined}>
                <input
                  type="radio"
                  name="uvvis-x-unit"
                  checked={view.xUnit === unit}
                  onChange={() => setView({ xUnit: unit })}
                />
                {unit === 'nm' ? 'Wavelength (nm)' : 'Photon energy (eV)'}
              </label>
            ))}
          </fieldset>
          <fieldset class="segmented">
            <legend>Plot</legend>
            {(['selected', 'all'] as const).map((value) => (
              <label key={value} class={mode === value ? 'is-selected' : undefined}>
                <input
                  type="radio"
                  name="uvvis-plot-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {value === 'selected' ? 'This spectrum, before and after' : 'All spectra, after'}
              </label>
            ))}
          </fieldset>
        </div>
        {shown.excluded.length > 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> {shown.excluded.join(', ')} cannot be shown this way (for
            example, a Kubelka–Munk view needs reflectance) and{' '}
            {shown.excluded.length === 1 ? 'is' : 'are'} left out of the plot.
          </p>
        )}
        {view.quantity === 'measured' && shown.quantity === null && shown.curves.length > 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> the plotted spectra are different data types, so the vertical
            axis is not one quantity. Choose a view in "Show as" to compare them.
          </p>
        )}
      </section>

      <StepSection
        id="blank"
        title="Blank subtraction"
        description="Removes the signal of the solvent, substrate or reference measured without your sample. The blank must be another loaded spectrum of the same data type. For absorbance it is subtracted; for transmittance and reflectance the sample is divided by the blank, which is the same as subtracting absorbances."
        enabled={settings.blank.enabled}
        onToggle={(enabled) => patch('blank', { enabled })}
        onReset={() => resetStep('blank')}
        messages={message('blank')}
        unavailable={
          blanks.length === 0
            ? 'Load a blank as another spectrum of the same data type to use this step.'
            : undefined
        }
      >
        <label class="inline-field">
          Blank spectrum
          <select
            value={settings.blank.blankId ?? ''}
            onChange={(e) => patch('blank', { blankId: e.currentTarget.value || null })}
          >
            <option value="">Choose…</option>
            {blanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </StepSection>

      <StepSection
        id="offset"
        title="Baseline offset"
        description="Shifts the whole spectrum so that a wavelength window where your sample should not absorb sits at zero absorbance (or 100 % transmittance or reflectance). Typical for scattering or drift, for example 800 to 900 nm for a sample that is clear in the near infrared."
        enabled={settings.offset.enabled}
        onToggle={(enabled) => patch('offset', { enabled })}
        onReset={() => resetStep('offset')}
        messages={message('offset')}
      >
        <NumberInput
          label="From (nm)"
          value={settings.offset.fromNm}
          min={0}
          onChange={(v) => v !== null && patch('offset', { fromNm: v })}
        />
        <NumberInput
          label="To (nm)"
          value={settings.offset.toNm}
          min={0}
          onChange={(v) => v !== null && patch('offset', { toNm: v })}
        />
      </StepSection>

      <StepSection
        id="smoothing"
        title="Smoothing"
        description="Savitzky–Golay smoothing fits a small polynomial through each group of neighbouring points. It reduces noise while keeping the shape of the absorption edge much better than a simple moving average. Use the smallest window that makes the noise acceptable."
        enabled={settings.smoothing.enabled}
        onToggle={(enabled) => patch('smoothing', { enabled })}
        onReset={() => resetStep('smoothing')}
        messages={message('smoothing')}
      >
        <label class="inline-field">
          Window (points)
          <input
            type="number"
            inputMode="numeric"
            min={5}
            max={101}
            step={2}
            value={settings.smoothing.window}
            onChange={(e) => {
              const raw = Math.round(Number(e.currentTarget.value));
              const window = Math.min(101, Math.max(5, raw % 2 === 0 ? raw + 1 : raw));
              patch('smoothing', { window, order: Math.min(settings.smoothing.order, window - 2) });
            }}
          />
        </label>
        <label class="inline-field">
          Polynomial order
          <select
            value={settings.smoothing.order}
            onChange={(e) => patch('smoothing', { order: Number(e.currentTarget.value) })}
          >
            {[2, 3, 4, 5]
              .filter((o) => o < settings.smoothing.window)
              .map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
          </select>
        </label>
      </StepSection>

      {shown.curves.length > 0 && (
        <UvvisPlot
          curves={shown.curves}
          view={view}
          quantity={shown.quantity}
          settings={data.plot}
          onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
          exportName={mode === 'selected' ? spectrum.name : 'uvvis-spectra'}
        />
      )}

      <section class="peak-table-section" aria-labelledby="lambda-title">
        <div class="peak-table-header">
          <h3 id="lambda-title" class="process-step-title">
            Absorption maximum (λ<sub>max</sub>){' '}
            <HelpTip term="lambda max">
              <p>
                λmax is the wavelength where the absorbance is highest. For transmittance it is
                found after converting to absorbance, and for reflectance on the Kubelka–Munk
                function F(R). The result is the wavelength of the highest data point, so it can
                only be as precise as the wavelength step.
              </p>
            </HelpTip>
          </h3>
          <button
            type="button"
            class="btn"
            onClick={() =>
              downloadCsv(
                'uvvis-lambda-max',
                `UV-Vis absorption maximum per spectrum, after cleaning. Search range ${data.lambdaRange.fromNm ?? 'start'} to ${data.lambdaRange.toNm ?? 'end'} nm. Resolution is the wavelength step.`,
                peaks,
                [
                  { header: 'Spectrum', value: (r) => r.spectrum.name },
                  { header: 'Data type', value: (r) => r.spectrum.kind },
                  { header: 'lambda_max (nm)', value: (r) => r.max?.wavelengthNm ?? '' },
                  { header: 'Value', value: (r) => r.max?.value ?? '' },
                  {
                    header: 'Quantity',
                    value: (r) => (r.max ? DISPLAY_LABELS[r.max.quantity] : ''),
                  },
                ],
              )
            }
          >
            Download CSV
          </button>
        </div>
        <div class="radiation-fields">
          <NumberInput
            label="Search from (nm)"
            value={data.lambdaRange.fromNm}
            min={0}
            onChange={(fromNm) => update({ lambdaRange: { ...data.lambdaRange, fromNm } })}
          />
          <NumberInput
            label="to (nm)"
            value={data.lambdaRange.toNm}
            min={0}
            onChange={(toNm) => update({ lambdaRange: { ...data.lambdaRange, toNm } })}
          />
        </div>
        <p class="field-hint">
          Leave a box empty to search from the start or to the end.{rangeHint}
        </p>
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Absorption maximum table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Spectrum</th>
                <th scope="col">λmax (nm)</th>
                <th scope="col">Value</th>
                <th scope="col">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {peaks.map(({ spectrum: s, max }) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>{max ? formatNumber(max.wavelengthNm, 2) : '–'}</td>
                  <td>{max ? formatNumber(max.value, 4) : '–'}</td>
                  <td>{max ? DISPLAY_LABELS[max.quantity] : 'No points in range'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
