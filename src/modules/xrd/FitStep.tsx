import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DetectionOptions } from '../../core/xrd/peaks/detect';
import {
  regionValue,
  type FitOptions,
  type PeakGuess,
  type RegionFit,
} from '../../core/xrd/peaks/fit';
import { profile, type ProfileKind } from '../../core/xrd/peaks/profiles';
import { lowerBoundIndex } from '../../core/xrd/peaks/search';
import { missedPeaks } from '../../core/xrd/peaks/missed';
import { peakTable } from '../../core/xrd/peaks/table';
import { ANODES } from '../../core/xrd/radiation';
import { stepStats } from '../../core/xrd/summary';
import { Advanced } from '../../ui/Advanced';
import { NumberInput } from './NumberInput';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel, type PlotInteraction } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { fitInputKey, peaksFor, processingFor, type PeakState, type XrdData } from './data';
import { xrdLabels } from './labels';
import { PeaksClient } from './peaksClient';
import { assignmentFor, peakLabelSet } from './assignment';
import { useCandidatePhases } from './useReferencePhases';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import { PeakTable } from './PeakTable';
import { useProcessed } from './useProcessed';

type Mode = 'pan' | 'add' | 'remove' | 'move';
const MODE_LABELS: Record<Mode, string> = {
  pan: 'Pan and zoom',
  add: 'Add',
  remove: 'Remove',
  move: 'Move',
};
const MODE_HINTS: Record<Mode, string | undefined> = {
  pan: undefined,
  add: 'Click or tap the plot where a peak should be added.',
  remove: 'Click or tap a peak marker to remove it.',
  move: 'Drag a peak marker sideways to move it.',
};
const PROFILE_LABELS: Record<ProfileKind, string> = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'Pseudo-Voigt',
};
const UNDO_LIMIT = 50;

/** Wizard step 5: find peaks, edit them, fit them and tabulate the results. */
export function FitStep({ data, update }: StepContext<XrdData>) {
  const patterns = data.patterns;
  const [selectedId, setSelectedId] = useState(patterns[0]?.id);
  const pattern = patterns.find((p) => p.id === selectedId) ?? patterns[0];
  const processing = pattern ? processingFor(data, pattern.id) : undefined;
  const state = pattern ? peaksFor(data, pattern.id) : undefined;
  const { result: processed } = useProcessed(
    pattern,
    processing ?? processingFor(data, ''),
    data.radiation,
  );

  const { phases } = useCandidatePhases(data.material);
  const [mode, setMode] = useState<Mode>('pan');
  const [dragged, setDragged] = useState<PeakGuess[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [addAt, setAddAt] = useState('');
  // While the prominence slider is dragged: its value and the peaks found with it (not saved yet).
  const [sliding, setSliding] = useState<number | null>(null);
  const [preview, setPreview] = useState<PeakGuess[] | null>(null);
  const slidingRef = useRef(false);
  const client = useRef<PeaksClient | null>(null);
  const history = useRef<PeakState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);

  const x = processed?.twoTheta;
  const y = processed?.intensity;
  const step = useMemo(() => (x ? stepStats(x).median : NaN), [x]);
  const typicalWidth = (guesses: readonly PeakGuess[]) => {
    const widths = guesses.map((g) => g.width).sort((a, b) => a - b);
    return widths[widths.length >> 1] ?? Math.max(10 * step, 0.1);
  };

  const setState = (next: PeakState, remember = true) => {
    if (!pattern || !state) return;
    if (remember) {
      history.current = [...history.current, state].slice(-UNDO_LIMIT);
      setCanUndo(true);
    }
    update({ peaks: { ...data.peaks, [pattern.id]: next } });
  };

  const detect = async (detection: DetectionOptions, remember: boolean) => {
    if (!x || !y || !state || !client.current) return;
    const found = await client.current.detect(x, y, detection);
    if (!found) return;
    setState(
      {
        ...state,
        detection,
        detected: true,
        guesses: found.map((p) => ({ center: p.center, width: p.width })),
      },
      remember,
    );
  };

  // Detect automatically the first time this pattern's processed data are ready.
  useEffect(() => {
    if (state && !state.detected && x && y) void detect(state.detection, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per pattern when data arrive
  }, [pattern?.id, x]);

  if (!pattern || !state || !processing)
    return <p>No patterns are loaded. Go back to Upload to add one.</p>;

  const radiation = data.radiation;
  const lambda = ANODES[radiation.anode].kAlpha1;
  const guesses = dragged ?? preview ?? state.guesses;
  const inputKey = fitInputKey(state.guesses, state.fitOptions, processing, radiation);
  const stale = state.fit !== null && state.fit.inputKey !== inputKey;
  const fitting = progress !== null;
  const kAlpha2Present = !radiation.kAlpha1Only && !processing.kAlpha2.enabled;

  const runFit = async (toFit: PeakGuess[] = state.guesses) => {
    if (!x || !y || !client.current || toFit.length === 0) return;
    setFailed(false);
    setProgress('Starting…');
    const regions = await client.current.fitPeaks(x, y, toFit, state.fitOptions, (done, total) =>
      setProgress(`Fitting region ${done} of ${total}…`),
    );
    setProgress(null);
    if (!regions) {
      setFailed(true);
      return;
    }
    // The fitted peaks become the new starting positions, so editing and re-fitting continues from them.
    const fitted = regions.flatMap((r) =>
      r.peaks.map((p) => ({ center: p.center, width: p.fwhm })),
    );
    const nextGuesses = fitted.length > 0 ? fitted : toFit;
    const key = fitInputKey(nextGuesses, state.fitOptions, processing, radiation);
    setState({ ...state, guesses: nextGuesses, fit: { regions, inputKey: key } });
  };
  const cancelFit = () => {
    client.current?.cancelFit();
    setProgress(null);
  };

  const setGuesses = (next: PeakGuess[]) =>
    setState({ ...state, guesses: [...next].sort((a, b) => a.center - b.center) });
  const addPeak = (center: number) => {
    if (!x || center < (x[0] as number) || center > (x[x.length - 1] as number)) return;
    setGuesses([...state.guesses, { center, width: typicalWidth(state.guesses) }]);
  };
  const setFitOptions = (fitOptions: FitOptions) => setState({ ...state, fitOptions });
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ peaks: { ...data.peaks, [pattern.id]: last } });
  };

  /** Slider moved: show the value and the peaks it finds at once, without saving. */
  const slide = (prominencePercent: number) => {
    if (!x || !y || !client.current) return;
    slidingRef.current = true;
    setSliding(prominencePercent);
    void client.current.detect(x, y, { ...state.detection, prominencePercent }).then((found) => {
      if (found && slidingRef.current)
        setPreview(found.map((p) => ({ center: p.center, width: p.width })));
    });
  };
  /** Slider released: save the peaks found with the final value (one undo step). */
  const endSlide = async (prominencePercent: number) => {
    slidingRef.current = false;
    await detect({ ...state.detection, prominencePercent }, true);
    setSliding(null);
    setPreview(null);
  };

  const missed =
    state.fit && !stale && x && y ? missedPeaks(x, y, state.fit.regions, state.detection) : [];
  // Miller indices on the fitted peaks, from the phases chosen in step 4.
  const assignment =
    state.fit && !stale && phases ? assignmentFor(data, pattern.id, phases, false) : null;
  const hklLabels = assignment ? peakLabelSet(assignment) : undefined;

  const markerY = (center: number) => {
    if (!x || !y) return 0;
    const i = Math.min(x.length - 1, lowerBoundIndex(x, center));
    return y[i] as number;
  };
  const markers = guesses.map((g) => ({ x: g.center, y: markerY(g.center) }));

  const interaction: PlotInteraction = { markers };
  const hint = MODE_HINTS[mode];
  if (hint) interaction.hint = hint;
  if (mode === 'add') interaction.onPlotClick = (cx) => addPeak(cx);
  if (mode === 'remove')
    interaction.onMarkerClick = (i) => setGuesses(state.guesses.filter((_, k) => k !== i));
  if (mode === 'move') {
    interaction.onMarkerDrag = (i, cx) =>
      setDragged((dragged ?? state.guesses).map((g, k) => (k === i ? { ...g, center: cx } : g)));
    interaction.onMarkerDragEnd = () => {
      if (dragged) setGuesses(dragged);
      setDragged(null);
    };
  }

  const rows = state.fit ? peakTable(state.fit.regions, lambda) : [];
  const unit = pattern.intensityUnit === 'counts' ? 'counts' : 'cps';

  return (
    <div class="fit-step">
      <div class="clean-toolbar">
        {patterns.length > 1 && (
          <label class="inline-field">
            Pattern
            <select value={pattern.id} onChange={(e) => setSelectedId(e.currentTarget.value)}>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div class="clean-actions">
          <button type="button" class="btn" onClick={undo} disabled={!canUndo || fitting}>
            Undo
          </button>
        </div>
      </div>
      <p class="field-hint">
        Peaks are found and fitted on the data as cleaned in step 2. Every number in the table is an
        estimate from the fit, with its standard uncertainty.
      </p>
      {processing.smoothing.enabled && (
        <p class="message is-warning">
          <strong>Check:</strong> smoothing is on. It makes neighbouring points depend on each
          other, so the uncertainties (±) below are smaller than the real ones. For reportable
          uncertainties, fit without smoothing.
        </p>
      )}
      {kAlpha2Present && (
        <p class="message is-warning">
          <strong>Check:</strong> Kα2 has not been removed, so each peak is a Kα1 + Kα2 pair. Fitted
          widths will be broader than Kα1 alone. Turn on Kα2 stripping in Clean data, or keep this
          in mind.
        </p>
      )}

      <section class="process-step is-on" aria-labelledby="find-title">
        <h3 id="find-title" class="process-step-title">
          Find peaks
        </h3>
        <div class="process-step-body">
          <label class="inline-field slider-field">
            <span>
              Minimum prominence: <output>{sliding ?? state.detection.prominencePercent} %</output>{' '}
              <HelpTip term="prominence">
                <p>
                  How far a peak stands above the lowest points separating it from taller
                  neighbours, as a percentage of the whole intensity range. Raise it to ignore
                  noise; lower it to find weak peaks.
                </p>
              </HelpTip>
            </span>
            <input
              type="range"
              aria-label="Minimum prominence"
              min={0.5}
              max={30}
              step={0.5}
              value={sliding ?? state.detection.prominencePercent}
              disabled={fitting}
              onInput={(e) => slide(Number(e.currentTarget.value))}
              onChange={(e) => void endSlide(Number(e.currentTarget.value))}
            />
          </label>
          <Advanced id="xrd-noise-filter" title="Separation and noise filter">
            <p class="field-hint">
              A peak must stand out from the local noise (estimated from the point-to-point scatter)
              and be several data steps wide; counting spikes are one step wide. The defaults gave
              no false peaks on simulated pure-noise scans. Lower them to find weak peaks, and check
              each one by eye.
            </p>
            <div class="radiation-fields">
              <label class="inline-field">
                Minimum separation (°)
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={5}
                  step={0.01}
                  value={state.detection.minSeparationDeg}
                  disabled={fitting}
                  onChange={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value >= 0 && value <= 5)
                      void detect({ ...state.detection, minSeparationDeg: value }, true);
                  }}
                />
              </label>
              <NumberInput
                label="Minimum signal-to-noise (prominence ÷ noise)"
                value={state.detection.minSnr}
                max={50}
                step={0.5}
                onChange={(v) =>
                  v !== null &&
                  v >= 0 &&
                  !fitting &&
                  void detect({ ...state.detection, minSnr: v }, true)
                }
              />
              <NumberInput
                label="Minimum width (data steps)"
                value={state.detection.minWidthSteps}
                max={50}
                step={0.5}
                onChange={(v) =>
                  v !== null &&
                  v >= 0 &&
                  !fitting &&
                  void detect({ ...state.detection, minWidthSteps: v }, true)
                }
              />
            </div>
          </Advanced>
          <p class="field-hint">
            {guesses.length} peak{guesses.length === 1 ? '' : 's'}. Changing these settings finds
            peaks again and replaces your edits (Undo brings them back).
          </p>
        </div>
      </section>

      <section class="process-step is-on" aria-labelledby="edit-title">
        <h3 id="edit-title" class="process-step-title">
          Edit peaks
        </h3>
        <div class="process-step-body">
          <fieldset class="segmented">
            <legend>On the plot</legend>
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m} class={mode === m ? 'is-selected' : undefined}>
                <input
                  type="radio"
                  name="fit-mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {MODE_LABELS[m]}
              </label>
            ))}
          </fieldset>
          <div class="edit-peak-actions">
            <button
              type="button"
              class="btn"
              onClick={() => void detect(state.detection, true)}
              disabled={fitting || !x}
            >
              Find peaks automatically
            </button>
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() => setGuesses([])}
              disabled={guesses.length === 0 || fitting}
            >
              Remove all peaks
            </button>
          </div>
          <p class="field-hint">
            "Find peaks automatically" replaces the peaks with those found by the settings above
            (Undo brings your edits back). After a fit, peaks the fit seems to miss are suggested
            under the plot.
          </p>
          <Advanced id="xrd-add-peak" title="Add a peak by its position">
            <form
              class="add-peak"
              onSubmit={(e) => {
                e.preventDefault();
                const value = Number(addAt);
                if (Number.isFinite(value)) addPeak(value);
                setAddAt('');
              }}
            >
              <label class="inline-field">
                Add a peak at 2θ (°)
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={addAt}
                  onInput={(e) => setAddAt(e.currentTarget.value)}
                />
              </label>
              <button type="submit" class="btn" disabled={addAt === '' || fitting}>
                Add
              </button>
            </form>
          </Advanced>
        </div>
      </section>

      <section class="process-step is-on" aria-labelledby="shape-title">
        <h3 id="shape-title" class="process-step-title">
          Peak shape{' '}
          <HelpTip term="the peak shape">
            <p>
              Gaussian peaks have short tails; Lorentzian peaks have long tails. Pseudo-Voigt mixes
              the two, with η the Lorentzian fraction (0 = Gaussian, 1 = Lorentzian). Each fit
              region also has its own straight background line.
            </p>
          </HelpTip>
        </h3>
        <div class="process-step-body">
          <fieldset class="method-choice">
            <legend>Profile</legend>
            {(Object.keys(PROFILE_LABELS) as ProfileKind[]).map((kind) => (
              <label key={kind} class="check">
                <input
                  type="radio"
                  name="fit-profile"
                  checked={state.fitOptions.profile === kind}
                  disabled={fitting}
                  onChange={() => setFitOptions({ ...state.fitOptions, profile: kind })}
                />
                {PROFILE_LABELS[kind]}
              </label>
            ))}
          </fieldset>
          {state.fitOptions.profile === 'pseudo-voigt' && (
            <>
              <label class="check">
                <input
                  type="checkbox"
                  checked={state.fitOptions.fixedEta !== null}
                  disabled={fitting}
                  onChange={(e) =>
                    setFitOptions({
                      ...state.fitOptions,
                      fixedEta: e.currentTarget.checked ? 0.5 : null,
                    })
                  }
                />
                Fix η
              </label>
              {state.fitOptions.fixedEta !== null && (
                <label class="inline-field">
                  η (0 to 1)
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={1}
                    step={0.05}
                    value={state.fitOptions.fixedEta}
                    onChange={(e) => {
                      const value = Number(e.currentTarget.value);
                      if (value >= 0 && value <= 1)
                        setFitOptions({ ...state.fitOptions, fixedEta: value });
                    }}
                  />
                </label>
              )}
            </>
          )}
        </div>
      </section>

      <div class="fit-actions">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void runFit()}
          disabled={fitting || guesses.length === 0 || !x}
        >
          {state.fit ? 'Fit again' : 'Fit peaks'}
        </button>
        {fitting && (
          <button type="button" class="btn" onClick={cancelFit}>
            Cancel
          </button>
        )}
        <p class="process-status" role="status">
          {progress ??
            (failed
              ? 'The fit stopped before finishing.'
              : stale
                ? 'The results below are out of date. Fit again to update them.'
                : '')}
        </p>
      </div>

      {x && y && (
        <FitPlot
          data={data}
          update={update}
          x={x}
          y={y}
          regions={state.fit?.regions ?? []}
          unit={unit}
          name={pattern.name}
          interaction={interaction}
          {...(hklLabels && { peakLabels: hklLabels })}
        />
      )}
      {state.fit && !stale && !assignment && (
        <p class="field-hint">
          Choose a phase in step 4 ("Use this phase") and the fitted peaks are labelled with their
          Miller indices (hkl) here and in the exported figure. Edit the labels under "Edit figure".
        </p>
      )}

      {missed.length > 0 && !fitting && (
        <div class="message is-warning missed-peaks" role="status">
          <p>
            <strong>Check:</strong> the residual has {missed.length === 1 ? 'a hump' : 'humps'} at{' '}
            {missed.map((p) => `${p.center.toFixed(2)}°`).join(', ')} that{' '}
            {missed.length === 1 ? 'looks like a peak' : 'look like peaks'} the fit leaves out. An
            unfitted peak tilts the straight background of its region and distorts the neighbouring
            peaks.
          </p>
          <button
            type="button"
            class="btn"
            onClick={() => {
              const next = [
                ...state.guesses,
                ...missed.map((p) => ({ center: p.center, width: p.width })),
              ].sort((a, b) => a.center - b.center);
              setGuesses(next);
              void runFit(next);
            }}
          >
            Add {missed.length === 1 ? 'it' : `these ${missed.length}`} and fit again
          </button>
        </div>
      )}

      {state.fit && (
        <>
          <RegionSummary regions={state.fit.regions} />
          <PeakTable
            rows={rows}
            regions={state.fit.regions}
            intensityUnit={unit}
            lambda={lambda}
            patternName={pattern.name}
          />
        </>
      )}
    </div>
  );
}

function RegionSummary({ regions }: { regions: readonly RegionFit[] }) {
  return (
    <section class="region-summary" aria-labelledby="regions-title">
      <h3 id="regions-title" class="export-title">
        Fit regions{' '}
        <HelpTip term="R²">
          <p>
            R² (coefficient of determination) is 1 minus the sum of squared residuals divided by the
            total variation of the data in the region. 1 is a perfect fit. A high R² alone does not
            prove the model is right; check the residual plot for leftover structure.
          </p>
          <p>
            χ²ν (reduced chi-squared) compares the scatter of the residual with the noise of the
            data, estimated from the point-to-point scatter: about 1 means the model fits to within
            the noise; above 4 (residual more than twice the noise) means it misses real structure.
            Smoothing makes the noise look smaller, so χ²ν is only meaningful on unsmoothed data.
          </p>
        </HelpTip>
      </h3>
      <ul class="region-list">
        {regions.map((r, i) => (
          <li key={i}>
            <span class="region-range">
              {r.start.toFixed(2)}–{r.end.toFixed(2)}°
            </span>{' '}
            {r.peaks.length} peak{r.peaks.length === 1 ? '' : 's'}, R² ={' '}
            {Number.isFinite(r.rSquared) ? r.rSquared.toFixed(4) : '–'}, χ²ν ={' '}
            {Number.isFinite(r.reducedChiSquared) ? r.reducedChiSquared.toFixed(2) : '–'}
            {r.messages.map((m, k) => (
              <span key={k} class={`message is-${m.level}`}>
                {' '}
                {m.text}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface FitPlotProps extends StepContext<XrdData> {
  x: Float64Array;
  y: Float64Array;
  regions: readonly RegionFit[];
  unit: string;
  name: string;
  interaction: PlotInteraction;
  /** Labels on the peaks, for example their Miller indices. */
  peakLabels?: PeakLabelSet;
}

/** Data with the fitted total, components and residual. Also used for the instrument standard. */
export function FitPlot(props: FitPlotProps) {
  const { data, update, x, y, regions, unit, name, interaction, peakLabels } = props;
  const { sources, residual } = useMemo(() => {
    const total = new Float64Array(x.length).fill(NaN);
    const resid = new Float64Array(x.length).fill(NaN);
    const list: SeriesSource[] = [{ id: 'data', name: 'Data', x, y, unit, colorIndex: 7 }];
    const components: SeriesSource[] = [];
    const backgrounds: SeriesSource[] = [];
    regions.forEach((region, r) => {
      const i0 = lowerBoundIndex(x, region.start);
      const i1 = lowerBoundIndex(x, region.end + 1e-12);
      const xs = x.subarray(i0, i1);
      for (let i = i0; i < i1; i++) {
        total[i] = regionValue(region, x[i] as number);
        resid[i] = (y[i] as number) - (total[i] as number);
      }
      const bg = (v: number) =>
        region.background.intercept + region.background.slope * (v - region.background.pivot);
      backgrounds.push({
        id: `background-${r}`,
        name: 'Local background',
        x: xs,
        y: xs.map(bg),
        unit,
        colorIndex: 2,
        dashed: true,
        quiet: backgrounds.length > 0,
      });
      // Each component is drawn on the background only where it stands out (above 1 % of its
      // height): drawn over the whole region, every component's tails would lie on the
      // background line and look like extra straight lines.
      region.peaks.forEach((peak, p) => {
        const cut = 0.01 * peak.height;
        components.push({
          id: `component-${r}-${p}`,
          name: 'Components',
          x: xs,
          y: xs.map((v) => {
            const value = profile(v, peak);
            return value >= cut ? bg(v) + value : NaN;
          }),
          unit,
          colorIndex: 1,
          dashed: true,
          quiet: components.length > 0,
        });
      });
    });
    if (regions.length > 0)
      list.push({ id: 'fit', name: 'Total fit', x, y: total, unit, colorIndex: 0 });
    return {
      sources: [...list, ...components, ...backgrounds],
      residual:
        regions.length > 0
          ? { id: 'residual', name: 'Residual', x, y: resid, unit, colorIndex: 0 }
          : undefined,
    };
  }, [x, y, regions, unit]);

  return (
    <PlotPanel
      sources={sources}
      settings={data.plot}
      onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
      labels={xrdLabels}
      xName="2θ"
      xUnit="°"
      exportName={`${name}-fit`}
      showOverlayOptions={false}
      interaction={interaction}
      {...(residual && { residual })}
      {...(peakLabels && { peakLabels })}
    />
  );
}
