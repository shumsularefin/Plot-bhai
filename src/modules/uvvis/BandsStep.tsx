import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nearestMaximum } from '../../core/ftir/peaks';
import { HC_EV_NM, energyFromWavelength } from '../../core/uvvis/conversions';
import {
  NO_UVVIS_EDITS,
  shoulderSuggestions,
  SNAP_NM,
  uvvisPeaks,
  type UvvisPeak,
  type UvvisPeakEdits,
  type UvvisPeakSettings,
} from '../../core/uvvis/peaks';
import { plasmonBands } from '../../core/uvvis/plasmon';
import { regionValue } from '../../core/xrd/peaks/fit';
import type { ProfileKind } from '../../core/xrd/peaks/profiles';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel, type PlotInteraction } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { TableBox } from '../xrd/MethodDetails';
import { NumberInput } from '../xrd/NumberInput';
import { PeaksClient } from '../xrd/peaksClient';
import { cleanAll } from './analysis';
import {
  BAND_COLUMNS,
  BAND_FIT_COLUMNS,
  BAND_NOTE,
  BAND_QUANTITY_TEXT,
  bandFitKey,
  bandLabels,
  bandSignal,
  ORIGIN_TEXT,
  type BandSignal,
} from './bands';
import {
  bandFitFor,
  newId,
  peakEditsFor,
  peaksFor,
  type BandFitSettings,
  type UvvisData,
} from './data';

type Mode = 'view' | 'add' | 'remove';
const MODE_LABELS: Record<Mode, string> = {
  view: 'Zoom and pan',
  add: 'Add bands',
  remove: 'Remove bands',
};
const MODE_HINTS: Record<Mode, string | undefined> = {
  view: undefined,
  add: 'Click or tap the plot where a band should be added.',
  remove: 'Click or tap the marker of a band to remove it.',
};
const PROFILE_LABELS: Record<ProfileKind, string> = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'Pseudo-Voigt',
};
const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;
/** More bands than this is probably noise or an over-sensitive threshold. */
const MANY_BANDS = 30;

const nm = (v: number) => v.toFixed(1);

/** Wizard step 3: the absorption bands of each spectrum, edited by hand, and an optional band fit. */
export function BandsStep({ data, update }: StepContext<UvvisData>) {
  const spectra = data.spectra;
  const [selectedId, setSelectedId] = useState(spectra[0]?.id);
  const spectrum = spectra.find((s) => s.id === selectedId) ?? spectra[0];
  const [mode, setMode] = useState<Mode>('view');
  const [typed, setTyped] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { cleaning } = data;
  const cleaned = useMemo(() => cleanAll(spectra, cleaning), [spectra, cleaning]);
  const clean = spectrum ? cleaned[spectra.indexOf(spectrum)] : undefined;
  const signal = useMemo(
    () => (spectrum && clean ? bandSignal(spectrum, clean) : null),
    [spectrum, clean],
  );
  const settings = spectrum ? peaksFor(data, spectrum.id) : null;
  const edits = spectrum ? peakEditsFor(data, spectrum.id) : NO_UVVIS_EDITS;
  const peaks = useMemo(
    () => (signal && settings ? uvvisPeaks(signal.x, signal.y, settings, edits) : []),
    [signal, settings, edits],
  );
  const shoulders = useMemo(
    () => (signal && settings ? shoulderSuggestions(signal.x, signal.y, settings, peaks) : []),
    [signal, settings, peaks],
  );

  if (!spectrum || !signal || !settings) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  }
  const change = (patch: Partial<UvvisPeakSettings>) =>
    update({ peaks: { ...data.peaks, [spectrum.id]: { ...settings, ...patch } } });
  const setEdits = (next: UvvisPeakEdits) =>
    update({ peakEdits: { ...data.peakEdits, [spectrum.id]: next } });
  const edited = edits.added.length + edits.removed.length > 0;
  const unit = BAND_QUANTITY_TEXT[signal.quantity];

  const addAt = (at: number, shoulder = false) => {
    const x = signal.x;
    if (!(at >= (x[0] as number) && at <= (x[x.length - 1] as number))) {
      setNote(`${nm(at)} nm is outside the spectrum.`);
      return;
    }
    const pos = shoulder ? at : (nearestMaximum(x, signal.y, at, SNAP_NM) ?? at);
    const existing = peaks.find((p) => Math.abs(p.wavelengthNm - pos) <= SNAP_NM / 2);
    if (existing) {
      setNote(`There is already a band at ${nm(existing.wavelengthNm)} nm.`);
      return;
    }
    setNote(`Band added at ${nm(pos)} nm.`);
    setEdits({ ...edits, added: [...edits.added, { id: newId(), wavelengthNm: pos, shoulder }] });
  };
  const remove = (peak: UvvisPeak) => {
    setNote(`Band at ${nm(peak.wavelengthNm)} nm removed.`);
    if (peak.handId !== undefined) {
      setEdits({ ...edits, added: edits.added.filter((a) => a.id !== peak.handId) });
    } else {
      setEdits({ ...edits, removed: [...edits.removed, peak.wavelengthNm] });
    }
  };

  const interaction: PlotInteraction = {
    markers: peaks.map((p) => ({ x: p.wavelengthNm, y: p.value })),
  };
  const hint = MODE_HINTS[mode];
  if (hint) interaction.hint = hint;
  if (mode === 'add') interaction.onPlotClick = (x) => addAt(x);
  if (mode === 'remove')
    interaction.onMarkerClick = (i) => {
      const peak = peaks[i];
      if (peak) remove(peak);
    };
  const sources: SeriesSource[] = [finiteCurve(spectrum.id, spectrum.name, signal)];
  const labels = bandLabels(
    peaks.map((peak) => ({ spectrum, quantity: signal.quantity, peak })),
    () => spectrum.id,
  );

  return (
    <div class="clean-step">
      {spectra.length > 1 && (
        <div class="clean-toolbar">
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
        </div>
      )}
      <p class="field-hint">
        Bands are picked on the cleaned spectrum of step 2, as {unit.toLowerCase()}
        {signal.quantity === 'absorbance' && spectrum.kind === 'transmittance'
          ? ' (transmittance converted, A = −log₁₀ T)'
          : ''}
        . Positions come from a parabola through the highest point and its two neighbours; the
        photon energy is E = hc/λ. λmax in Results is still the highest data point.
      </p>

      <section class="process-step is-on" aria-labelledby="uv-prom-title">
        <h3 id="uv-prom-title" class="process-step-title">
          Band picking{' '}
          <HelpTip term="prominence">
            <p>
              Prominence is how far a band stands above the higher of the two valleys beside it. A
              noise spike has a small prominence, a real band a large one. The slider sets the
              smallest prominence kept, as a percentage of the difference between the highest and
              lowest value in the search range.
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
            label="Search from (nm)"
            value={settings.fromNm}
            min={0}
            onChange={(fromNm) => change({ fromNm })}
          />
          <NumberInput
            label="to (nm)"
            value={settings.toNm}
            min={0}
            onChange={(toNm) => change({ toNm })}
          />
        </div>
        <p class="field-hint">
          Leave a range box empty to search from the start or to the end of the spectrum. The rising
          absorption edge of a semiconductor is not a band, so a search range that stops before the
          edge avoids false maxima from noise there.
        </p>
        {peaks.length === 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> no bands were found. Lower the minimum prominence or widen the
            search range. A spectrum that only rises towards short wavelengths has no band maximum.
          </p>
        )}
        {peaks.length > MANY_BANDS && (
          <p class="message is-warning">
            <strong>Check:</strong> {peaks.length} bands is a lot, so many may be noise. Raise the
            minimum prominence or switch smoothing on in step 2.
          </p>
        )}
      </section>

      <section class="process-step is-on" aria-labelledby="uv-edit-title">
        <h3 id="uv-edit-title" class="process-step-title">
          Edit bands by hand{' '}
          <HelpTip term="editing bands">
            <p>
              Add a band the threshold missed, or remove one that is noise. A click within {SNAP_NM}{' '}
              nm of a local maximum adds the band at the maximum; further away it adds it where you
              clicked. Edits are kept by position, so they stay when you change the cleaning, and
              Undo in the bar above takes them back.
            </p>
          </HelpTip>
        </h3>
        <fieldset class="segmented">
          <legend>On the plot</legend>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <label key={m} class={mode === m ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="uvvis-band-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </fieldset>
        <div class="radiation-fields">
          <NumberInput label="Add a band at (nm)" value={typed} min={0} onChange={setTyped} />
          <button
            type="button"
            class="btn"
            disabled={typed === null}
            onClick={() => typed !== null && addAt(typed)}
          >
            Add band
          </button>
          <button
            type="button"
            class="btn"
            disabled={!edited}
            onClick={() => {
              setEdits(NO_UVVIS_EDITS);
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
              Possible shoulders: minima of the second derivative (Savitzky–Golay, window{' '}
              {settings.shoulderWindow} points, cubic) with no band within {SNAP_NM} nm. They are
              suggestions: noise also makes minima, so accept only those you can see on the
              spectrum.
            </p>
            <ul class="chip-row">
              {shoulders.map((at) => (
                <li key={at}>
                  <button type="button" class="btn btn-quiet" onClick={() => addAt(at, true)}>
                    Accept shoulder at {nm(at)} nm
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <NumberInput
          label="Shoulder search window (points, odd)"
          value={settings.shoulderWindow}
          min={5}
          step={2}
          onChange={(w) =>
            w !== null && w >= 5 && w % 2 === 1 && change({ shoulderWindow: Math.round(w) })
          }
        />
      </section>

      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        labels={() => ({ x: 'Wavelength (nm)', y: bandAxis(signal), yValues: true })}
        xName="λ"
        xUnit=" nm"
        exportName={`${spectrum.name}-bands`}
        showOverlayOptions={false}
        peakLabels={labels}
        interaction={interaction}
      />

      <section class="peak-table-section" aria-labelledby="uv-band-table-title">
        <h3 id="uv-band-table-title" class="process-step-title">
          Band table ({peaks.length})
        </h3>
        <TableBox
          label="Band table"
          onExport={() =>
            downloadCsv(
              `${spectrum.name}-bands`,
              BAND_NOTE,
              peaks.map((peak) => ({ spectrum, quantity: signal.quantity, peak })),
              BAND_COLUMNS,
            )
          }
        >
          <thead>
            <tr>
              <th scope="col">λ (nm)</th>
              <th scope="col">E (eV)</th>
              <th scope="col">{unit}</th>
              <th scope="col">Prominence</th>
              <th scope="col">Relative (%)</th>
              <th scope="col">Origin</th>
              <th scope="col">Remove</th>
            </tr>
          </thead>
          <tbody>
            {peaks.map((p) => (
              <tr key={`${p.wavelengthNm}-${p.origin}`}>
                <td>{nm(p.wavelengthNm)}</td>
                <td>{p.energyEv.toFixed(3)}</td>
                <td>{p.value.toPrecision(4)}</td>
                <td>{p.origin === 'shoulder' ? '–' : p.prominence.toPrecision(3)}</td>
                <td>{p.relative.toFixed(0)}</td>
                <td>{ORIGIN_TEXT[p.origin]}</td>
                <td>
                  <button type="button" class="btn btn-quiet" onClick={() => remove(p)}>
                    Remove<span class="visually-hidden"> band at {nm(p.wavelengthNm)} nm</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      </section>

      <BandFit
        data={data}
        update={update}
        spectrumId={spectrum.id}
        name={spectrum.name}
        signal={signal}
        peaks={peaks}
      />
    </div>
  );
}

function bandAxis(signal: BandSignal): string {
  return signal.quantity === 'kubelka-munk' ? 'Kubelka–Munk F(R)' : 'Absorbance (a.u.)';
}

function finiteCurve(id: string, name: string, signal: BandSignal): SeriesSource {
  const keep: number[] = [];
  for (let i = 0; i < signal.y.length; i++) if (Number.isFinite(signal.y[i])) keep.push(i);
  return {
    id,
    name,
    x: Float64Array.from(keep, (i) => signal.x[i] as number),
    y: Float64Array.from(keep, (i) => signal.y[i] as number),
    unit: '',
  };
}

/** Points of the signal inside [lo, hi] nm with a finite value. */
function cut(signal: BandSignal, lo: number, hi: number) {
  const keep: number[] = [];
  for (let i = 0; i < signal.x.length; i++) {
    const v = signal.x[i] as number;
    if (v >= lo && v <= hi && Number.isFinite(signal.y[i])) keep.push(i);
  }
  return {
    x: Float64Array.from(keep, (i) => signal.x[i] as number),
    y: Float64Array.from(keep, (i) => signal.y[i] as number),
  };
}

/** Band fit on the energy axis (the plasmon fit of the film tool), for overlapping bands. */
function BandFit({
  data,
  update,
  spectrumId,
  name,
  signal,
  peaks,
}: Pick<StepContext<UvvisData>, 'data' | 'update'> & {
  spectrumId: string;
  name: string;
  signal: BandSignal;
  peaks: readonly UvvisPeak[];
}) {
  const fit = bandFitFor(data, spectrumId);
  const key = bandFitKey(data, spectrumId);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const client = useRef<PeaksClient | null>(null);
  const ready = fit.fromNm !== null && fit.toNm !== null && fit.centresNm.length > 0;
  const current = fit.result && fit.result.key === key ? fit.result.fit : null;
  const set = (patch: Partial<BandFitSettings>) =>
    update({ bandFit: { ...data.bandFit, [spectrumId]: { ...fit, ...patch } } });

  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);
  useEffect(() => {
    if (!ready || current || !client.current) return;
    setState('busy');
    const all = cut(signal, -Infinity, Infinity);
    void client.current
      .fitPlasmon(all.x, all.y, {
        fromNm: fit.fromNm as number,
        toNm: fit.toNm as number,
        centresNm: fit.centresNm,
        profile: fit.profile,
      })
      .then((result) => {
        if (!result) setState('failed');
        else {
          setState('idle');
          set({ result: { key, fit: result } });
        }
      });
    // Runs again only when the data or settings behind the fit change.
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromTable = () => {
    if (peaks.length === 0) return;
    const lo = Math.min(...peaks.map((p) => p.wavelengthNm));
    const hi = Math.max(...peaks.map((p) => p.wavelengthNm));
    const margin = Math.max(30, (hi - lo) / 2);
    set({
      fromNm: Math.round(lo - margin),
      toNm: Math.round(hi + margin),
      centresNm: peaks.map((p) => Number(p.wavelengthNm.toFixed(1))),
    });
  };

  const bands = current ? plasmonBands(current) : [];
  const lo = Math.min(fit.fromNm ?? 0, fit.toNm ?? 0);
  const hi = Math.max(fit.fromNm ?? 0, fit.toNm ?? 0);
  const part = cut(signal, lo, hi);
  const sources: SeriesSource[] = current
    ? [
        { id: 'data', name, x: part.x, y: part.y, unit: '', colorIndex: 0 },
        {
          id: 'fit',
          name: 'Fit',
          x: part.x,
          y: part.x.map((l) => regionValue(current, energyFromWavelength(l))),
          unit: '',
          colorIndex: 1,
          dashed: true,
        },
      ]
    : [];
  const messages = current
    ? [
        ...current.messages,
        ...current.peaks.flatMap((b) =>
          b.messages.map((m) => ({
            ...m,
            text: `Band at ${(HC_EV_NM / b.center).toFixed(1)} nm: ${m.text}`,
          })),
        ),
      ]
    : [];

  return (
    <section class="process-step" aria-labelledby="uv-fit-title">
      <h3 id="uv-fit-title" class="process-step-title">
        Band fit on the energy axis (optional){' '}
        <HelpTip term="band fit">
          <p>
            Overlapping bands are separated by fitting Gaussian, Lorentzian or pseudo-Voigt bands
            plus a straight background on the photon energy axis E = hc/λ, where a symmetric band
            stays symmetric. Give the range and a starting position for each band; "Start from the
            band table" fills them in. The fitted widths and positions depend on the profile and
            background chosen, so report them with those settings.
          </p>
        </HelpTip>
      </h3>
      <div class="radiation-fields">
        <NumberInput
          label="Fit from (nm)"
          value={fit.fromNm}
          min={0}
          onChange={(fromNm) => set({ fromNm })}
        />
        <NumberInput label="to (nm)" value={fit.toNm} min={0} onChange={(toNm) => set({ toNm })} />
        <label class="inline-field">
          Band shape
          <select
            value={fit.profile}
            onChange={(e) => set({ profile: e.currentTarget.value as ProfileKind })}
          >
            {(Object.keys(PROFILE_LABELS) as ProfileKind[]).map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label class="inline-field">
          Starting positions (nm, comma separated)
          <input
            type="text"
            inputMode="decimal"
            value={fit.centresNm.join(', ')}
            onChange={(e) =>
              set({
                centresNm: e.currentTarget.value
                  .split(/[,;\s]+/)
                  .map(Number)
                  .filter((v) => Number.isFinite(v) && v > 0),
              })
            }
          />
        </label>
        <button type="button" class="btn" disabled={peaks.length === 0} onClick={fromTable}>
          Start from the band table
        </button>
      </div>
      {!ready && <p class="field-hint">Set the range and at least one starting position to fit.</p>}
      {ready && state === 'failed' && !current && (
        <p class="message is-error" role="alert">
          The fit could not be made. Check that the range holds at least 10 points and the bands.
        </p>
      )}
      {ready && state === 'busy' && !current && <p role="status">Fitting…</p>}
      {current && (
        <>
          <p class="message is-info" role="note">
            R² = {current.rSquared.toFixed(5)}. Uncertainties are standard errors of the fit.
          </p>
          {messages.map((m, i) => (
            <p key={i} class={`message ${m.level === 'info' ? 'is-info' : 'is-warning'}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </p>
          ))}
          <TableBox
            label="Fitted bands"
            onExport={() =>
              downloadCsv(
                `${name}-band-fit`,
                `Band fit of ${name} on the energy axis (E = hc/lambda), ${fit.profile} bands plus a straight background, ${lo} to ${hi} nm, R2 = ${current.rSquared.toFixed(5)}. Uncertainties are standard errors of the fit.`,
                bands,
                BAND_FIT_COLUMNS,
              )
            }
          >
            <thead>
              <tr>
                <th scope="col">Centre (nm)</th>
                <th scope="col">Centre (eV)</th>
                <th scope="col">FWHM (eV)</th>
                <th scope="col">FWHM (nm)</th>
                <th scope="col">Height</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  <td>{b.centerNm.toFixed(1)}</td>
                  <td>
                    {b.centerEv.toFixed(3)} ± {b.centerEvSigma.toFixed(3)}
                  </td>
                  <td>
                    {b.fwhmEv.toFixed(3)} ± {b.fwhmEvSigma.toFixed(3)}
                  </td>
                  <td>{b.fwhmNm.toFixed(1)}</td>
                  <td>{b.height.toPrecision(4)}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
            labels={() => ({ x: 'Wavelength (nm)', y: bandAxis(signal), yValues: true })}
            xName="λ"
            xUnit=" nm"
            exportName={`${name}-band-fit`}
            showOverlayOptions={false}
            dock="manual"
          />
        </>
      )}
    </section>
  );
}
