import { useEffect, useRef, useState } from 'preact/hooks';
import type { CurveKind } from '../../core/xrd/instrument/curve';
import type { ProfileKind } from '../../core/xrd/peaks/profiles';
import { exampleStandard } from '../../core/xrd/synthetic';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import {
  DEFAULT_PEAK_STATE,
  fitInputKey,
  newId,
  type InstrumentState,
  type StandardState,
  type XrdData,
} from './data';
import { FitPlot } from './FitStep';
import { importInWorker } from './importClient';
import { standardPoints, standardProcessing } from './instrument';
import { PeaksClient } from './peaksClient';
import { useProcessed } from './useProcessed';

const MATERIAL_LABELS: Record<StandardState['material'], string> = {
  LaB6: 'LaB₆',
  Si: 'Si',
  other: 'Other',
};
const PROFILE_LABELS: Record<ProfileKind, string> = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'Pseudo-Voigt (η free)',
};
export const CURVE_LABELS: Record<CurveKind, string> = {
  caglioti: 'Caglioti (U, V, W)',
  linear: 'Straight line',
  quadratic: 'Quadratic',
};

interface StandardPanelProps extends StepContext<XrdData> {
  setInstrument: (patch: Partial<InstrumentState>) => void;
}

/** Load, clean and fit a line-profile standard, then pick the points and curve for the instrument width. */
export function StandardPanel({ data, update, setInstrument }: StandardPanelProps) {
  const standard = data.instrument.standard;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setStandard = (patch: Partial<StandardState>) =>
    standard && setInstrument({ standard: { ...standard, ...patch } });
  const start = (pattern: StandardState['pattern']) =>
    setInstrument({
      standard: {
        pattern,
        material: standard?.material ?? 'LaB6',
        processing: standardProcessing(data.radiation),
        peaks: DEFAULT_PEAK_STATE,
        excluded: [],
        curve: 'caglioti',
      },
    });

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await importInWorker({ kind: 'file', file });
    setBusy(false);
    if (result.ok) start({ ...result.pattern, id: newId() });
    else setError(result.error);
  };
  const loadExample = () => {
    const example = exampleStandard(data.radiation.kAlpha1Only);
    start({
      id: newId(),
      name: example.name,
      source: 'synthetic',
      twoTheta: example.twoTheta,
      intensity: example.intensity,
      intensityUnit: 'counts',
      unitOrigin: 'generated',
      synthetic: true,
      notes: [],
    });
  };

  const chooser = (
    <div class="upload-actions">
      <button
        type="button"
        class="btn btn-primary"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
      >
        {standard ? 'Replace standard' : 'Choose standard file'}
      </button>
      <input
        ref={fileInput}
        type="file"
        class="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void load(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <button type="button" class="btn" onClick={loadExample} disabled={busy}>
        Try with example standard
      </button>
      {standard && (
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => setInstrument({ standard: null })}
        >
          Remove standard
        </button>
      )}
      {busy && <span class="process-status">Reading the file…</span>}
    </div>
  );

  return (
    <div class="standard-panel">
      <p class="field-hint">
        Measure a line-profile standard (a powder whose own peaks are very sharp, such as LaB₆ or
        Si) on the same instrument with the same slits, optics and step as your sample. Its peak
        widths are then almost entirely the instrument&apos;s. The same file formats as Upload are
        accepted.
      </p>
      {chooser}
      {error && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {error}
        </p>
      )}
      {standard && (
        <StandardFit data={data} update={update} standard={standard} setStandard={setStandard} />
      )}
    </div>
  );
}

interface StandardFitProps extends StepContext<XrdData> {
  standard: StandardState;
  setStandard: (patch: Partial<StandardState>) => void;
}

function StandardFit({ data, update, standard, setStandard }: StandardFitProps) {
  const { result: processed } = useProcessed(standard.pattern, standard.processing, data.radiation);
  const client = useRef<PeaksClient | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);
  const x = processed?.twoTheta;
  const y = processed?.intensity;
  const peaks = standard.peaks;

  const detect = async (prominencePercent: number) => {
    if (!x || !y || !client.current) return;
    const detection = { ...peaks.detection, prominencePercent };
    const found = await client.current.detect(x, y, detection);
    if (!found) return;
    setStandard({
      peaks: {
        ...peaks,
        detection,
        detected: true,
        guesses: found.map((p) => ({ center: p.center, width: p.width })),
      },
    });
  };
  useEffect(() => {
    if (!peaks.detected && x) void detect(peaks.detection.prominencePercent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per standard when data arrive
  }, [standard.pattern.id, x]);

  const inputKey = fitInputKey(
    peaks.guesses,
    peaks.fitOptions,
    standard.processing,
    data.radiation,
  );
  const stale = peaks.fit !== null && peaks.fit.inputKey !== inputKey;
  const fit = async () => {
    if (!x || !y || !client.current || peaks.guesses.length === 0) return;
    setProgress('Starting…');
    const regions = await client.current.fitPeaks(
      x,
      y,
      peaks.guesses,
      peaks.fitOptions,
      (done, total) => setProgress(`Fitting region ${done} of ${total}…`),
    );
    setProgress(null);
    if (!regions) return;
    const guesses = regions.flatMap((r) =>
      r.peaks.map((p) => ({ center: p.center, width: p.fwhm })),
    );
    const next = guesses.length > 0 ? guesses : peaks.guesses;
    setStandard({
      excluded: [],
      peaks: {
        ...peaks,
        guesses: next,
        fit: {
          regions,
          inputKey: fitInputKey(next, peaks.fitOptions, standard.processing, data.radiation),
        },
      },
    });
  };

  const points = standardPoints(standard);
  const processing = standard.processing;
  const setProcessing = (patch: Partial<typeof processing>) =>
    setStandard({ processing: { ...processing, ...patch } });
  const fitting = progress !== null;

  return (
    <>
      <p class="field-hint">
        <strong>{standard.pattern.name}</strong>, {standard.pattern.twoTheta.length} points.
      </p>
      {standard.pattern.synthetic && (
        <p class="message is-warning">
          <strong>Note:</strong> this standard is generated: its peak widths follow a chosen
          Caglioti curve (U = 0.01, V = −0.004, W = 0.003 deg²). It is not a measurement of LaB₆, Si
          or any real instrument.
        </p>
      )}
      <label class="inline-field">
        Material
        <select
          value={standard.material}
          onChange={(e) =>
            setStandard({ material: e.currentTarget.value as StandardState['material'] })
          }
        >
          {(Object.keys(MATERIAL_LABELS) as StandardState['material'][]).map((m) => (
            <option key={m} value={m}>
              {MATERIAL_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <fieldset class="method-choice">
        <legend>Cleaning the standard</legend>
        <label class="check">
          <input
            type="checkbox"
            checked={processing.background.enabled}
            disabled={fitting}
            onChange={(e) =>
              setProcessing({
                background: { ...processing.background, enabled: e.currentTarget.checked },
              })
            }
          />
          Remove background (SNIP, {processing.background.snipWidthDeg}°)
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={processing.kAlpha2.enabled}
            disabled={fitting || data.radiation.kAlpha1Only}
            onChange={(e) => setProcessing({ kAlpha2: { enabled: e.currentTarget.checked } })}
          />
          Strip Kα2
        </label>
      </fieldset>

      <label class="inline-field slider-field">
        <span>
          Minimum prominence: <output>{peaks.detection.prominencePercent} %</output>
        </span>
        <input
          type="range"
          min={0.5}
          max={30}
          step={0.5}
          value={peaks.detection.prominencePercent}
          disabled={fitting}
          onChange={(e) => void detect(Number(e.currentTarget.value))}
        />
      </label>

      <fieldset class="method-choice">
        <legend>Peak shape for the standard</legend>
        {(Object.keys(PROFILE_LABELS) as ProfileKind[]).map((kind) => (
          <label key={kind} class="check">
            <input
              type="radio"
              name="standard-profile"
              checked={peaks.fitOptions.profile === kind}
              disabled={fitting}
              onChange={() =>
                setStandard({ peaks: { ...peaks, fitOptions: { profile: kind, fixedEta: null } } })
              }
            />
            {PROFILE_LABELS[kind]}
          </label>
        ))}
      </fieldset>
      <p class="field-hint">
        Use the same peak shape as for your sample, so both widths are measured the same way.
      </p>

      <div class="fit-actions">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void fit()}
          disabled={fitting || !x || peaks.guesses.length === 0}
        >
          {peaks.fit ? 'Fit standard again' : 'Fit standard peaks'}
        </button>
        {fitting && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              client.current?.cancelFit();
              setProgress(null);
            }}
          >
            Cancel
          </button>
        )}
        <p class="process-status" role="status">
          {progress ??
            (!peaks.detected
              ? 'Finding peaks…'
              : `${peaks.guesses.length} peak${peaks.guesses.length === 1 ? '' : 's'} found.${
                  stale ? ' The standard fit is out of date. Fit again to update it.' : ''
                }`)}
        </p>
      </div>

      {x && y && (
        <FitPlot
          data={data}
          update={update}
          x={x}
          y={y}
          regions={peaks.fit?.regions ?? []}
          unit={standard.pattern.intensityUnit}
          name={standard.pattern.name}
          interaction={{ markers: [] }}
        />
      )}

      {points.length > 0 && (
        <>
          <fieldset class="method-choice">
            <legend>
              Smooth curve through the widths{' '}
              <HelpTip term="the instrument curve">
                <p>
                  Caglioti: FWHM² = U tan²θ + V tanθ + W, the usual form for a laboratory
                  diffractometer. A straight line or quadratic in 2θ is a simple alternative when
                  Caglioti does not follow the points. Each needs at least 3 (straight line: 2)
                  peaks spread across the range.
                </p>
              </HelpTip>
            </legend>
            {(Object.keys(CURVE_LABELS) as CurveKind[]).map((kind) => (
              <label key={kind} class="check">
                <input
                  type="radio"
                  name="standard-curve"
                  checked={standard.curve === kind}
                  onChange={() => setStandard({ curve: kind })}
                />
                {CURVE_LABELS[kind]}
              </label>
            ))}
          </fieldset>
          <div class="table-scroll" tabIndex={0} role="region" aria-label="Standard peaks">
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">Use</th>
                  <th scope="col">2θ (°)</th>
                  <th scope="col">FWHM (°)</th>
                  <th scope="col">η</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={p.included}
                          onChange={(e) =>
                            setStandard({
                              excluded: e.currentTarget.checked
                                ? standard.excluded.filter((k) => k !== i)
                                : [...standard.excluded, i],
                            })
                          }
                        />
                        <span class="visually-hidden">
                          Use the peak at {p.twoTheta.toFixed(2)}°
                        </span>
                      </label>
                    </td>
                    <td>{p.twoTheta.toFixed(3)}</td>
                    <td>{formatWithSigma(p.fwhm, p.fwhmSigma)}</td>
                    <td>{p.eta.toFixed(2)}</td>
                    <td class="peak-notes">{peakNotes(standard, i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="field-hint">
            Untick a peak to leave it out of the curve, for example a weak peak, an overlap, or an
            impurity.
          </p>
        </>
      )}
    </>
  );
}

function peakNotes(standard: StandardState, index: number): string {
  const peak = standard.peaks.fit?.regions.flatMap((r) => r.peaks)[index];
  return peak?.messages.map((m) => m.text).join(' ') ?? '';
}
