import { useMemo, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import {
  DEFAULT_PROCESSING,
  type BackgroundMethod,
  type ProcessingResult,
  type ProcessingSettings,
  type ProcessingStep,
} from '../../core/xrd/process/pipeline';
import {
  ANODES,
  DEFAULT_RADIATION,
  type Anode,
  type RadiationSettings,
} from '../../core/xrd/radiation';
import { stepStats } from '../../core/xrd/summary';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { processingFor, type XrdData } from './data';
import { xrdLabels } from './labels';
import { useProcessed } from './useProcessed';
import { StepSection } from './StepSection';

type View = 'after' | 'before' | 'both';
const VIEW_LABELS: Record<View, string> = {
  after: 'After',
  before: 'Before',
  both: 'Before and after',
};
const METHOD_LABELS: Record<BackgroundMethod, string> = {
  arpls: 'arPLS (automatic, recommended)',
  snip: 'SNIP (automatic)',
  polynomial: 'Iterative polynomial (automatic)',
  manual: 'Manual points',
};
const UNDO_LIMIT = 50;

/** Value equality for small settings objects. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Snapshot {
  processing: Record<string, ProcessingSettings>;
  radiation: RadiationSettings;
}

/** Wizard step 2: optional, reversible preprocessing of each pattern. */
export function CleanStep({ data, update }: StepContext<XrdData>) {
  const patterns = data.patterns;
  const [selectedId, setSelectedId] = useState(patterns[0]?.id);
  const pattern = patterns.find((p) => p.id === selectedId) ?? patterns[0];
  const settings = pattern ? processingFor(data, pattern.id) : DEFAULT_PROCESSING;
  const radiation = data.radiation;

  const [view, setView] = useState<View>('both');
  const { result: shown, busy } = useProcessed(pattern, settings, radiation);
  const history = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  if (!pattern) return <p>No patterns are loaded. Go back to Upload to add one.</p>;

  // Every change is one undo step. All controls commit discrete values (no live sliders).
  const remember = () => {
    history.current = [...history.current, { processing: data.processing, radiation }].slice(
      -UNDO_LIMIT,
    );
    setCanUndo(true);
  };
  const setSettings = (next: ProcessingSettings) => {
    remember();
    update({ processing: { ...data.processing, [pattern.id]: next } });
  };
  const patch = <K extends ProcessingStep>(step: K, value: Partial<ProcessingSettings[K]>) =>
    setSettings({ ...settings, [step]: { ...settings[step], ...value } });
  const setRadiation = (value: Partial<RadiationSettings>) => {
    remember();
    update({ radiation: { ...radiation, ...value } });
  };
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ processing: last.processing, radiation: last.radiation });
  };
  const resetStep = (step: ProcessingStep) => patch(step, DEFAULT_PROCESSING[step]);
  const applyToAll = () => {
    remember();
    const processing = { ...data.processing };
    for (const p of patterns) {
      if (p.id === pattern.id) continue;
      // Anchor points belong to one pattern's background, so they are not copied.
      const own = processingFor(data, p.id);
      processing[p.id] = {
        ...settings,
        background: { ...settings.background, anchors: own.background.anchors },
      };
    }
    update({ processing });
  };

  const step = stepStats(pattern.twoTheta);
  const lines = ANODES[radiation.anode];
  const manual = settings.background.enabled && settings.background.method === 'manual';
  const placing = manual && view !== 'after';
  const fileWavelength = pattern.wavelengthFromFileA;
  const wavelengthMismatch =
    fileWavelength !== undefined &&
    !radiation.kAlpha1Only &&
    Math.abs(fileWavelength - lines.kAlpha1) > 0.0005;

  return (
    <div class="clean-step">
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
          <button type="button" class="btn" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => setSettings(DEFAULT_PROCESSING)}
            disabled={same(settings, DEFAULT_PROCESSING)}
          >
            Reset all steps
          </button>
          {patterns.length > 1 && (
            <button type="button" class="btn" onClick={applyToAll}>
              Use these settings for all patterns
            </button>
          )}
        </div>
      </div>
      <p class="field-hint">
        Every step is optional and can be switched off again at any time. Your original data are
        never changed.
      </p>

      <section class="process-step radiation" aria-labelledby="radiation-title">
        <h3 id="radiation-title" class="process-step-title">
          Radiation{' '}
          <HelpTip term="the radiation setting">
            <p>
              The X-ray tube anode sets the wavelength. Most tubes emit two close lines, Kα1 and the
              weaker Kα2, so each peak is really a pair. The wavelengths are used for Kα2 stripping
              here and for later calculations.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Anode
            <select
              value={radiation.anode}
              onChange={(e) => setRadiation({ anode: e.currentTarget.value as Anode })}
            >
              {(Object.keys(ANODES) as Anode[]).map((anode) => (
                <option key={anode} value={anode}>
                  {anode} Kα
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={radiation.kAlpha1Only}
              onChange={(e) => setRadiation({ kAlpha1Only: e.currentTarget.checked })}
            />
            Data contain Kα1 only (monochromator)
          </label>
          {!radiation.kAlpha1Only && (
            <label class="inline-field">
              Kα2/Kα1 intensity ratio
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.01}
                value={radiation.kAlpha2Ratio}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (value >= 0 && value <= 1) setRadiation({ kAlpha2Ratio: value });
                }}
              />
            </label>
          )}
          {!same(radiation, DEFAULT_RADIATION) && (
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() => setRadiation(DEFAULT_RADIATION)}
            >
              Reset<span class="visually-hidden"> radiation</span>
            </button>
          )}
        </div>
        <p class="field-hint">
          λ(Kα1) = {lines.kAlpha1} Å{!radiation.kAlpha1Only && <>, λ(Kα2) = {lines.kAlpha2} Å</>}.
          Source: {lines.source}
          {lines.source === 'Hölzer 1997'
            ? ' (Phys. Rev. A 56, 4554).'
            : '. Not yet checked against International Tables for Crystallography.'}
        </p>
        {wavelengthMismatch && (
          <p class="message is-warning">
            <strong>Check:</strong> the file says Kα1 = {formatNumber(fileWavelength, 6)} Å, which
            differs from {radiation.anode} Kα1. Check that the anode is right.
          </p>
        )}
      </section>

      <StepSection
        id="zero"
        title="Zero shift"
        description="Moves the whole pattern along 2θ to correct a known instrument or sample-height offset, for example one found by measuring a standard reference sample on the same instrument. Corrected 2θ = measured 2θ − shift."
        enabled={settings.zeroShift.enabled}
        onToggle={(enabled) => patch('zeroShift', { enabled })}
        onReset={() => resetStep('zeroShift')}
        messages={shown?.messages.zeroShift}
      >
        <label class="inline-field">
          Shift (°)
          <input
            type="number"
            inputMode="decimal"
            step={0.001}
            value={settings.zeroShift.shiftDeg}
            onChange={(e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value) && Math.abs(value) <= 5)
                patch('zeroShift', { shiftDeg: value });
            }}
          />
        </label>
      </StepSection>

      <StepSection
        id="smoothing"
        title="Smoothing"
        description="Savitzky–Golay smoothing fits a small polynomial through each group of neighbouring points. It reduces noise while keeping peak heights and positions much better than a simple moving average. Use the smallest window that makes the noise acceptable."
        enabled={settings.smoothing.enabled}
        onToggle={(enabled) => patch('smoothing', { enabled })}
        onReset={() => resetStep('smoothing')}
        messages={shown?.messages.smoothing}
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
        <p class="field-hint">
          The window spans {formatNumber(settings.smoothing.window * step.median, 3)}°.
        </p>
      </StepSection>

      <StepSection
        id="background"
        title="Background removal"
        description="Estimates the smooth background under the peaks (from air scatter, fluorescence or amorphous material) and subtracts it. The estimated background is drawn as a dashed line over the original data."
        enabled={settings.background.enabled}
        onToggle={(enabled) => patch('background', { enabled })}
        onReset={() => resetStep('background')}
        messages={shown?.messages.background}
      >
        <fieldset class="method-choice">
          <legend>Method</legend>
          {(Object.keys(METHOD_LABELS) as BackgroundMethod[]).map((method) => (
            <label key={method} class="check">
              <input
                type="radio"
                name="background-method"
                checked={settings.background.method === method}
                onChange={() => patch('background', { method })}
              />
              {METHOD_LABELS[method]}
            </label>
          ))}
        </fieldset>
        {settings.background.method === 'arpls' && (
          <>
            <p class="field-hint">
              Asymmetrically reweighted penalised least squares: a smooth curve that follows the
              points within the noise band and ignores points well above it (peaks). The width sets
              how slowly the background may change: variations shorter than about this width are
              treated as peaks. In tests with known backgrounds it gave the smallest error of the
              methods offered here (see About).
            </p>
            <label class="inline-field">
              Width (°)
              <input
                type="number"
                inputMode="decimal"
                min={0.5}
                max={40}
                step={0.5}
                value={settings.background.arplsWidthDeg}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (value >= 0.5 && value <= 40) patch('background', { arplsWidthDeg: value });
                }}
              />
            </label>
          </>
        )}
        {settings.background.method === 'snip' && (
          <>
            <p class="field-hint">
              SNIP repeatedly clips the data from above, so peaks are cut off and the slowly varying
              background remains. Set the width to about the width of your broadest peak.
            </p>
            <label class="inline-field">
              Width (°)
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                max={20}
                step={0.1}
                value={settings.background.snipWidthDeg}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (value >= 0.1 && value <= 20) patch('background', { snipWidthDeg: value });
                }}
              />
            </label>
          </>
        )}
        {settings.background.method === 'polynomial' && (
          <>
            <p class="field-hint">
              Fits a smooth polynomial, lowers every point above it to the curve, and repeats until
              it settles under the peaks. A higher degree follows a curved background more closely
              but can dip into broad peaks.
            </p>
            <label class="inline-field">
              Degree
              <select
                value={settings.background.degree}
                onChange={(e) => patch('background', { degree: Number(e.currentTarget.value) })}
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
        {settings.background.method === 'manual' && (
          <>
            <p class="field-hint">
              {view === 'after'
                ? 'Switch the view to Before or Before and after, then click or tap the plot where the background should pass.'
                : 'Click or tap the plot where the background should pass, away from peaks. A smooth curve is drawn through the points.'}
            </p>
            {settings.background.anchors.length > 0 && (
              <ul class="anchor-list" aria-label="Background points">
                {[...settings.background.anchors]
                  .sort((a, b) => a[0] - b[0])
                  .map((anchor) => (
                    <li key={`${anchor[0]}-${anchor[1]}`}>
                      <button
                        type="button"
                        class="btn btn-quiet anchor-chip"
                        onClick={() =>
                          patch('background', {
                            anchors: settings.background.anchors.filter((a) => a !== anchor),
                          })
                        }
                      >
                        {formatNumber(anchor[0], 2)}°<span aria-hidden="true"> ×</span>
                        <span class="visually-hidden"> remove this point</span>
                      </button>
                    </li>
                  ))}
                <li>
                  <button
                    type="button"
                    class="btn btn-quiet"
                    onClick={() => patch('background', { anchors: [] })}
                  >
                    Clear all points
                  </button>
                </li>
              </ul>
            )}
          </>
        )}
      </StepSection>

      <StepSection
        id="kalpha2"
        title="Kα2 stripping"
        description="Removes the weaker Kα2 copy of every peak (Rachinger method), leaving Kα1 peaks only. It assumes both lines have the same shape and the ratio set above. It does not reduce noise, and works best after background removal."
        enabled={settings.kAlpha2.enabled && !radiation.kAlpha1Only}
        onToggle={(enabled) => patch('kAlpha2', { enabled })}
        onReset={() => resetStep('kAlpha2')}
        messages={shown?.messages.kAlpha2}
        unavailable={radiation.kAlpha1Only ? 'Not needed: the data contain Kα1 only.' : undefined}
      />

      <StepSection
        id="normalise"
        title="Normalisation"
        description="Scales the processed pattern so its highest point equals 1 or 100. Useful for comparing patterns; it does not change peak positions or relative heights."
        enabled={settings.normalise.enabled}
        onToggle={(enabled) => patch('normalise', { enabled })}
        onReset={() => resetStep('normalise')}
        messages={shown?.messages.normalise}
      >
        <label class="inline-field">
          Highest point
          <select
            value={settings.normalise.target}
            onChange={(e) =>
              patch('normalise', { target: Number(e.currentTarget.value) as 1 | 100 })
            }
          >
            <option value={100}>100</option>
            <option value={1}>1</option>
          </select>
        </label>
      </StepSection>

      <div class="clean-view">
        <fieldset class="segmented">
          <legend>Show</legend>
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <label key={v} class={view === v ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="clean-view"
                checked={view === v}
                onChange={() => setView(v)}
              />
              {VIEW_LABELS[v]}
            </label>
          ))}
        </fieldset>
        {view === 'both' && settings.normalise.enabled && (
          <p class="field-hint clean-view-note">
            The processed pattern is normalised, so it is on a different scale from the original.
            Choose After to see it in full.
          </p>
        )}
        <p class="process-status" role="status">
          {busy ? 'Updating…' : ''}
        </p>
      </div>

      <CleanPlot
        data={data}
        update={update}
        patternId={pattern.id}
        original={{ x: pattern.twoTheta, y: pattern.intensity }}
        result={shown}
        view={view}
        unit={pattern.intensityUnit === 'counts' ? 'counts' : 'cps'}
        name={pattern.name}
        anchors={manual ? settings.background.anchors : []}
        onAddAnchor={
          placing
            ? (x, y) => patch('background', { anchors: [...settings.background.anchors, [x, y]] })
            : undefined
        }
      />
    </div>
  );
}

interface CleanPlotProps extends StepContext<XrdData> {
  patternId: string;
  original: { x: Float64Array; y: Float64Array };
  result: ProcessingResult | null;
  view: View;
  unit: string;
  name: string;
  anchors: readonly [number, number][];
  onAddAnchor: ((x: number, y: number) => void) | undefined;
}

function CleanPlot(props: CleanPlotProps) {
  const { data, update, patternId, original, result, view, unit, name, anchors, onAddAnchor } =
    props;
  const sources = useMemo(() => {
    const list: SeriesSource[] = [];
    if (view !== 'after' || !result) {
      list.push({
        id: `${patternId}-original`,
        name: 'Original',
        x: original.x,
        y: original.y,
        unit,
        colorIndex: 7,
      });
    }
    if (result && view !== 'after' && result.background) {
      list.push({
        id: `${patternId}-background`,
        name: 'Background',
        x: result.twoTheta,
        y: result.background,
        unit,
        colorIndex: 3,
        dashed: true,
      });
    }
    if (result && view !== 'before') {
      list.push({
        id: `${patternId}-processed`,
        name: 'Processed',
        x: result.twoTheta,
        y: result.intensity,
        unit,
        colorIndex: 0,
      });
    }
    return list;
  }, [patternId, original, result, view, unit]);
  const markers = useMemo(
    () => (view === 'after' ? [] : anchors.map(([x, y]) => ({ x, y }))),
    [anchors, view],
  );

  return (
    <PlotPanel
      sources={sources}
      settings={data.plot}
      onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
      labels={xrdLabels}
      xName="2θ"
      xUnit="°"
      exportName={`${name}-processed`}
      showOverlayOptions={false}
      interaction={{
        markers,
        ...(onAddAnchor && {
          onPlotClick: onAddAnchor,
          hint: 'Click or tap to add a background point. Pinch or Ctrl + scroll to zoom, drag to pan.',
        }),
      }}
    />
  );
}
