import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { energyFromWavelength, HC_EV_NM } from '../../../core/uvvis/conversions';
import { plasmonBands } from '../../../core/uvvis/plasmon';
import { regionValue } from '../../../core/xrd/peaks/fit';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import { SessionSection } from '../../../ui/SessionSection';
import type { StepContext } from '../../../ui/wizard/types';
import { downloadCsv } from '../../xrd/csv';
import { TableBox } from '../../xrd/MethodDetails';
import { PeaksClient } from '../../xrd/peaksClient';
import { absorbanceOf, cut, plasmonKey, substrateOf, swanepoelView } from './analysis';
import type { FilmData } from './data';
import { plasmonMethodsText, swanepoelMethodsText } from './methodsText';
import { filmSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 2;
const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

function MethodsBox({ text }: { text: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };
  return (
    <section aria-labelledby="film-methods-title">
      <h3 id="film-methods-title" class="export-title">
        Methods text
      </h3>
      <p class="field-hint">Written only from the settings you used and the numbers above.</p>
      <textarea
        class="methods-text"
        readOnly
        rows={8}
        value={text}
        aria-label="Methods paragraph"
      />
      <div class="export-actions">
        <button type="button" class="btn" onClick={() => void copy()}>
          Copy text
        </button>
      </div>
      <p class="export-status" role="status">
        {copied}
      </p>
    </section>
  );
}

/** Film wizard step 3: the plasmon fit or the Swanepoel result, plot, tables and export. */
export function FilmResultsStep(context: StepContext<FilmData>) {
  return (
    <div class="results-step">
      {context.data.method === 'plasmon' ? (
        <PlasmonResults {...context} />
      ) : (
        <SwanepoelResults {...context} />
      )}
      <SessionSection
        codec={filmSession}
        data={context.data}
        update={context.update}
        step={RESULTS_STEP}
        stem={context.data.method}
      />
    </div>
  );
}

function PlasmonResults({ data, update }: StepContext<FilmData>) {
  const p = data.plasmon;
  const s = data.spectrum;
  const key = plasmonKey(data);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const client = useRef<PeaksClient | null>(null);
  const absorbance = useMemo(() => (s ? absorbanceOf(s) : null), [s]);
  const ready = s !== null && absorbance !== null && p.fromNm !== null && p.toNm !== null;
  const current = p.result && p.result.key === key ? p.result.fit : null;

  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);
  useEffect(() => {
    if (!ready || current || p.centresNm.length === 0 || !client.current) return;
    setState('busy');
    const part = cut(s.wavelengthNm, absorbance, null, null);
    void client.current
      .fitPlasmon(part.x, part.y, {
        fromNm: p.fromNm as number,
        toNm: p.toNm as number,
        centresNm: p.centresNm,
        profile: p.profile,
      })
      .then((fit) => {
        if (!fit) setState('failed');
        else {
          setState('idle');
          update({ plasmon: { ...p, result: { key, fit } } });
        }
      });
    // Runs again only when the settings behind the fit change.
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <p class="message is-error">Set the fit range in step 2.</p>;
  if (p.centresNm.length === 0) {
    return <p class="message is-error">Give at least one starting band position in step 2.</p>;
  }
  if (state === 'failed') {
    return (
      <p class="message is-error" role="alert">
        The fit could not be made. Check that the range holds at least 10 points and the band.
      </p>
    );
  }
  if (!current) return <p role="status">Fitting…</p>;

  const bands = plasmonBands(current);
  const lo = Math.min(p.fromNm as number, p.toNm as number);
  const hi = Math.max(p.fromNm as number, p.toNm as number);
  const part = cut(s.wavelengthNm, absorbance, lo, hi);
  const fitted = part.x.map((l) => regionValue(current, energyFromWavelength(l)));
  const sources: SeriesSource[] = [
    { id: 'data', name: s.name, x: part.x, y: part.y, unit: '', colorIndex: 0 },
    { id: 'fit', name: 'Fit', x: part.x, y: fitted, unit: '', colorIndex: 1, dashed: true },
  ];
  const messages = [
    ...current.messages,
    ...current.peaks.flatMap((b) =>
      b.messages.map((m) => ({
        ...m,
        text: `Band at ${(HC_EV_NM / b.center).toFixed(1)} nm: ${m.text}`,
      })),
    ),
  ];

  return (
    <>
      <p class="message is-info" role="note">
        {bands
          .map(
            (b) =>
              `Band at ${b.centerNm.toFixed(1)} nm (${b.centerEv.toFixed(3)} ± ${b.centerEvSigma.toFixed(3)} eV), FWHM ${b.fwhmEv.toFixed(3)} eV (${b.fwhmNm.toFixed(1)} nm)`,
          )
          .join('; ')}
        . R² = {current.rSquared.toFixed(5)}.
      </p>
      {messages.map((m, i) => (
        <p key={i} class={`message ${m.level === 'info' ? 'is-info' : 'is-warning'}`}>
          <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
        </p>
      ))}
      <h3 class="export-title">
        Fitted bands{' '}
        <HelpTip term="plasmon position and width">
          <p>
            The position shifts with particle size, shape, aggregation and the surrounding medium,
            and the width grows with size spread and damping. Turning these numbers into a particle
            size needs a model or a calibration for your system; the site does not do that.
          </p>
        </HelpTip>
      </h3>
      <TableBox
        label="Fitted bands"
        onExport={() =>
          downloadCsv(
            `${s.name}-plasmon-fit`,
            `Plasmon band fit of ${s.name} on the energy axis (E = hc/lambda), ${p.profile} bands plus a straight background, R2 = ${current.rSquared.toFixed(5)}. Uncertainties are standard errors of the fit.`,
            bands,
            [
              { header: 'Centre (eV)', value: (b) => b.centerEv },
              { header: 'Centre SE (eV)', value: (b) => b.centerEvSigma },
              { header: 'Centre (nm)', value: (b) => b.centerNm },
              { header: 'FWHM (eV)', value: (b) => b.fwhmEv },
              { header: 'FWHM SE (eV)', value: (b) => b.fwhmEvSigma },
              { header: 'FWHM (nm)', value: (b) => b.fwhmNm },
              { header: 'Height (absorbance)', value: (b) => b.height },
              { header: 'Lorentzian fraction eta', value: (b) => b.eta },
              { header: 'Area (absorbance x eV)', value: (b) => b.area },
            ],
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
              <td>{b.height.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => ({ x: 'Wavelength (nm)', y: 'Absorbance' })}
        xName="λ"
        xUnit=" nm"
        exportName={`${s.name}-plasmon-fit`}
        showOverlayOptions={false}
      />
      <MethodsBox text={plasmonMethodsText(data, current, bands)} />
    </>
  );
}

function SwanepoelResults({ data, update }: StepContext<FilmData>) {
  const view = useMemo(() => swanepoelView(data), [data]);
  if (!view) return <p class="message is-error">Load a transmittance spectrum in step 1.</p>;
  if (!view.outcome.ok) {
    return (
      <p class="message is-error" role="alert">
        {view.outcome.error}
      </p>
    );
  }
  const r = view.outcome.result;
  const substrate = substrateOf(data) as number;
  const byLambda = [...r.rows].sort((a, b) => a.wavelengthNm - b.wavelengthNm);
  const sources: SeriesSource[] = [
    {
      id: 'n',
      name: 'Refractive index n₂',
      x: Float64Array.from(byLambda, (row) => row.wavelengthNm),
      y: Float64Array.from(byLambda, (row) => row.n2),
      unit: '',
    },
  ];
  return (
    <>
      <p class="message is-info" role="note">
        Film thickness d = {r.d2.toFixed(0)} ± {r.d2Sd.toFixed(0)} nm; refractive index from{' '}
        {byLambda[byLambda.length - 1]?.n2.toFixed(3)} at{' '}
        {byLambda[byLambda.length - 1]?.wavelengthNm.toFixed(0)} nm to {byLambda[0]?.n2.toFixed(3)}{' '}
        at {byLambda[0]?.wavelengthNm.toFixed(0)} nm.
      </p>
      {r.notes.map((n, i) => (
        <p key={i} class="message is-warning">
          <strong>Check:</strong> {n}
        </p>
      ))}
      <TableBox
        label="Extrema"
        onExport={() =>
          downloadCsv(
            `${data.spectrum?.name ?? 'film'}-swanepoel`,
            `Swanepoel envelope method, substrate index ${substrate.toFixed(4)}; d1 = ${r.d1.toFixed(1)} nm, d2 = ${r.d2.toFixed(1)} +- ${r.d2Sd.toFixed(1)} nm. T as fraction.`,
            byLambda,
            [
              { header: 'Wavelength (nm)', value: (row) => row.wavelengthNm },
              { header: 'Type', value: (row) => row.kind },
              { header: 'T max envelope', value: (row) => row.tMax },
              { header: 'T min envelope', value: (row) => row.tMin },
              { header: 'n1', value: (row) => row.n1 },
              { header: 'Order m', value: (row) => row.m },
              { header: 'd (nm)', value: (row) => row.d },
              { header: 'n2', value: (row) => row.n2 },
            ],
          )
        }
      >
        <thead>
          <tr>
            <th scope="col">λ (nm)</th>
            <th scope="col">Type</th>
            <th scope="col">T_M</th>
            <th scope="col">T_m</th>
            <th scope="col">n₁</th>
            <th scope="col">m</th>
            <th scope="col">d (nm)</th>
            <th scope="col">n₂</th>
          </tr>
        </thead>
        <tbody>
          {byLambda.map((row) => (
            <tr key={row.wavelengthNm}>
              <td>{row.wavelengthNm.toFixed(1)}</td>
              <td>{row.kind === 'max' ? 'maximum' : 'minimum'}</td>
              <td>{row.tMax.toFixed(4)}</td>
              <td>{row.tMin.toFixed(4)}</td>
              <td>{row.n1.toFixed(3)}</td>
              <td>{row.m}</td>
              <td>{row.d.toFixed(0)}</td>
              <td>{row.n2.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => ({ x: 'Wavelength (nm)', y: 'Refractive index n', yValues: true })}
        xName="λ"
        xUnit=" nm"
        exportName="film-refractive-index"
        showOverlayOptions={false}
        points={byLambda.map((row) => ({ x: row.wavelengthNm, y: row.n2 }))}
      />
      <MethodsBox text={swanepoelMethodsText(data, substrate, r)} />
    </>
  );
}
