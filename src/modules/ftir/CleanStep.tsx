import { useMemo, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_FTIR_PROCESSING,
  type BaselineMethod,
  type FtirProcessing,
  type FtirStep,
  type NormaliseMethod,
  type ReflectanceTransform,
  DEFAULT_CO2_RANGE,
  toAbsorbance,
} from '../../core/ftir/process';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { StepSection } from '../xrd/StepSection';
import { processAll } from './analysis';
import { processingFor, type FtirData } from './data';
import { curveOf, FtirPlot, type FtirCurve } from './FtirPlot';
import { REFLECTANCE_TEXT } from './FtirSpectrumCard';
import { QuantityChoice } from './QuantityChoice';
import { shownQuantity } from './quantity';

type View = 'after' | 'before' | 'both' | 'all';
const VIEW_LABELS: Record<View, string> = {
  after: 'After',
  before: 'Before',
  both: 'Before and after',
  all: 'All spectra, after',
};
const BASELINE_LABELS: Record<BaselineMethod, string> = {
  arpls: 'arPLS (automatic, recommended)',
  'rubber-band': 'Rubber band (automatic)',
  polynomial: 'Iterative polynomial (automatic)',
  als: 'Asymmetric least squares (automatic)',
};
const NORMALISE_LABELS: Record<NormaliseMethod, string> = {
  max: 'Divide by the highest absorbance',
  minmax: 'Lowest to 0, highest to 1',
  band: 'Divide by the height or area of a chosen band',
};
const REFLECTANCE_LABELS: Record<ReflectanceTransform, string> = {
  'kubelka-munk': 'Kubelka–Munk F(R) = (1 − R)²/(2R) (recommended for diffuse reflectance)',
  'log-inverse': 'log₁₀(1/R), apparent absorbance',
};
const FINGERPRINT: readonly [number, number] = [1500, 400];
const UNDO_LIMIT = 50;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Wizard step 2: how the spectra are shown, then optional, reversible processing. */
export function CleanStep({ data, update }: StepContext<FtirData>) {
  const spectra = data.spectra;
  const [selectedId, setSelectedId] = useState(spectra[0]?.id);
  const [view, setView] = useState<View>('both');
  const [focus, setFocus] = useState<readonly [number, number] | null>(null);
  const history = useRef<Record<string, FtirProcessing>[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const spectrum = spectra.find((s) => s.id === selectedId) ?? spectra[0];
  const { processing } = data;
  const processed = useMemo(() => processAll(spectra, processing), [spectra, processing]);
  const index = spectrum ? spectra.indexOf(spectrum) : -1;
  const result = processed[index];
  const settings = spectrum ? processingFor(data, spectrum.id) : DEFAULT_FTIR_PROCESSING;
  const normalised = settings.normalise.enabled;
  const shown = shownQuantity(data, view === 'all' ? spectra : spectrum ? [spectrum] : []);
  const quantity = shown.quantity;

  const curves = useMemo<FtirCurve[]>(() => {
    if (!spectrum || !result) return [];
    if (view === 'all') {
      return spectra.flatMap((s, i) => {
        const p = processed[i];
        return p ? [curveOf(s.id, s.name, p, { colorIndex: i })] : [];
      });
    }
    const before = {
      wavenumber: spectrum.wavenumber,
      absorbance: toAbsorbance(
        spectrum.values,
        spectrum.kind,
        spectrum.scale,
        settings.reflectance,
      ),
    };
    const list: FtirCurve[] = [];
    if (view !== 'after') {
      list.push(
        curveOf(`${spectrum.id}-before`, `${spectrum.name} (before)`, before, {
          colorIndex: 1,
          dashed: view === 'both',
        }),
      );
    }
    if (view !== 'before') {
      list.push(curveOf(spectrum.id, `${spectrum.name} (after)`, result, { colorIndex: 0 }));
    }
    if (result.baseline && view !== 'after') {
      list.push(
        curveOf(
          `${spectrum.id}-baseline`,
          'Baseline',
          { wavenumber: result.wavenumber, absorbance: result.baseline },
          { colorIndex: 2, dashed: true },
        ),
      );
    }
    return list;
  }, [view, spectrum, result, spectra, processed, settings.reflectance]);

  if (!spectrum || !result) return <p>No spectra are loaded. Go back to Upload to add one.</p>;

  const remember = () => {
    history.current = [...history.current, data.processing].slice(-UNDO_LIMIT);
    setCanUndo(true);
  };
  const setSettings = (next: FtirProcessing) => {
    remember();
    update({ processing: { ...data.processing, [spectrum.id]: next } });
  };
  const patch = <K extends FtirStep>(step: K, value: Partial<FtirProcessing[K]>) =>
    setSettings({ ...settings, [step]: { ...settings[step], ...value } });
  const resetStep = (step: FtirStep) => patch(step, DEFAULT_FTIR_PROCESSING[step]);
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ processing: last });
  };
  const applyToAll = () => {
    remember();
    const next = { ...data.processing };
    for (const s of spectra) next[s.id] = settings;
    update({ processing: next });
  };
  const messages = (step: FtirStep) => result.messages[step];
  const b = settings.baseline;

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
            onClick={() => setSettings(DEFAULT_FTIR_PROCESSING)}
            disabled={same(settings, DEFAULT_FTIR_PROCESSING)}
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
        Every step is optional and can be switched off again; your original data are never changed.
        Processing works on absorbance (A = 2 − log₁₀ %T, or the quantity chosen below for
        reflectance), whatever the plot shows.
      </p>

      {spectrum.kind === 'reflectance' && (
        <section class="process-step is-on" aria-labelledby="ftir-reflectance-title">
          <div class="process-step-header">
            <span id="ftir-reflectance-title" class="process-step-title">
              Reflectance to an absorbance-like quantity
            </span>
          </div>
          <p class="process-step-description">{REFLECTANCE_TEXT}</p>
          <div class="process-step-body">
            <fieldset class="method-choice">
              <legend>Quantity</legend>
              {(Object.keys(REFLECTANCE_LABELS) as ReflectanceTransform[]).map((t) => (
                <label key={t} class="check">
                  <input
                    type="radio"
                    name="ftir-reflectance"
                    checked={settings.reflectance === t}
                    onChange={() => setSettings({ ...settings, reflectance: t })}
                  />
                  {REFLECTANCE_LABELS[t]}
                </label>
              ))}
            </fieldset>
            <p class="field-hint">
              log₁₀(1/R) is sometimes preferred for strongly absorbing or undiluted samples, where
              F(R) exaggerates the strongest bands. Whichever you choose is named on the axes, in
              the tables and in the methods text.
            </p>
          </div>
        </section>
      )}

      <StepSection
        id="co2"
        title="Remove the CO₂ band"
        description="Carbon dioxide in the air of the spectrometer gives a sharp doublet around 2349 cm⁻¹ when the background and sample were measured with different amounts of CO₂ in the beam. This replaces the range by a straight line between its ends, marks it on the plot and picks no peaks in it. Anything the sample itself absorbs there is lost too, so leave it off if your sample has a band in this range (for example a nitrile, an alkyne or adsorbed CO₂)."
        enabled={settings.co2.enabled}
        onToggle={(enabled) => patch('co2', { enabled })}
        onReset={() => resetStep('co2')}
        messages={messages('co2')}
      >
        <NumberInput
          label="From (cm⁻¹)"
          value={settings.co2.fromCm}
          min={0}
          onChange={(v) => v !== null && patch('co2', { fromCm: v })}
        />
        <NumberInput
          label="To (cm⁻¹)"
          value={settings.co2.toCm}
          min={0}
          onChange={(v) => v !== null && patch('co2', { toCm: v })}
        />
        <p class="field-hint">
          Default {DEFAULT_CO2_RANGE.fromCm}–{DEFAULT_CO2_RANGE.toCm} cm⁻¹, around the 2349 cm⁻¹
          asymmetric stretch of CO₂ (NIST CCCBDB). Widen it if the doublet reaches further in your
          spectrum.
        </p>
      </StepSection>

      <StepSection
        id="atr"
        title="ATR correction"
        description="In ATR the infrared wave reaches only a short distance into the sample, and that depth grows with wavelength, so bands at low wavenumber look stronger than in a transmission spectrum. This multiplies the absorbance by ν̃/ν̃ref to remove that trend. Use it only for spectra measured by ATR."
        enabled={settings.atr.enabled}
        onToggle={(enabled) => patch('atr', { enabled })}
        onReset={() => resetStep('atr')}
        messages={messages('atr')}
      >
        <p class="field-hint">
          The penetration depth is dp = λ / (2π n₁ √(sin²θ − (n₂/n₁)²)) (Harrick). The indices and
          angle only set the depth reported below; the correction itself needs just the reference.
          It does not undo the small band shifts ATR causes near very strong bands. Usually quoted
          mid-infrared crystal indices: diamond and ZnSe about 2.4, germanium about 4.0 (check your
          accessory&apos;s manual).
        </p>
        <NumberInput
          label="Reference wavenumber (cm⁻¹)"
          value={settings.atr.referenceCm}
          min={0}
          onChange={(v) => v !== null && patch('atr', { referenceCm: v })}
        />
        <NumberInput
          label="Crystal index n₁"
          value={settings.atr.crystalIndex}
          min={1}
          step={0.1}
          onChange={(v) => v !== null && patch('atr', { crystalIndex: v })}
        />
        <NumberInput
          label="Sample index n₂"
          value={settings.atr.sampleIndex}
          min={1}
          step={0.05}
          onChange={(v) => v !== null && patch('atr', { sampleIndex: v })}
        />
        <NumberInput
          label="Angle of incidence (°)"
          value={settings.atr.angleDeg}
          min={0}
          max={90}
          onChange={(v) => v !== null && patch('atr', { angleDeg: v })}
        />
      </StepSection>

      <StepSection
        id="baseline"
        title="Baseline correction"
        description="Estimates a smooth curve under the bands (from scattering, drift or a sloped background) and subtracts it, so bands start from zero. The estimated baseline is drawn dashed over the 'before' data."
        enabled={b.enabled}
        onToggle={(enabled) => patch('baseline', { enabled })}
        onReset={() => resetStep('baseline')}
        messages={messages('baseline')}
      >
        <fieldset class="method-choice">
          <legend>Method</legend>
          {(Object.keys(BASELINE_LABELS) as BaselineMethod[]).map((method) => (
            <label key={method} class="check">
              <input
                type="radio"
                name="ftir-baseline-method"
                checked={b.method === method}
                onChange={() => patch('baseline', { method })}
              />
              {BASELINE_LABELS[method]}
            </label>
          ))}
        </fieldset>
        {b.method === 'arpls' && (
          <>
            <p class="field-hint">
              Asymmetrically reweighted penalised least squares: a smooth curve that follows the
              points within the noise band and ignores points well above it (bands). Larger
              smoothness gives a stiffer baseline. In tests with known baselines it gave the
              smallest error of the methods offered here (see About).
            </p>
            <NumberInput
              label="Smoothness (power of ten)"
              value={b.logLambda}
              min={0}
              max={10}
              step={0.5}
              onChange={(v) => v !== null && patch('baseline', { logLambda: v })}
            />
          </>
        )}
        {b.method === 'rubber-band' && (
          <p class="field-hint">
            Stretches a rubber band under the spectrum (its lower convex hull) and subtracts it. It
            has no settings and never goes above the data, but it follows any deep valley.
          </p>
        )}
        {b.method === 'polynomial' && (
          <>
            <p class="field-hint">
              Fits a smooth polynomial, lowers every point above it to the curve, and repeats until
              it settles under the bands. A higher degree follows a curved baseline more closely but
              can cut into broad bands.
            </p>
            <label class="inline-field">
              Degree
              <select
                value={b.degree}
                onChange={(e) => patch('baseline', { degree: Number(e.currentTarget.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {b.method === 'als' && (
          <>
            <p class="field-hint">
              Fits a smooth curve that counts points above it much less than points below it, so
              bands are ignored. Larger smoothness gives a stiffer baseline. The asymmetry is the
              weight of points above the curve; smaller values ignore bands more strongly.
            </p>
            <NumberInput
              label="Smoothness (power of ten)"
              value={b.logLambda}
              min={0}
              max={10}
              step={0.5}
              onChange={(v) => v !== null && patch('baseline', { logLambda: v })}
            />
            <NumberInput
              label="Asymmetry"
              value={b.p}
              min={0}
              max={0.5}
              step={0.005}
              onChange={(v) => v !== null && patch('baseline', { p: v })}
            />
          </>
        )}
      </StepSection>

      <StepSection
        id="smoothing"
        title="Smoothing"
        description="Savitzky–Golay smoothing fits a small polynomial through each group of neighbouring points. It reduces noise while keeping band heights and positions much better than a simple moving average. Use the smallest window that makes the noise acceptable."
        enabled={settings.smoothing.enabled}
        onToggle={(enabled) => patch('smoothing', { enabled })}
        onReset={() => resetStep('smoothing')}
        messages={messages('smoothing')}
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

      <StepSection
        id="normalise"
        title="Normalisation"
        description={`Rescales the absorbance so spectra of different thickness or concentration can be compared by shape. It changes the vertical scale only; peak positions stay the same.${data.view.quantity === 'transmittance' ? ' A normalised spectrum is always shown as absorbance, because it has no transmittance equivalent.' : ''}`}
        enabled={normalised}
        onToggle={(enabled) => patch('normalise', { enabled })}
        onReset={() => resetStep('normalise')}
        messages={messages('normalise')}
      >
        <fieldset class="method-choice">
          <legend>Method</legend>
          {(Object.keys(NORMALISE_LABELS) as NormaliseMethod[]).map((method) => (
            <label key={method} class="check">
              <input
                type="radio"
                name="ftir-normalise"
                checked={settings.normalise.method === method}
                onChange={() => patch('normalise', { method })}
              />
              {NORMALISE_LABELS[method]}
            </label>
          ))}
        </fieldset>
        {settings.normalise.method === 'band' && (
          <>
            <p class="field-hint">
              Choose a band that does not change between your samples (an internal standard, or a
              band of the support or matrix). Its height or area is measured above the straight line
              between the two ends of the range, so take the range from valley to valley.
            </p>
            <NumberInput
              label="Band from (cm⁻¹)"
              value={settings.normalise.band.fromCm}
              min={0}
              onChange={(fromCm) =>
                patch('normalise', { band: { ...settings.normalise.band, fromCm } })
              }
            />
            <NumberInput
              label="Band to (cm⁻¹)"
              value={settings.normalise.band.toCm}
              min={0}
              onChange={(toCm) =>
                patch('normalise', { band: { ...settings.normalise.band, toCm } })
              }
            />
            <label class="inline-field">
              Divide by
              <select
                value={settings.normalise.band.measure}
                onChange={(e) =>
                  patch('normalise', {
                    band: {
                      ...settings.normalise.band,
                      measure: e.currentTarget.value as 'height' | 'area',
                    },
                  })
                }
              >
                <option value="height">Band height</option>
                <option value="area">Band area</option>
              </select>
            </label>
          </>
        )}
      </StepSection>

      <FtirPlot
        curves={curves}
        quantity={quantity}
        absorbanceName={shown.name}
        edited={view === 'all' ? null : result.edited}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        exportName={view === 'all' ? 'ftir-spectra' : spectrum.name}
        showOverlayOptions={view === 'all'}
        focusCm={focus}
        toolbar={
          <>
            <div class="radiation-fields">
              <fieldset class="segmented">
                <legend>Show</legend>
                {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
                  <label key={v} class={view === v ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name="ftir-view"
                      checked={view === v}
                      onChange={() => setView(v)}
                    />
                    {VIEW_LABELS[v]}
                  </label>
                ))}
              </fieldset>
              <div class="clean-actions">
                <button
                  type="button"
                  class="btn"
                  onClick={() => setFocus([FINGERPRINT[0], FINGERPRINT[1]])}
                >
                  Fingerprint region
                </button>
                <HelpTip term="fingerprint region">
                  <p>
                    The fingerprint region is conventionally taken as roughly 1500 to 400 cm⁻¹. It
                    has many overlapping bands that are hard to assign one by one but are
                    characteristic of a particular compound. The button zooms to 1500 to 400 cm⁻¹.
                  </p>
                </HelpTip>
              </div>
            </div>
            <QuantityChoice data={data} update={update} shown={shown} />
          </>
        }
      />
    </div>
  );
}
