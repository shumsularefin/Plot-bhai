import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { regionValue, type RegionFit } from '../../core/xrd/peaks/fit';
import { profile, type ProfileKind } from '../../core/xrd/peaks/profiles';
import { lowerBoundIndex } from '../../core/xrd/peaks/search';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import { PeaksClient } from '../xrd/peaksClient';
import { peaksOf } from './analysis';
import type { BandContext } from './BandsStep';
import { peaksFor, processingFor, type BandSettings } from './data';
import { FtirPlot, type FtirCurve } from './FtirPlot';

const PROFILES: [ProfileKind, string][] = [
  ['gaussian', 'Gaussian'],
  ['lorentzian', 'Lorentzian'],
  ['pseudo-voigt', 'Pseudo-Voigt (fitted mix)'],
];

const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

/** Parses "1650, 1685.5 1720" into numbers; null when any entry is not a number. */
export function parseCentres(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter((p) => p !== '');
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

/** Share of each band's area in the total fitted area, percent. */
export const areaShares = (fit: RegionFit): number[] => {
  const total = fit.peaks.reduce((s, p) => s + p.area, 0);
  return fit.peaks.map((p) => (total > 0 ? (100 * p.area) / total : NaN));
};

const fmt = (v: number, digits: number) => (Number.isFinite(v) ? formatNumber(v, digits) : 'n/a');

/** Band fitting over one wavenumber region (runs in the peaks worker). */
export function BandFitSection({ data, update, spectrum, processed, settings, set }: BandContext) {
  const st = settings.fit;
  const key = JSON.stringify(processingFor(data, spectrum.id));
  const [text, setText] = useState(st.centres.join(', '));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const client = useRef<PeaksClient | null>(null);
  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);
  useEffect(() => setText(st.centres.join(', ')), [st.centres]);

  const change = (patch: Partial<BandSettings['fit']>) =>
    set({
      fit: { ...patch, result: null },
      // Positions typed or taken from the picked peaks no longer come from the derivative.
      ...(patch.centres && { derivative: { used: false } }),
    });
  const ready = st.fromCm !== null && st.toCm !== null && st.fromCm !== st.toCm;
  const lo = Math.min(st.fromCm ?? 0, st.toCm ?? 0);
  const hi = Math.max(st.fromCm ?? 0, st.toCm ?? 0);
  const inRange = st.centres.filter((c) => c >= lo && c <= hi);
  const result = st.result;
  const stale = result !== null && result.key !== key;
  const fit = result && !stale ? result.fit : null;

  const usePicked = () => {
    const picked = peaksOf(processed, peaksFor(data, spectrum.id)).filter(
      (p) => p.wavenumber >= lo && p.wavenumber <= hi,
    );
    change({ centres: picked.map((p) => Number(p.wavenumber.toFixed(1))) });
  };

  const run = async () => {
    if (!ready || !client.current) return;
    setBusy(true);
    setFailed(false);
    const found = await client.current.fitBands(processed.wavenumber, processed.absorbance, {
      fromCm: lo,
      toCm: hi,
      centres: inRange,
      profile: st.profile,
    });
    setBusy(false);
    if (!found) setFailed(true);
    else set({ fit: { result: { key, fit: found } } });
  };

  const curves = useMemo((): FtirCurve[] => {
    if (!ready) return [];
    const i0 = lowerBoundIndex(processed.wavenumber, lo);
    const i1 = lowerBoundIndex(processed.wavenumber, hi + 1e-9);
    const x = processed.wavenumber.slice(i0, i1);
    const data: FtirCurve = {
      id: 'data',
      name: spectrum.name,
      wavenumber: x,
      absorbance: processed.absorbance.slice(i0, i1),
      colorIndex: 0,
    };
    if (!fit) return [data];
    const bg = (v: number) =>
      fit.background.intercept + fit.background.slope * (v - fit.background.pivot);
    return [
      data,
      {
        id: 'fit',
        name: 'Fit',
        wavenumber: x,
        absorbance: x.map((v) => regionValue(fit, v)),
        colorIndex: 1,
      },
      ...fit.peaks.map((p, i) => ({
        id: `band-${i}`,
        name: `Band ${formatNumber(p.center, 1)} cm⁻¹`,
        wavenumber: x,
        absorbance: x.map((v) => bg(v) + profile(v, p)),
        colorIndex: 2 + (i % 5),
        dashed: true,
      })),
    ];
  }, [ready, processed, lo, hi, fit, spectrum.name]);

  const shares = fit ? areaShares(fit) : [];
  const pv = st.profile === 'pseudo-voigt';
  const download = () => {
    if (!fit) return;
    downloadCsv(
      `${spectrum.name}-band-fit`,
      `Band fit of ${spectrum.name} (processed absorbance) from ${formatNumber(lo, 1)} to ${formatNumber(hi, 1)} cm-1: ${st.profile} profiles plus a straight background, Levenberg-Marquardt least squares. R2 = ${fmt(fit.rSquared, 5)}, reduced chi2 = ${fmt(fit.reducedChiSquared, 3)}. Uncertainties are standard errors from the covariance matrix. Area in absorbance x cm-1.`,
      fit.peaks.map((p, i) => ({ p, share: shares[i] as number })),
      [
        { header: 'Centre (cm-1)', value: (r) => r.p.center },
        { header: 'Centre SE (cm-1)', value: (r) => r.p.sigma.center },
        { header: 'FWHM (cm-1)', value: (r) => r.p.fwhm },
        { header: 'FWHM SE (cm-1)', value: (r) => r.p.sigma.fwhm },
        { header: 'Height', value: (r) => r.p.height },
        { header: 'Height SE', value: (r) => r.p.sigma.height },
        { header: 'Lorentzian fraction eta', value: (r) => r.p.eta },
        { header: 'Area', value: (r) => r.p.area },
        { header: 'Area SE', value: (r) => r.p.areaSigma },
        { header: 'Share of fitted area (%)', value: (r) => r.share },
      ],
    );
  };

  return (
    <section class="process-step is-on" aria-labelledby="bandfit-title">
      <h3 id="bandfit-title" class="process-step-title">
        Band fitting{' '}
        <HelpTip term="band fitting">
          <p>
            Fits a sum of bands plus a straight background to one region by least squares
            (Levenberg–Marquardt). Gaussian: G = h·exp(−4 ln2 (ν̃ − ν̃₀)²/w²); Lorentzian: L = h / (1
            + 4(ν̃ − ν̃₀)²/w²); pseudo-Voigt: η·L + (1 − η)·G with the fraction η fitted. w is the
            full width at half maximum.
          </p>
          <p>
            You give the starting positions: the picked peaks, the second-derivative minima, or your
            own. A fit with more bands always looks better, so add a band only where the data or the
            second derivative show one. Areas are in absorbance × cm⁻¹.
          </p>
        </HelpTip>
      </h3>
      <div class="radiation-fields">
        <NumberInput
          label="Fit from (cm⁻¹)"
          value={st.fromCm}
          min={0}
          onChange={(fromCm) => change({ fromCm })}
        />
        <NumberInput
          label="to (cm⁻¹)"
          value={st.toCm}
          min={0}
          onChange={(toCm) => change({ toCm })}
        />
      </div>
      <fieldset class="method-choice">
        <legend>Band shape</legend>
        {PROFILES.map(([kind, name]) => (
          <label key={kind} class="check">
            <input
              type="radio"
              name="ftir-band-profile"
              checked={st.profile === kind}
              onChange={() => change({ profile: kind })}
            />
            {name}
          </label>
        ))}
      </fieldset>
      <label class="inline-field">
        Starting band positions (cm⁻¹, separated by commas)
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onChange={(e) => {
            const values = parseCentres(e.currentTarget.value);
            if (values) change({ centres: values });
          }}
        />
      </label>
      {parseCentres(text) === null && (
        <p class="message is-warning">
          <strong>Check:</strong> every position must be a number.
        </p>
      )}
      {ready && st.centres.length > inRange.length && (
        <p class="field-hint">
          {st.centres.length - inRange.length} position(s) lie outside the fit range and are left
          out.
        </p>
      )}
      <div class="export-actions">
        <button type="button" class="btn" disabled={!ready} onClick={usePicked}>
          Use the picked peaks in this range
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={!ready || inRange.length === 0 || busy}
          onClick={() => void run()}
        >
          {busy ? 'Fitting…' : 'Fit bands'}
        </button>
      </div>
      {!ready && <p class="field-hint">Give the range to fit, then the starting positions.</p>}
      {failed && (
        <p class="message is-warning">
          <strong>Check:</strong> the fit could not be run. Try again, or reload the page.
        </p>
      )}
      {stale && (
        <p class="message is-info">
          The processing in step 2 changed since the last fit. Press Fit bands to fit again.
        </p>
      )}
      {ready && (
        <FtirPlot
          curves={curves}
          quantity="absorbance"
          settings={data.plot}
          onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
          exportName={`${spectrum.name}-band-fit`}
          showOverlayOptions={false}
          focusCm={[lo, hi]}
        />
      )}
      {fit && (
        <>
          <p class="field-hint">
            R² = {fmt(fit.rSquared, 5)}, χ²ν = {fmt(fit.reducedChiSquared, 3)} (about 1 when the fit
            matches the data to within their noise).
          </p>
          {[
            ...fit.messages,
            ...fit.peaks.flatMap((p) =>
              p.messages.map((m) => ({
                ...m,
                text: `Band at ${formatNumber(p.center, 1)} cm⁻¹: ${m.text}`,
              })),
            ),
          ].map((m, i) => (
            <p key={i} class={`message ${m.level === 'info' ? 'is-info' : 'is-warning'}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </p>
          ))}
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Fitted bands, scrolls sideways"
          >
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">Centre (cm⁻¹)</th>
                  <th scope="col">FWHM (cm⁻¹)</th>
                  <th scope="col">Height</th>
                  {pv && <th scope="col">η</th>}
                  <th scope="col">Area</th>
                  <th scope="col">Share of area (%)</th>
                </tr>
              </thead>
              <tbody>
                {fit.peaks.map((p, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {fmt(p.center, 1)} ± {fmt(p.sigma.center, 1)}
                    </th>
                    <td>
                      {fmt(p.fwhm, 1)} ± {fmt(p.sigma.fwhm, 1)}
                    </td>
                    <td>{fmt(p.height, 4)}</td>
                    {pv && <td>{fmt(p.eta, 2)}</td>}
                    <td>
                      {fmt(p.area, 4)} ± {fmt(p.areaSigma, 2)}
                    </td>
                    <td>{fmt(shares[i] as number, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="field-hint">
            ± values are standard errors from the fit; they assume the model is right.
          </p>
          <div class="export-actions">
            <button type="button" class="btn" onClick={download}>
              Fitted bands (CSV)
            </button>
          </div>
        </>
      )}
    </section>
  );
}
