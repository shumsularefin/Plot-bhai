import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatNumber, parseTypedNumbers } from '../../../core/xrd/parsers/numbers';
import type { ProfileKind } from '../../../core/xrd/peaks/profiles';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import type { PlotBand } from '../../../ui/plot/types';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { absorbanceOf, cut, swanepoelView } from './analysis';
import type { FilmData } from './data';

const PROFILES: [ProfileKind, string][] = [
  ['lorentzian', 'Lorentzian'],
  ['gaussian', 'Gaussian'],
  ['pseudo-voigt', 'Pseudo-Voigt (fitted mix)'],
];

/** Film wizard step 2: the range and settings, on a plot of the spectrum. */
export function FilmSetupStep({ data, update }: StepContext<FilmData>) {
  const s = data.spectrum;
  const plasmon = data.method === 'plasmon';
  const p = data.plasmon;
  const w = data.swanepoel;
  const [text, setText] = useState(p.centresNm.join(', '));
  useEffect(() => setText(p.centresNm.join(', ')), [p.centresNm]);
  const swan = useMemo(() => (plasmon ? null : swanepoelView(data)), [plasmon, data]);
  const absorbance = useMemo(() => (s ? absorbanceOf(s) : null), [s]);

  if (!s) return <p>No spectrum is loaded. Go back to step 1.</p>;
  const setPlasmon = (patch: Partial<FilmData['plasmon']>) =>
    update({ plasmon: { ...p, ...patch, result: null } });
  const setSwan = (patch: Partial<FilmData['swanepoel']>) =>
    update({ swanepoel: { ...w, ...patch } });

  const sources: SeriesSource[] = plasmon
    ? absorbance
      ? [{ id: 'a', name: s.name, x: s.wavelengthNm, y: absorbance, unit: '' }]
      : []
    : swan
      ? [{ id: 't', name: s.name, x: swan.x, y: swan.t.map((v) => 100 * v), unit: '%' }]
      : [];
  const points = swan ? swan.extrema.map((e) => ({ x: e.wavelengthNm, y: 100 * e.t })) : [];
  const bands: PlotBand[] =
    plasmon && p.fromNm !== null && p.toNm !== null
      ? [{ fromX: p.fromNm, toX: p.toNm, label: 'Fit range' }]
      : [];

  const useMaximum = () => {
    if (!absorbance || p.fromNm === null || p.toNm === null) return;
    const part = cut(s.wavelengthNm, absorbance, p.fromNm, p.toNm);
    let best = 0;
    for (let i = 1; i < part.y.length; i++)
      if ((part.y[i] as number) > (part.y[best] as number)) best = i;
    const at = part.x[best];
    if (at !== undefined) setPlasmon({ centresNm: [Number(at.toFixed(1))] });
  };

  return (
    <div class="clean-step">
      {plasmon ? (
        <>
          <div class="radiation-fields">
            <NumberInput
              label="Fit from (nm)"
              value={p.fromNm}
              min={0}
              onChange={(fromNm) => setPlasmon({ fromNm })}
            />
            <NumberInput
              label="to (nm)"
              value={p.toNm}
              min={0}
              onChange={(toNm) => setPlasmon({ toNm })}
            />
          </div>
          <fieldset class="method-choice">
            <legend>
              Band shape{' '}
              <HelpTip term="plasmon band shape">
                <p>
                  The fit is made on the photon energy axis E = hc/λ, where a single plasmon band of
                  small spheres is close to a Lorentzian. Size and shape spreads broaden it towards
                  a Gaussian; the pseudo-Voigt fits the mix.
                </p>
              </HelpTip>
            </legend>
            {PROFILES.map(([kind, name]) => (
              <label key={kind} class="check">
                <input
                  type="radio"
                  name="plasmon-profile"
                  checked={p.profile === kind}
                  onChange={() => setPlasmon({ profile: kind })}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <label class="inline-field">
            Starting band positions (nm, separated by commas)
            <input
              type="text"
              inputMode="decimal"
              value={text}
              onInput={(e) => setText(e.currentTarget.value)}
              onChange={(e) => {
                const values = parseTypedNumbers(e.currentTarget.value);
                if (values) setPlasmon({ centresNm: values });
              }}
            />
          </label>
          {parseTypedNumbers(text) === null && (
            <p class="message is-warning">
              <strong>Check:</strong> every position must be a number.
            </p>
          )}
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              disabled={p.fromNm === null || p.toNm === null}
              onClick={useMaximum}
            >
              Use the maximum in the range
            </button>
          </div>
          <p class="field-hint">
            Nanorods and some other shapes show two bands; type both positions. Pick a range that
            holds the whole band and some flat background on both sides.
          </p>
        </>
      ) : (
        <>
          <fieldset class="method-choice">
            <legend>
              Substrate{' '}
              <HelpTip term="substrate index">
                <p>
                  The method needs the refractive index s of the substrate, taken as the same at all
                  wavelengths and non-absorbing. Type it (about 1.5 for common glass; check your
                  substrate&apos;s data sheet), or give the transmittance of the bare substrate,
                  from which s = 1/Ts + √(1/Ts² − 1).
                </p>
              </HelpTip>
            </legend>
            <label class="check">
              <input
                type="radio"
                name="substrate-by"
                checked={w.substrateBy === 'index'}
                onChange={() => setSwan({ substrateBy: 'index' })}
              />
              Refractive index
            </label>
            <label class="check">
              <input
                type="radio"
                name="substrate-by"
                checked={w.substrateBy === 'transmittance'}
                onChange={() => setSwan({ substrateBy: 'transmittance' })}
              />
              Transmittance of the bare substrate
            </label>
          </fieldset>
          <div class="radiation-fields">
            {w.substrateBy === 'index' ? (
              <NumberInput
                label="Substrate index s"
                value={w.substrateIndex}
                min={1}
                onChange={(substrateIndex) => setSwan({ substrateIndex })}
              />
            ) : (
              <NumberInput
                label="Substrate transmittance (%)"
                value={w.substrateTPct}
                min={0}
                max={100}
                onChange={(substrateTPct) => setSwan({ substrateTPct })}
              />
            )}
            <NumberInput
              label="Smallest fringe height (% T)"
              value={w.prominencePct}
              min={0}
              step={0.5}
              onChange={(v) => v !== null && setSwan({ prominencePct: v })}
            />
            <NumberInput
              label="Use from (nm)"
              value={w.fromNm}
              min={0}
              onChange={(fromNm) => setSwan({ fromNm })}
            />
            <NumberInput
              label="to (nm)"
              value={w.toNm}
              min={0}
              onChange={(toNm) => setSwan({ toNm })}
            />
          </div>
          {swan && (
            <p class="field-hint">
              {swan.extrema.filter((e) => e.kind === 'max').length} maxima and{' '}
              {swan.extrema.filter((e) => e.kind === 'min').length} minima found (marked on the
              plot). Leave out the short-wavelength region where the film absorbs strongly and the
              fringes fade.
              {swan.extrema.length > 0 &&
                ` Range of the extrema: ${formatNumber(swan.extrema[0]?.wavelengthNm as number, 0)} to ${formatNumber(swan.extrema[swan.extrema.length - 1]?.wavelengthNm as number, 0)} nm.`}
            </p>
          )}
        </>
      )}
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => ({
          x: 'Wavelength (nm)',
          y: plasmon ? 'Absorbance' : 'Transmittance (%)',
        })}
        xName="λ"
        xUnit=" nm"
        exportName={plasmon ? 'plasmon-spectrum' : 'film-transmittance'}
        showOverlayOptions={false}
        bands={bands}
        points={points}
      />
    </div>
  );
}
