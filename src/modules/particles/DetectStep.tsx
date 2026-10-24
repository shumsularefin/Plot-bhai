import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cutAlongSegment, ellipseRuns } from '../../core/particles/detect/manual';
import { DEFAULT_DETECT_SETTINGS, type DetectSettings } from '../../core/particles/detect/pipeline';
import { mergeRuns, runsContain, touchesEdge } from '../../core/particles/detect/regions';
import {
  nmPerPixel,
  NM_PER_UNIT,
  UNIT_LABELS,
  type LengthUnit,
  type Point,
} from '../../core/particles/geometry';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import {
  calibrationOf,
  DEFAULT_FILTERS,
  type DetectState,
  type Particle,
  type ParticleData,
  type ParticleFilters,
} from './data';
import { DetectClient } from './detectClient';
import type { DecodedImage } from './decode';
import { grayOf, maskCanvas, workingSize } from './grayImage';
import { ImageGate } from './ImageGate';
import { ImageViewer, type DrawTool, type ParticleOverlay, type Tool } from './ImageViewer';
import { applyFilters, outlinePath, sizesOf } from './particleView';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  {
    tool: 'select',
    label: 'Select',
    hint: 'Click a particle to select it; click again to deselect. Hold Shift or Ctrl to select several. Drag to move the image.',
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
}

/** Wizard step 3: find particles automatically, then review, filter and correct them. */
export function DetectStep({ data, update }: StepContext<ParticleData>) {
  return (
    <div class="particle-step">
      <p class="message">
        <strong>Review the outlines.</strong> Automatic detection works best on well separated
        particles with good contrast. Check every outline against the image: merge, cut, delete or
        add particles where it went wrong. The result is an estimate.
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
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
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
  const area = useMemo(
    () =>
      data.crop
        ? {
            x: data.crop.x * work.scale,
            y: data.crop.y * work.scale,
            width: data.crop.width * work.scale,
            height: data.crop.height * work.scale,
          }
        : null,
    [data.crop, work.scale],
  );
  const key = JSON.stringify({ settings, area });
  const stale = detect.detectedWith !== null && detect.detectedWith !== key;

  // Live preview of the threshold mask while it is switched on.
  useEffect(() => {
    if (!showMask) {
      maskClient.current.cancel();
      setMask(null);
      return;
    }
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
          if (result && result !== 'error') setMask(maskCanvas(result.mask, g.width, g.height));
        } catch {
          setProblem('The preview could not be made in this browser.');
        }
      })();
    }, MASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [showMask, key]); // eslint-disable-line react-hooks/exhaustive-deps

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
      { particles: detect.particles, nextParticleId: detect.nextParticleId },
    ].slice(-UNDO_LIMIT);
    setCanUndo(true);
  };
  const edit = (particles: Particle[], nextParticleId = detect.nextParticleId) => {
    remember();
    setDetect({ particles, nextParticleId, edited: true });
  };
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    setSelected(new Set());
    setDetect({ particles: last.particles, nextParticleId: last.nextParticleId, edited: true });
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
    if (drawn === 'add-circle') {
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

  const patchDenoise = (patch: Partial<DetectSettings['denoise']>) =>
    setSettings({ ...settings, denoise: { ...settings.denoise, ...patch } });
  const patchThreshold = (patch: Partial<DetectSettings['threshold']>) =>
    setSettings({ ...settings, threshold: { ...settings.threshold, ...patch } });
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
  const foregroundShare =
    detect.particles.reduce((sum, p) => sum + sizesOf(p.runs, work.scale).area, 0) /
    (image.width * image.height);

  return (
    <>
      <section class="process-step is-on" aria-labelledby="prep-title">
        <h3 id="prep-title" class="process-step-title">
          1. Prepare the image
        </h3>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.invert}
            onChange={(e) => setSettings({ ...settings, invert: e.currentTarget.checked })}
          />
          The particles are darker than the background
        </label>
        <div class="radiation-fields">
          <label class="inline-field">
            Smoothing of noise
            <select
              value={settings.denoise.method}
              onChange={(e) =>
                patchDenoise({
                  method: e.currentTarget.value as DetectSettings['denoise']['method'],
                })
              }
            >
              <option value="none">None</option>
              <option value="gaussian">Gaussian blur</option>
              <option value="median">Median filter (slower)</option>
            </select>
          </label>
          {settings.denoise.method !== 'none' && (
            <NumberInput
              label={
                settings.denoise.method === 'gaussian' ? 'Blur width (px)' : 'Median radius (px)'
              }
              value={settings.denoise.size}
              min={0}
              max={settings.denoise.method === 'median' ? 3 : 10}
              step={settings.denoise.method === 'median' ? 1 : 0.5}
              onChange={(v) => v !== null && patchDenoise({ size: v })}
            />
          )}
          <HelpTip term="noise smoothing">
            <p>
              Electron micrographs are grainy. A light blur (about 1 pixel) or a median filter evens
              out the grain so the threshold does not pick it up. Too much smoothing rounds the
              outlines and joins close particles.
            </p>
          </HelpTip>
        </div>
      </section>

      <section class="process-step is-on" aria-labelledby="thr-title">
        <h3 id="thr-title" class="process-step-title">
          2. Separate particles from the background{' '}
          <HelpTip term="threshold">
            <p>
              A threshold turns the image into black and white: pixels brighter than the threshold
              are particles. Otsu finds the level that best separates the two groups of grey values
              (inside the crop area only). Adaptive compares each pixel with its neighbourhood,
              which copes with a background that gets brighter across the image. Manual lets you
              choose the level; use the preview.
            </p>
          </HelpTip>
        </h3>
        <fieldset class="method-choice">
          <legend>Method</legend>
          {(
            [
              ['otsu', 'Otsu (automatic)'],
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
        {detect.thresholdUsed !== null && settings.threshold.method === 'otsu' && (
          <p class="field-hint">
            Otsu chose grey level {detect.thresholdUsed} in the last detection.
          </p>
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
            onChange={(e) =>
              setSettings({
                ...settings,
                split: { ...settings.split, enabled: e.currentTarget.checked },
              })
            }
          />
          Split touching particles
        </label>
        {settings.split.enabled && (
          <label class="slider-field">
            Split where the neck is narrower than <strong>{settings.split.neckPercent} %</strong> of
            the smaller radius
            <input
              type="range"
              min={30}
              max={95}
              step={5}
              value={settings.split.neckPercent}
              onInput={(e) =>
                setSettings({
                  ...settings,
                  split: { ...settings.split, neckPercent: Number(e.currentTarget.value) },
                })
              }
            />
          </label>
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
          onClick={() => setSettings(DEFAULT_DETECT_SETTINGS)}
          disabled={JSON.stringify(settings) === JSON.stringify(DEFAULT_DETECT_SETTINGS)}
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
          may be darker than the background (tick the box in part 1), or the threshold is too low.
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
      <ImageViewer
        image={image}
        tool={tool}
        crop={data.crop}
        particles={overlays}
        workScale={work.scale}
        mask={mask}
        onPick={pick}
        onDraw={draw}
        label="Image with the detected particles"
      />
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
                    <th scope="col">Select</th>
                    <th scope="col">ID</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Diameter (equal area)</th>
                    <th scope="col">Longest caliper</th>
                    <th scope="col">Shortest caliper</th>
                    <th scope="col">Aspect ratio</th>
                    <th scope="col">Circularity</th>
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
    </>
  );
}

export function downloadParticles(
  rows: readonly Particle[],
  scale: number,
  perPixelNm: number | null,
  edgeArea: { x: number; y: number; width: number; height: number },
  name: string,
) {
  const items = rows.map((p) => ({ p, s: sizesOf(p.runs, scale) }));
  const nm = (px: number) => (perPixelNm === null ? '' : px * perPixelNm);
  downloadCsv(
    `${name}-particles`,
    `Particles of ${name}. Pixels are of the original image. Sizes in nm use the scale drawn by the user${perPixelNm === null ? ' (none was set, so those columns are empty)' : ''}. Diameter is that of the circle with the same area; calipers are the longest and shortest Feret diameters; aspect ratio is longest over shortest caliper; circularity is 4 pi area / perimeter^2 (a circle drawn in pixels reads about 0.9).`,
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
    ],
  );
}
