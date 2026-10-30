import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dock } from '../../ui/Dock';
import { cutAlongSegment, ellipseRuns } from '../../core/particles/detect/manual';
import {
  AUTO_THRESHOLD_CITATIONS,
  AUTO_THRESHOLD_HINTS,
  AUTO_THRESHOLD_METHODS,
  AUTO_THRESHOLD_NAMES,
  autoThreshold,
  type AutoThresholdMethod,
} from '../../core/particles/detect/autoThreshold';
import { DEFAULT_DETECT_SETTINGS, type DetectSettings } from '../../core/particles/detect/pipeline';
import { mergeRuns, runsContain, touchesEdge } from '../../core/particles/detect/regions';
import {
  nmPerPixel,
  NM_PER_UNIT,
  UNIT_LABELS,
  type LengthUnit,
  type Measurement,
  type Point,
} from '../../core/particles/geometry';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import {
  calibrationOf,
  DEFAULT_FILTERS,
  type DetectState,
  type MeasureGroup,
  type Particle,
  type ParticleData,
  type ParticleFilters,
} from './data';
import { DetectClient } from './detectClient';
import type { DecodedImage } from './decode';
import { GrayHistogram } from './GrayHistogram';
import { grayOf, maskCanvas, workingArea, workingSize } from './grayImage';
import { HandMeasurements } from './HandMeasurements';
import { ImageGate } from './ImageGate';
import { ImageViewer, type DrawTool, type ParticleOverlay, type Tool } from './ImageViewer';
import { LineProfile } from './LineProfile';
import { GREY_GROUPS, MEASURE_GROUPS, measureColumns, type MeasureColumn } from './measureColumns';
import { applyFilters, outlinePath, sizesOf } from './particleView';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  {
    tool: 'select',
    label: 'Select',
    hint: 'Click a particle to select it; click again to deselect. Hold Shift or Ctrl to select several. Drag to move the image.',
  },
  {
    tool: 'line',
    label: 'Add a line',
    hint: 'Drag across a particle from edge to edge to measure its diameter by hand. Lines are listed under "Measured by hand", not as outlines.',
  },
  {
    tool: 'add-circle',
    label: 'Add a circle',
    hint: 'Drag across a missed particle along a diameter to add it as a circle.',
  },
  {
    tool: 'add-ellipse',
    label: 'Add an ellipse',
    hint: 'Drag a box around a missed particle to add the ellipse inside it.',
  },
  {
    tool: 'cut',
    label: 'Cut',
    hint: 'Drag a line across the neck of two particles that were not separated. Every particle the line touches is cut along it.',
  },
  { tool: 'pan', label: 'Move the image', hint: 'Drag to move the image.' },
];
const SOURCE_NAMES: Record<Particle['source'], string> = {
  auto: 'detected',
  added: 'added by hand',
  merged: 'merged',
  cut: 'cut',
};
const ROW_LIMIT = 200;
const UNDO_LIMIT = 30;
const MASK_DELAY_MS = 400;

interface Snapshot {
  particles: Particle[];
  nextParticleId: number;
  measurements: Measurement[];
  nextId: number;
}

/** Plain-language list of what step 3 (Adjust the image) changed, for the summary here. */
function adjustSummary(settings: DetectSettings): string {
  const { adjust, denoise } = settings;
  const parts = [
    adjust.background.enabled &&
      `uneven background removed (radius ${adjust.background.radius} px)`,
    adjust.range && `contrast stretched (${adjust.range.min} to ${adjust.range.max})`,
    adjust.equalize && 'histogram equalised',
    adjust.sharpen.enabled && 'sharpened',
    denoise.method === 'gaussian' && `Gaussian blur ${denoise.size} px`,
    denoise.method === 'median' && `median filter radius ${denoise.size} px`,
  ].filter(Boolean);
  return parts.length > 0 ? `Adjustments: ${parts.join(', ')}.` : 'No adjustments.';
}

/** The settings step 3 owns, kept when the detection settings are reset. */
const preparedOf = (settings: DetectSettings) => ({
  invert: settings.invert,
  adjust: settings.adjust,
  denoise: settings.denoise,
});

/**
 * Wizard step 4: find particles automatically, then review, filter and correct them, and measure
 * by hand the ones the detection cannot outline.
 */
export function DetectStep({ data, update }: StepContext<ParticleData>) {
  return (
    <div class="particle-step">
      <p class="message">
        <strong>Review the outlines.</strong> Automatic detection works best on well separated
        particles with good contrast; for clumps, choose "In clumps or overlapping" in part 3. Check
        every outline against the image: merge, cut, delete or add particles where it went wrong, or
        measure a particle by hand with a line. The result is an estimate.
      </p>
      <ImageGate data={data}>
        {(image) => <Detector data={data} update={update} image={image} />}
      </ImageGate>
    </div>
  );
}

function Detector({ data, update, image }: StepContext<ParticleData> & { image: DecodedImage }) {
  const { detect } = data;
  const { settings, filters } = detect;
  const work = useMemo(() => workingSize(image), [image]);
  const calibration = calibrationOf(data.scale);
  const perPixelNm = calibration ? nmPerPixel(calibration) : null;
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  const [sensitivity, setSensitivity] = useState<
    { threshold: number; count: number; mean: number }[] | null
  >(null);
  const [preview, setPreview] = useState<{
    mask: Uint8Array;
    width: number;
    height: number;
    threshold: number;
    fellBack: boolean;
    histogram: Int32Array;
  } | null>(null);
  const [showUnit, setShowUnit] = useState<'px' | LengthUnit>(data.scale?.unit ?? 'px');
  const detectClient = useRef(new DetectClient());
  const maskClient = useRef(new DetectClient());
  const grayRef = useRef<{ id: string; value: ReturnType<typeof grayOf> } | null>(null);
  const history = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(
    () => () => {
      detectClient.current.cancel();
      maskClient.current.cancel();
    },
    [],
  );

  const gray = () => {
    const id = data.image?.id ?? '';
    if (grayRef.current?.id !== id) grayRef.current = { id, value: grayOf(image) };
    return grayRef.current.value;
  };
  const area = useMemo(() => workingArea(data.crop, work.scale), [data.crop, work.scale]);
  const key = JSON.stringify({ settings, area });
  const stale = detect.detectedWith !== null && detect.detectedWith !== key;

  // Live threshold: the mask, the level and the histogram it was taken from, for the preview.
  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const g = gray();
          const result = await maskClient.current.mask({
            gray: g.gray,
            width: g.width,
            height: g.height,
            settings,
            area,
          });
          if (result && result !== 'error')
            setPreview({
              mask: result.mask,
              width: g.width,
              height: g.height,
              threshold: result.threshold,
              fellBack: result.fellBack,
              histogram: result.histogram,
            });
        } catch {
          setProblem('The preview could not be made in this browser.');
        }
      })();
    }, MASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mask = useMemo(
    () => (showMask && preview ? maskCanvas(preview.mask, preview.width, preview.height) : null),
    [showMask, preview],
  );

  const setDetect = (patch: Partial<DetectState>) => update({ detect: { ...detect, ...patch } });
  const setSettings = (next: DetectSettings) => setDetect({ settings: next });
  const setFilters = (patch: Partial<ParticleFilters>) =>
    setDetect({ filters: { ...filters, ...patch } });

  const edgeArea = area ?? { x: 0, y: 0, width: work.width, height: work.height };
  const filtered = useMemo(
    () =>
      applyFilters(detect.particles, filters, {
        scale: work.scale,
        nmPerPixel: perPixelNm,
        edgeArea,
      }),
    [detect.particles, filters, work.scale, perPixelNm, area], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const kept = filtered.kept;

  const overlays = useMemo<ParticleOverlay[]>(
    () =>
      kept.map((p) => {
        const sizes = sizesOf(p.runs, work.scale);
        return {
          id: p.id,
          d: outlinePath(p.runs),
          selected: selected.has(p.id),
          cx: sizes.cx,
          cy: sizes.cy,
        };
      }),
    [kept, selected, work.scale],
  );

  const remember = () => {
    history.current = [
      ...history.current,
      {
        particles: detect.particles,
        nextParticleId: detect.nextParticleId,
        measurements: data.measurements,
        nextId: data.nextId,
      },
    ].slice(-UNDO_LIMIT);
    setCanUndo(true);
  };
  const edit = (particles: Particle[], nextParticleId = detect.nextParticleId) => {
    remember();
    setDetect({ particles, nextParticleId, edited: true });
  };
  const editHand = (measurements: Measurement[], nextId = data.nextId) => {
    remember();
    update({ measurements, nextId });
  };
  const addLine = (a: Point, b: Point) =>
    editHand([...data.measurements, { id: data.nextId, kind: 'line', a, b }], data.nextId + 1);
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    setSelected(new Set());
    update({
      measurements: last.measurements,
      nextId: last.nextId,
      detect: {
        ...detect,
        particles: last.particles,
        nextParticleId: last.nextParticleId,
        edited: true,
      },
    });
  };

  const run = async () => {
    if (
      detect.edited &&
      detect.particles.length > 0 &&
      !window.confirm('Detect again? This replaces the particles, including your edits.')
    )
      return;
    setBusy('Detecting particles… large images can take several seconds.');
    setProblem(null);
    try {
      const g = gray();
      const result = await detectClient.current.detect({
        gray: g.gray,
        width: g.width,
        height: g.height,
        settings,
        area,
      });
      if (result === null) return;
      if (result === 'error') {
        setProblem('Detection failed. Try a smaller image or other settings.');
        return;
      }
      history.current = [];
      setCanUndo(false);
      setSelected(new Set());
      setDetect({
        particles: result.particles.map((runs, i) => ({
          id: i + 1,
          runs,
          source: 'auto' as const,
        })),
        nextParticleId: result.particles.length + 1,
        detectedWith: key,
        edited: false,
        thresholdUsed: Number.isFinite(result.threshold) ? result.threshold : null,
        fellBack: result.fellBack,
        diameterUsed: result.diameter,
      });
    } catch {
      setProblem('The image could not be prepared for detection in this browser.');
    } finally {
      setBusy(null);
    }
  };
  const cancel = () => {
    detectClient.current.cancel();
    setBusy(null);
  };

  /**
   * Detects again with fixed thresholds 10 grey levels either side of the one used, with every
   * other setting and filter unchanged, and reports the count and mean equal-area diameter of
   * each: soft particle edges make the size depend on the threshold, and this spread is a
   * systematic uncertainty a single detection does not show. The particles on screen are kept.
   */
  const testSensitivity = async () => {
    const centre = detect.thresholdUsed ?? settings.threshold.manual;
    setBusy('Testing the threshold: three detections…');
    setProblem(null);
    try {
      const g = gray();
      const rows: { threshold: number; count: number; mean: number }[] = [];
      for (const threshold of [centre - 10, centre, centre + 10]) {
        if (threshold < 1 || threshold > 254) continue;
        const result = await detectClient.current.detect({
          gray: g.gray,
          width: g.width,
          height: g.height,
          settings: {
            ...settings,
            threshold: { ...settings.threshold, method: 'manual', manual: threshold },
          },
          area,
        });
        if (result === null) return;
        if (result === 'error') {
          setProblem('The sensitivity test failed. Try a smaller image.');
          return;
        }
        const particles = result.particles.map((runs, i) => ({
          id: i + 1,
          runs,
          source: 'auto' as const,
        }));
        const keptHere = applyFilters(particles, filters, {
          scale: work.scale,
          nmPerPixel: perPixelNm,
          edgeArea,
        }).kept;
        const diameters = keptHere.map((p) => sizesOf(p.runs, work.scale).eqDiameter);
        rows.push({
          threshold,
          count: diameters.length,
          mean: diameters.length ? diameters.reduce((a, b) => a + b, 0) / diameters.length : NaN,
        });
      }
      setSensitivity(rows);
    } catch {
      setProblem('The image could not be prepared in this browser.');
    } finally {
      setBusy(null);
    }
  };

  const toWork = (p: Point): Point => ({ x: p.x * work.scale, y: p.y * work.scale });
  const pick = (point: Point, extend: boolean) => {
    const w = toWork(point);
    const hit = kept.find((p) => runsContain(p.runs, Math.floor(w.x), Math.floor(w.y)));
    setSelected((current) => {
      const next = new Set(extend ? current : []);
      if (!hit) return extend ? next : new Set();
      if (current.has(hit.id) && (extend || current.size === 1)) next.delete(hit.id);
      else next.add(hit.id);
      return next;
    });
  };
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const draw = (drawn: DrawTool, a: Point, b: Point) => {
    const wa = toWork(a);
    const wb = toWork(b);
    if (drawn === 'line') addLine(a, b);
    else if (drawn === 'add-circle') {
      const r = Math.hypot(wb.x - wa.x, wb.y - wa.y) / 2;
      const runs = ellipseRuns((wa.x + wb.x) / 2, (wa.y + wb.y) / 2, r, r, work.width, work.height);
      if (runs.length > 0)
        edit(
          [...detect.particles, { id: detect.nextParticleId, runs, source: 'added' }],
          detect.nextParticleId + 1,
        );
    } else if (drawn === 'add-ellipse') {
      const runs = ellipseRuns(
        (wa.x + wb.x) / 2,
        (wa.y + wb.y) / 2,
        Math.abs(wb.x - wa.x) / 2,
        Math.abs(wb.y - wa.y) / 2,
        work.width,
        work.height,
      );
      if (runs.length > 0)
        edit(
          [...detect.particles, { id: detect.nextParticleId, runs, source: 'added' }],
          detect.nextParticleId + 1,
        );
    } else if (drawn === 'cut') {
      const cuts = cutAlongSegment(kept, wa, wb);
      if (cuts.length === 0) return;
      let next = detect.nextParticleId;
      const replaced = new Set(cuts.map((c) => c.id));
      const pieces = cuts.flatMap((c) =>
        c.pieces.map((runs) => ({ id: next++, runs, source: 'cut' as const })),
      );
      edit([...detect.particles.filter((p) => !replaced.has(p.id)), ...pieces], next);
      setSelected(new Set());
    }
  };
  const deleteSelected = () => {
    edit(detect.particles.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
  };
  const mergeSelected = () => {
    const chosen = detect.particles.filter((p) => selected.has(p.id));
    if (chosen.length < 2) return;
    const runs = chosen.map((p) => p.runs).reduce((a, b) => mergeRuns(a, b));
    edit(
      [
        ...detect.particles.filter((p) => !selected.has(p.id)),
        { id: detect.nextParticleId, runs, source: 'merged' },
      ],
      detect.nextParticleId + 1,
    );
    setSelected(new Set());
  };

  const patchThreshold = (patch: Partial<DetectSettings['threshold']>) =>
    setSettings({ ...settings, threshold: { ...settings.threshold, ...patch } });
  const patchSplit = (patch: Partial<DetectSettings['split']>) =>
    setSettings({ ...settings, split: { ...settings.split, ...patch } });
  const lines = data.measurements.filter((m) => m.kind === 'line');
  const last = lines[lines.length - 1];
  const lastLine = last ? Math.hypot(last.b.x - last.a.x, last.b.y - last.a.y) : null;
  const current = TOOLS.find((t) => t.tool === tool);
  const pixelsNote =
    work.scale < 1
      ? ` These are pixels of the working copy (${Math.round(work.scale * 100)} % of the original size).`
      : '';

  const length = (px: number) =>
    showUnit === 'px' || perPixelNm === null
      ? `${formatNumber(px, 4)} px`
      : `${formatNumber((px * perPixelNm) / NM_PER_UNIT[showUnit], 4)} ${UNIT_LABELS[showUnit]}`;
  const rows = kept.slice().sort((a, b) => a.id - b.id);
  const columns = useMemo(
    () =>
      measureColumns(detect.columns, {
        scale: work.scale,
        gray: detect.columns.some((g) => GREY_GROUPS.has(g)) ? gray() : null,
        nmPerPixel: perPixelNm,
      }),
    [detect.columns, work.scale, perPixelNm, data.image?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cell = (column: MeasureColumn, p: Particle) => {
    const v = column.value(p);
    if (!Number.isFinite(v)) return '–';
    if (column.kind === 'length') return length(v);
    if (column.kind === 'area')
      return showUnit === 'px' || perPixelNm === null
        ? `${formatNumber(v, 4)} px²`
        : `${formatNumber((v * perPixelNm ** 2) / NM_PER_UNIT[showUnit] ** 2, 4)} ${UNIT_LABELS[showUnit]}²`;
    if (column.kind === 'angle') return `${formatNumber(v, 3)}°`;
    return formatNumber(v, 4);
  };
  const toggleGroup = (group: MeasureGroup, on: boolean) =>
    setDetect({
      columns: MEASURE_GROUPS.map((g) => g.group).filter((g) =>
        g === group ? on : detect.columns.includes(g),
      ),
    });
  const areas = detect.particles.map((p) => sizesOf(p.runs, work.scale).area);
  const totalArea = areas.reduce((sum, a) => sum + a, 0);
  const foregroundShare = totalArea / (image.width * image.height);
  const largestShare = areas.length > 1 ? Math.max(...areas) / totalArea : 0;

  return (
    <>
      <section class="process-step is-on" aria-labelledby="prep-title">
        <h3 id="prep-title" class="process-step-title">
          1. The image
        </h3>
        <p class="field-hint">{adjustSummary(settings)} Change them in step 3, Adjust the image.</p>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.invert}
            onChange={(e) => setSettings({ ...settings, invert: e.currentTarget.checked })}
          />
          The particles are darker than the background
        </label>
      </section>

      <section class="process-step is-on" aria-labelledby="thr-title">
        <h3 id="thr-title" class="process-step-title">
          2. Separate particles from the background{' '}
          <HelpTip term="threshold">
            <p>
              A threshold turns the image into black and white: pixels brighter than the threshold
              are particles (after inverting when the particles are dark). Automatic picks the level
              from the histogram of grey values inside the crop area; Otsu suits most images, and
              the other methods of ImageJ's Auto Threshold are under Advanced. Adaptive compares
              each pixel with its neighbourhood, which copes with a background that gets brighter
              across the image. Manual lets you choose the level; use the preview.
            </p>
          </HelpTip>
        </h3>
        <fieldset class="method-choice">
          <legend>Method</legend>
          {(
            [
              ['auto', 'Automatic'],
              ['adaptive', 'Adaptive (uneven background)'],
              ['manual', 'Manual level'],
            ] as const
          ).map(([method, name]) => (
            <label key={method} class="check">
              <input
                type="radio"
                name="particle-threshold"
                checked={settings.threshold.method === method}
                onChange={() => patchThreshold({ method })}
              />
              {name}
            </label>
          ))}
        </fieldset>
        {settings.threshold.method === 'manual' && (
          <label class="slider-field">
            Level: <strong>{settings.threshold.manual}</strong> (0 black to 255 white)
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={settings.threshold.manual}
              onInput={(e) => patchThreshold({ manual: Number(e.currentTarget.value) })}
            />
          </label>
        )}
        {settings.threshold.method === 'adaptive' && (
          <div class="radiation-fields">
            <NumberInput
              label="Neighbourhood radius (px)"
              value={settings.threshold.adaptiveRadius}
              min={1}
              max={500}
              step={1}
              onChange={(v) => v !== null && patchThreshold({ adaptiveRadius: v })}
            />
            <NumberInput
              label="Offset above local mean (grey levels)"
              value={settings.threshold.adaptiveOffset}
              min={-100}
              max={100}
              step={1}
              onChange={(v) => v !== null && patchThreshold({ adaptiveOffset: v })}
            />
          </div>
        )}
        {settings.threshold.method === 'auto' && (
          <AutoMethodChoice
            method={settings.threshold.auto}
            histogram={preview?.histogram ?? null}
            onChoose={(auto) => patchThreshold({ method: 'auto', auto })}
          />
        )}
        {preview &&
          Number.isFinite(preview.threshold) &&
          settings.threshold.method !== 'adaptive' && (
            <p class="field-hint" role="status">
              {settings.threshold.method === 'auto'
                ? `${AUTO_THRESHOLD_NAMES[preview.fellBack ? 'otsu' : settings.threshold.auto]} chooses grey level ${preview.threshold}`
                : `Grey level ${preview.threshold}`}
              : brighter pixels{settings.invert ? ' (of the inverted image)' : ''} are particles.
            </p>
          )}
        {settings.threshold.method === 'auto' && preview?.fellBack && (
          <p class="message is-warning" role="status">
            <strong>Check:</strong> the histogram does not have two clear peaks, so{' '}
            {AUTO_THRESHOLD_NAMES[settings.threshold.auto]} cannot work here and Otsu was used
            instead. Try another method or a manual level.
          </p>
        )}
        {preview && (
          <GrayHistogram
            hist={preview.histogram}
            markers={
              Number.isFinite(preview.threshold) && settings.threshold.method !== 'adaptive'
                ? [{ level: preview.threshold, label: 'Threshold' }]
                : []
            }
            shadeFrom={
              Number.isFinite(preview.threshold) && settings.threshold.method !== 'adaptive'
                ? preview.threshold
                : null
            }
            label={`Histogram of the prepared image${settings.invert ? ', inverted' : ''}, inside the crop area`}
          />
        )}
        {settings.threshold.method !== 'adaptive' && detect.particles.length > 0 && (
          <Advanced id="particle-threshold-sensitivity" title="Threshold sensitivity">
            <p class="field-hint">
              Particle edges in electron micrographs are blurred, so the measured size depends on
              the threshold. This detects again 10 grey levels below and above the one used (other
              settings and filters unchanged) and compares the mean equal-area diameter. Your
              particles on screen are not changed. Report the spread as an uncertainty of the
              method, in addition to the spread of sizes.
            </p>
            <button
              type="button"
              class="btn"
              onClick={() => void testSensitivity()}
              disabled={busy !== null}
            >
              Test ±10 grey levels
            </button>
            {sensitivity && sensitivity.length > 0 && (
              <div
                class="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Threshold sensitivity"
              >
                <table class="peak-table">
                  <thead>
                    <tr>
                      <th scope="col">Threshold (grey level)</th>
                      <th scope="col">Particles kept</th>
                      <th scope="col">Mean equal-area diameter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.map((r) => (
                      <tr key={r.threshold}>
                        <td>{r.threshold}</td>
                        <td>{r.count}</td>
                        <td>
                          {Number.isFinite(r.mean)
                            ? perPixelNm
                              ? `${formatNumber(r.mean * perPixelNm, 2)} nm`
                              : `${formatNumber(r.mean, 1)} px`
                            : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sensitivity &&
              sensitivity.length === 3 &&
              (() => {
                const lo = sensitivity[0]?.mean ?? NaN;
                const mid = sensitivity[1]?.mean ?? NaN;
                const hi = sensitivity[2]?.mean ?? NaN;
                const change = (Math.abs(hi - lo) / 2 / mid) * 100;
                return Number.isFinite(change) ? (
                  <p class={change > 5 ? 'message is-warning' : 'field-hint'}>
                    The mean diameter changes by about ±{formatNumber(change, 1)} % over ±10 grey
                    levels.
                    {change > 5 && ' Choose the threshold with care, and state it in your methods.'}
                  </p>
                ) : null;
              })()}
          </Advanced>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={showMask}
            onChange={(e) => setShowMask(e.currentTarget.checked)}
          />
          Preview: show what the settings above and below mark as particles (pink)
        </label>
      </section>

      <section class="process-step is-on" aria-labelledby="clean-title">
        <h3 id="clean-title" class="process-step-title">
          3. Clean up and split{' '}
          <HelpTip term="clean-up and splitting">
            <p>
              Opening removes specks and thin bridges smaller than the radius; closing fills small
              gaps and dents. Filling holes closes bright rings. Splitting uses a watershed on the
              distance from the edge: each blob's centre starts a basin, and two basins are joined
              again unless the neck between them is narrower than the percentage below of the
              smaller particle's radius. A higher percentage splits more.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="Remove specks up to radius (px)"
            value={settings.open}
            min={-1}
            max={20}
            step={1}
            onChange={(v) => v !== null && setSettings({ ...settings, open: v })}
          />
          <NumberInput
            label="Close gaps up to radius (px)"
            value={settings.close}
            min={-1}
            max={20}
            step={1}
            onChange={(v) => v !== null && setSettings({ ...settings, close: v })}
          />
          <label class="check">
            <input
              type="checkbox"
              checked={settings.fillHoles}
              onChange={(e) => setSettings({ ...settings, fillHoles: e.currentTarget.checked })}
            />
            Fill holes
          </label>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.split.enabled}
            onChange={(e) => patchSplit({ enabled: e.currentTarget.checked })}
          />
          Split touching particles
        </label>
        {settings.split.enabled && (
          <fieldset class="method-choice">
            <legend>The particles are</legend>
            {(
              [
                ['necks', 'Separate or touching at narrow necks'],
                ['clumps', 'In clumps or overlapping (agglomerates)'],
              ] as const
            ).map(([method, name]) => (
              <label key={method} class="check">
                <input
                  type="radio"
                  name="particle-split"
                  checked={settings.split.method === method}
                  onChange={() => patchSplit({ method })}
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        {settings.split.enabled && settings.split.method === 'necks' && (
          <label class="slider-field">
            Split where the neck is narrower than <strong>{settings.split.neckPercent} %</strong> of
            the smaller radius
            <input
              type="range"
              min={30}
              max={95}
              step={5}
              value={settings.split.neckPercent}
              onInput={(e) => patchSplit({ neckPercent: Number(e.currentTarget.value) })}
            />
          </label>
        )}
        {settings.split.enabled && settings.split.method === 'clumps' && (
          <>
            <div class="radiation-fields">
              <NumberInput
                label="Typical particle diameter (px)"
                value={settings.split.diameter}
                min={4}
                max={2000}
                step={1}
                onChange={(diameter) => patchSplit({ diameter })}
              />
              <button
                type="button"
                class="btn"
                disabled={lastLine === null}
                onClick={() =>
                  lastLine !== null && patchSplit({ diameter: Math.round(lastLine * work.scale) })
                }
              >
                Use the last line drawn
              </button>
              <HelpTip term="separating clumps">
                <p>
                  Particles in a clump hide only part of each other's outlines. Every edge in the
                  image votes for the centre of a circle 0.7 to 1.3 times the typical size lying
                  behind it (a circular Hough transform), so the visible arcs of one particle all
                  point to its centre. The strongest centres, at least 0.6 diameters apart, become
                  particles, and each part of the clump goes to the nearest centre.
                </p>
                <p>
                  Leave the diameter empty to estimate it from the image, or draw a line across a
                  typical particle with "Add a line" and press "Use the last line drawn" (best for
                  dense clumps). Too small a diameter splits particles in pieces; too large joins
                  neighbours.
                </p>
              </HelpTip>
            </div>
            <p class="field-hint">
              {settings.split.diameter === null
                ? detect.diameterUsed !== null && !stale
                  ? `Empty: estimated from the image. The last detection used ${formatNumber(detect.diameterUsed, 3)} px.`
                  : 'Empty: estimated from the image when you detect.'
                : 'Set by you.'}
            </p>
            <label class="slider-field">
              A centre needs at least <strong>{settings.split.outlinePercent} %</strong> of a whole,
              clear outline (lower finds more particles, higher fewer)
              <input
                type="range"
                min={1}
                max={40}
                step={1}
                value={settings.split.outlinePercent}
                onInput={(e) => patchSplit({ outlinePercent: Number(e.currentTarget.value) })}
              />
            </label>
          </>
        )}
        <p class="field-hint">Radii are in pixels.{pixelsNote}</p>
      </section>

      <div class="clean-actions">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void run()}
          disabled={busy !== null}
        >
          Detect particles
        </button>
        {busy && (
          <button type="button" class="btn" onClick={cancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          class="btn"
          onClick={() => setSettings({ ...DEFAULT_DETECT_SETTINGS, ...preparedOf(settings) })}
          disabled={
            JSON.stringify(settings) ===
            JSON.stringify({ ...DEFAULT_DETECT_SETTINGS, ...preparedOf(settings) })
          }
        >
          Reset the settings
        </button>
      </div>
      <p class="upload-status" role="status">
        {busy}
      </p>
      {problem && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {problem}
        </p>
      )}
      {stale && (
        <p class="message is-warning" role="status">
          <strong>Check:</strong> the settings or the crop changed since the last detection. Press
          "Detect particles" to update the result.
        </p>
      )}
      {detect.detectedWith !== null && detect.particles.length === 0 && (
        <p class="message is-warning" role="status">
          <strong>Check:</strong> no particles were found. Switch on the preview and adjust the
          threshold, or tick "darker than the background" if the particles are dark.
        </p>
      )}
      {foregroundShare > 0.5 && (
        <p class="message is-warning" role="status">
          <strong>Check:</strong> more than half of the image is marked as particles. The particles
          may be darker than the background (tick the box in part 1), or the threshold is too low:
          try another method in part 2.
        </p>
      )}
      {foregroundShare <= 0.5 && largestShare > 0.3 && settings.split.method !== 'clumps' && (
        <p class="message is-warning" role="status">
          <strong>Check:</strong> one outline holds {Math.round(largestShare * 100)} % of all
          particle area. If the particles sit in clumps, choose "In clumps or overlapping" in part 3
          and detect again.
        </p>
      )}

      <div class="tool-buttons" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            class="btn"
            aria-pressed={tool === t.tool}
            onClick={() => setTool(t.tool)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p class="field-hint">{current?.hint}</p>
      <Dock label="Image with the detected particles">
        <ImageViewer
          image={image}
          tool={tool}
          crop={data.crop}
          focusCrop
          particles={overlays}
          workScale={work.scale}
          mask={mask}
          measurements={data.measurements}
          onPick={pick}
          onDraw={draw}
          label="Image with the detected particles"
        />
      </Dock>
      <div class="clean-actions">
        <button type="button" class="btn" onClick={deleteSelected} disabled={selected.size === 0}>
          Delete selected ({selected.size})
        </button>
        <button type="button" class="btn" onClick={mergeSelected} disabled={selected.size < 2}>
          Merge selected
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => setSelected(new Set())}
          disabled={selected.size === 0}
        >
          Clear the selection
        </button>
        <button type="button" class="btn" onClick={undo} disabled={!canUndo}>
          Undo the last edit
        </button>
      </div>

      <section class="process-step is-on" aria-labelledby="filter-title">
        <h3 id="filter-title" class="process-step-title">
          Filters{' '}
          <HelpTip term="particle filters">
            <p>
              Filters hide particles without deleting them, so you can change your mind. Diameter is
              the diameter of the circle with the same area. Circularity is 4π · area / perimeter²:
              it is lower for elongated or ragged shapes. Because the perimeter is measured along
              pixel edges, a perfect circle reads about 0.9 and a square about 0.83. Particles
              touching the edge of the crop area (or the image) are cut off, so their size is wrong.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Diameter in
            <select
              value={filters.unit}
              onChange={(e) =>
                setFilters({ unit: e.currentTarget.value as ParticleFilters['unit'] })
              }
            >
              <option value="px">pixels</option>
              <option value="nm" disabled={perPixelNm === null}>
                nm
              </option>
              <option value="um" disabled={perPixelNm === null}>
                µm
              </option>
            </select>
          </label>
          <NumberInput
            label="Smallest diameter"
            value={filters.minDiameter}
            min={0}
            onChange={(minDiameter) => setFilters({ minDiameter })}
          />
          <NumberInput
            label="Largest diameter"
            value={filters.maxDiameter}
            min={0}
            onChange={(maxDiameter) => setFilters({ maxDiameter })}
          />
          <NumberInput
            label="Lowest circularity (0 to 1)"
            value={filters.minCircularity}
            min={0}
            max={1}
            step={0.05}
            onChange={(minCircularity) => setFilters({ minCircularity })}
          />
          <label class="check">
            <input
              type="checkbox"
              checked={filters.excludeEdge}
              onChange={(e) => setFilters({ excludeEdge: e.currentTarget.checked })}
            />
            Leave out particles touching the edge
          </label>
          <button type="button" class="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear the filters
          </button>
        </div>
        <p role="status">
          <strong>{kept.length}</strong> of {detect.particles.length} particles shown
          {detect.particles.length > kept.length &&
            ` (left out: ${[
              filtered.counts.small && `${filtered.counts.small} too small`,
              filtered.counts.large && `${filtered.counts.large} too large`,
              filtered.counts.shape && `${filtered.counts.shape} not round enough`,
              filtered.counts.edge && `${filtered.counts.edge} touching the edge`,
            ]
              .filter(Boolean)
              .join(', ')})`}
          .
        </p>
      </section>

      <section class="peak-table-section" aria-labelledby="particle-table-title">
        <div class="peak-table-header">
          <h3 id="particle-table-title" class="process-step-title">
            Particles ({kept.length})
          </h3>
          <div class="clean-actions">
            <label class="inline-field">
              Show sizes in
              <select
                value={perPixelNm === null ? 'px' : showUnit}
                onChange={(e) => setShowUnit(e.currentTarget.value as 'px' | LengthUnit)}
                disabled={perPixelNm === null}
              >
                <option value="px">pixels</option>
                <option value="nm">nm</option>
                <option value="um">µm</option>
              </select>
            </label>
            <button
              type="button"
              class="btn"
              disabled={kept.length === 0}
              onClick={() =>
                downloadParticles(
                  rows,
                  work.scale,
                  perPixelNm,
                  edgeArea,
                  data.image?.name ?? 'image',
                  columns,
                )
              }
            >
              Download CSV
            </button>
          </div>
        </div>
        {perPixelNm === null && (
          <p class="field-hint">
            No scale yet, so sizes are in pixels of the original image. Draw the scale bar in step
            2.
          </p>
        )}
        <Advanced id="particle-measurements" title="Set measurements (more columns)">
          <p class="field-hint">
            Add ImageJ's measurements to the table and the CSV file. Grey values are read from the
            original image{work.scale < 1 ? ' (its working copy)' : ''}, before the adjustments of
            step 3.
          </p>
          <div class="measure-groups">
            {MEASURE_GROUPS.map((g) => (
              <label key={g.group} class="check">
                <input
                  type="checkbox"
                  checked={detect.columns.includes(g.group)}
                  onChange={(e) => toggleGroup(g.group, e.currentTarget.checked)}
                />
                <span>
                  {g.label} <span class="field-hint">{g.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <HelpTip term="the extra measurements">
            <p>
              Fit ellipse: the ellipse with the same area and the same second moments as the
              particle; Angle is the direction of its major axis, counter-clockwise from the x axis.
              AR (ellipse) is major / minor axis; Round is 4 · area / (π · major²); Solidity is area
              / area of the convex hull, lower for dented shapes. Feret angle is the direction of
              the longest caliper. IntDen is area × mean grey value (calibrated area when a scale is
              set); RawIntDen is the sum of the grey values. Skewness and kurtosis (excess, 0 for a
              normal distribution) describe the shape of the grey-value distribution inside the
              particle.
            </p>
          </HelpTip>
        </Advanced>
        {rows.length === 0 ? (
          <p class="field-hint">No particles to show.</p>
        ) : (
          <>
            <div
              class="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Detected particles, scrolls sideways"
            >
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && rows.every((p) => selected.has(p.id))}
                          onChange={(e) =>
                            setSelected(
                              e.currentTarget.checked ? new Set(rows.map((p) => p.id)) : new Set(),
                            )
                          }
                        />
                        Select all
                      </label>
                    </th>
                    <th scope="col">ID</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Diameter (equal area)</th>
                    <th scope="col">Longest caliper</th>
                    <th scope="col">Shortest caliper</th>
                    <th scope="col">Aspect ratio</th>
                    <th scope="col">Circularity</th>
                    {columns.map((c) => (
                      <th key={c.header} scope="col">
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, ROW_LIMIT).map((p) => {
                    const s = sizesOf(p.runs, work.scale);
                    return (
                      <tr key={p.id} class={selected.has(p.id) ? 'is-selected-row' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            aria-label={`Select particle ${p.id}`}
                            onChange={() => toggle(p.id)}
                          />
                        </td>
                        <th scope="row">{p.id}</th>
                        <td>{SOURCE_NAMES[p.source]}</td>
                        <td>{length(s.eqDiameter)}</td>
                        <td>{length(s.feretMax)}</td>
                        <td>{length(s.feretMin)}</td>
                        <td>{formatNumber(s.aspect, 3)}</td>
                        <td>{formatNumber(s.circularity, 3)}</td>
                        {columns.map((c) => (
                          <td key={c.header}>{cell(c, p)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > ROW_LIMIT && (
              <p class="field-hint">
                Showing the first {ROW_LIMIT} of {rows.length}. The CSV file has all of them.
              </p>
            )}
          </>
        )}
      </section>

      <HandMeasurements
        measurements={data.measurements}
        width={image.width}
        height={image.height}
        perPixelNm={perPixelNm}
        unit={showUnit}
        name={data.image?.name ?? 'image'}
        onAddLine={addLine}
        onChange={(measurements) => editHand(measurements)}
      />
      <Advanced id="particle-profile" title="Plot profile along a line">
        <LineProfile
          lines={lines}
          gray={gray}
          workScale={work.scale}
          perPixelNm={perPixelNm}
          unit={showUnit}
          name={data.image?.name ?? 'image'}
        />
      </Advanced>
    </>
  );
}

/**
 * The automatic threshold methods of ImageJ's Auto Threshold, under Advanced: a choice with a
 * hint, and a table of the level each method picks on the current histogram and the share of
 * the crop area it marks as particles, so the user can compare them before detecting.
 */
function AutoMethodChoice({
  method,
  histogram,
  onChoose,
}: {
  method: AutoThresholdMethod;
  histogram: Int32Array | null;
  onChoose: (method: AutoThresholdMethod) => void;
}) {
  const compared = useMemo(() => {
    if (!histogram) return null;
    let total = 0;
    for (let v = 0; v < 256; v++) total += histogram[v] as number;
    return AUTO_THRESHOLD_METHODS.map((m) => {
      const { level, fellBack } = autoThreshold(m, histogram);
      let above = 0;
      for (let v = level + 1; v < 256; v++) above += histogram[v] as number;
      return { method: m, level, fellBack, share: total > 0 ? above / total : 0 };
    });
  }, [histogram]);
  return (
    <Advanced id="particle-auto-method" title={`Automatic method: ${AUTO_THRESHOLD_NAMES[method]}`}>
      <label class="inline-field">
        Method
        <select
          value={method}
          onChange={(e) => onChoose(e.currentTarget.value as AutoThresholdMethod)}
        >
          {AUTO_THRESHOLD_METHODS.map((m) => (
            <option key={m} value={m}>
              {AUTO_THRESHOLD_NAMES[m]}
            </option>
          ))}
        </select>
      </label>
      <p class="field-hint">
        {AUTO_THRESHOLD_HINTS[method]} Source: {AUTO_THRESHOLD_CITATIONS[method]}.
      </p>
      {compared && (
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Automatic methods compared"
        >
          <table class="peak-table">
            <caption class="field-hint">
              Every method on the current image, as ImageJ's "Try all" does. The share is of the
              crop area before clean-up.
            </caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Grey level</th>
                <th scope="col">Marked as particles</th>
                <th scope="col">
                  <span class="visually-hidden">Choose</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {compared.map((r) => (
                <tr key={r.method} class={r.method === method ? 'is-selected-row' : undefined}>
                  <th scope="row">{AUTO_THRESHOLD_NAMES[r.method]}</th>
                  <td>
                    {r.level}
                    {r.fellBack && ' (no two peaks: Otsu)'}
                  </td>
                  <td>{formatNumber(r.share * 100, 3)} %</td>
                  <td>
                    <button
                      type="button"
                      class="btn"
                      disabled={r.method === method}
                      onClick={() => onChoose(r.method)}
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Advanced>
  );
}

export function downloadParticles(
  rows: readonly Particle[],
  scale: number,
  perPixelNm: number | null,
  edgeArea: { x: number; y: number; width: number; height: number },
  name: string,
  extra: readonly MeasureColumn[] = [],
) {
  const items = rows.map((p) => ({ p, s: sizesOf(p.runs, scale) }));
  const extraColumns = extra.flatMap((c) => {
    const value = (r: (typeof items)[number]) => c.value(r.p);
    if (c.kind === 'length')
      return [
        { header: `${c.header} (px)`, value },
        ...(perPixelNm === null
          ? []
          : [
              {
                header: `${c.header} (nm)`,
                value: (r: (typeof items)[number]) => value(r) * perPixelNm,
              },
            ]),
      ];
    if (c.kind === 'area')
      return [
        { header: `${c.header} (px2)`, value },
        ...(perPixelNm === null
          ? []
          : [
              {
                header: `${c.header} (nm2)`,
                value: (r: (typeof items)[number]) => value(r) * perPixelNm ** 2,
              },
            ]),
      ];
    return [{ header: c.kind === 'angle' ? `${c.header} (deg)` : c.header, value }];
  });
  const nm = (px: number) => (perPixelNm === null ? '' : px * perPixelNm);
  downloadCsv(
    `${name}-particles`,
    `Particles of ${name}. Pixels are of the original image. Sizes in nm use the scale drawn by the user${perPixelNm === null ? ' (none was set, so those columns are empty)' : ''}. Diameter is that of the circle with the same area; calipers are the longest and shortest Feret diameters; aspect ratio is longest over shortest caliper; circularity is 4 pi area / perimeter^2 (a circle drawn in pixels reads about 0.9).${extra.length > 0 ? ' Further columns follow ImageJ Set Measurements; grey values (0 to 255) are of the original image, before adjustments.' : ''}`,
    items,
    [
      { header: 'ID', value: (r) => r.p.id },
      { header: 'Origin', value: (r) => SOURCE_NAMES[r.p.source] },
      { header: 'Centre x (px)', value: (r) => r.s.cx },
      { header: 'Centre y (px)', value: (r) => r.s.cy },
      { header: 'Area (px2)', value: (r) => r.s.area },
      { header: 'Equal-area diameter (px)', value: (r) => r.s.eqDiameter },
      { header: 'Longest caliper (px)', value: (r) => r.s.feretMax },
      { header: 'Shortest caliper (px)', value: (r) => r.s.feretMin },
      { header: 'Aspect ratio', value: (r) => r.s.aspect },
      { header: 'Circularity', value: (r) => r.s.circularity },
      { header: 'Equal-area diameter (nm)', value: (r) => nm(r.s.eqDiameter) },
      { header: 'Longest caliper (nm)', value: (r) => nm(r.s.feretMax) },
      { header: 'Shortest caliper (nm)', value: (r) => nm(r.s.feretMin) },
      {
        header: 'Area (nm2)',
        value: (r) => (perPixelNm === null ? '' : r.s.area * perPixelNm ** 2),
      },
      {
        header: 'Touches the edge',
        value: (r) => (touchesEdge(r.p.runs, edgeArea) ? 'yes' : 'no'),
      },
      ...extraColumns,
    ],
  );
}
