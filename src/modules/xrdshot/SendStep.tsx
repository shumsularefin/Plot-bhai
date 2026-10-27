import { useMemo, useState } from 'preact/hooks';
import type { Pattern } from '../../core/xrd/types';
import { MAX_SERIES } from '../../ui/plot/palette';
import type { StepContext } from '../../ui/wizard/types';
import { initialXrdData } from '../xrd/data';
import { xrdStore } from '../xrd/xrdStore';
import type { ShotData } from './data';
import { calibrationOf, digitize, type Digitization } from './digitized';
import type { ShotImage } from './prepare';
import { ShotGate } from './ShotGate';

/** Index of the XRD wizard's "Clean data" step, where a handed-over pattern continues. */
const XRD_CLEAN_STEP = 1;

/** The digitized curve as an XRD pattern, marked as approximate everywhere it is shown. */
export function digitizedPattern(data: ShotData, result: Digitization): Pattern | null {
  const { pattern } = result;
  if (!pattern || !data.image) return null;
  return {
    id: crypto.randomUUID(),
    name: data.name.trim() || data.image.name.replace(/\.[^.]+$/, ''),
    source: 'digitized',
    twoTheta: pattern.twoTheta,
    intensity: pattern.intensity,
    intensityUnit: 'cps',
    unitOrigin: 'user',
    synthetic: data.image.synthetic,
    digitized: {
      image: data.image.name,
      pixelDeg: pattern.step,
      lineWidthPx: result.extraction.lineWidth,
      yScale: data.yScale,
    },
    notes: [
      {
        level: 'warning',
        text: 'Digitized from a figure image: positions, heights and widths are approximate, and the intensity unit is whatever the figure used.',
      },
      ...pattern.gaps.map(([a, b]) => ({
        level: 'warning' as const,
        text: `No curve was found between ${a.toFixed(2)}° and ${b.toFixed(2)}°; that stretch is a straight line.`,
      })),
    ],
  };
}

/** Wizard step 4: name the pattern and hand it to the XRD tool. */
export function SendStep({ data, update }: StepContext<ShotData>) {
  return (
    <div class="particle-step shot-step">
      <p>
        The digitized curve continues in the XRD tool like any loaded pattern: clean it, fit the
        peaks and work out sizes. In its Results step, a &quot;Check against the paper&quot; section
        compares your numbers with the sizes the paper reports.
      </p>
      <label class="inline-field">
        Pattern name
        <input
          type="text"
          value={data.name}
          placeholder={data.image?.name.replace(/\.[^.]+$/, '') ?? 'Digitized pattern'}
          onInput={(e) => update({ name: e.currentTarget.value })}
        />
      </label>
      <ShotGate data={data}>{(image) => <Handoff data={data} image={image} />}</ShotGate>
    </div>
  );
}

function Handoff({ data, image }: { data: ShotData; image: ShotImage }) {
  const outcome = calibrationOf(data);
  const calibration = 'calibration' in outcome ? outcome.calibration : null;
  const result = useMemo(
    () => digitize(data, image, calibration),
    // The trace depends only on these parts of the data.
    [image, data.curve, data.crop, data.marks, data.yScale, data.image], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if ('problem' in outcome)
    return (
      <p class="message is-warning">
        <strong>Check:</strong> the axes are not calibrated. {outcome.problem} (step 2)
      </p>
    );
  const pattern = result && digitizedPattern(data, result);
  if (!result || !pattern)
    return (
      <p class="message is-warning">
        <strong>Check:</strong> no curve has been digitized yet. Pick the curve in step 3.
      </p>
    );

  const send = async (fresh: boolean) => {
    if (
      fresh &&
      !window.confirm(
        'Start a new XRD analysis? The patterns and results now in the XRD tool are replaced.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      // Saved work must be loaded first, or it would overwrite this pattern when it arrives.
      await xrdStore.ready;
      const current = xrdStore.get();
      if (!fresh && current.data.patterns.length >= MAX_SERIES) {
        setError(
          `The XRD analysis already holds ${MAX_SERIES} patterns, the most it can show. Remove one there, or start a new analysis.`,
        );
        return;
      }
      const base = fresh ? initialXrdData : current.data;
      xrdStore.set({
        step: XRD_CLEAN_STEP,
        furthest: fresh ? XRD_CLEAN_STEP : Math.max(current.furthest, XRD_CLEAN_STEP),
        data: { ...base, patterns: [...base.patterns, pattern] },
      });
      location.hash = '#/xrd';
    } finally {
      setBusy(false);
    }
  };

  const tt = pattern.twoTheta;
  return (
    <>
      <dl class="summary-grid">
        <div>
          <dt>2θ range</dt>
          <dd>
            {(tt[0] as number).toFixed(2)}° to {(tt[tt.length - 1] as number).toFixed(2)}°
          </dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{tt.length}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{pattern.digitized?.pixelDeg.toFixed(4)}° 2θ per image pixel</dd>
        </div>
      </dl>
      <p class="message is-warning">
        <strong>Approximate:</strong> the XRD tool labels this pattern as digitized from a figure,
        and so do its tables, exports and methods text. Peak widths near a few image pixels are
        rough, so sizes from them are rough too.
      </p>
      {data.image?.synthetic && (
        <p class="message is-info">
          <strong>Example:</strong> this is the synthetic example figure, not a published pattern.
        </p>
      )}
      {error && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {error}
        </p>
      )}
      <div class="upload-actions">
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onClick={() => void send(false)}
        >
          Add to the current XRD analysis
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => void send(true)}>
          Start a new XRD analysis with it
        </button>
      </div>
    </>
  );
}
