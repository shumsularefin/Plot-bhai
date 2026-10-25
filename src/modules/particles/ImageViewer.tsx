import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { distance, type Measurement, type Point, type Rect } from '../../core/particles/geometry';
import {
  fitView,
  MAX_ZOOM_FACTOR,
  pan,
  toImage,
  toScreen,
  zoomAt,
  type ViewTransform,
} from '../../core/particles/view';
import { wheelZooms } from '../../ui/plot/InteractivePlot';
import type { DecodedImage } from './decode';
import './particles.css';

export type Tool =
  | 'pan'
  | 'select'
  | 'scale'
  | 'crop'
  | 'line'
  | 'circle'
  | 'ellipse'
  | 'add-circle'
  | 'add-ellipse'
  | 'cut';
/** Tools that draw by dragging. */
export type DrawTool = Exclude<Tool, 'pan' | 'select'>;

/** A detected particle on the overlay: outline path in working grid pixels and a label position. */
export interface ParticleOverlay {
  id: number;
  d: string;
  selected: boolean;
  /** Label position in original pixels. */
  cx: number;
  cy: number;
}

/** A drag shorter than this many screen pixels is a click, not a drawing. */
const MIN_DRAG_PX = 4;

interface ImageViewerProps {
  image: DecodedImage;
  tool: Tool;
  crop?: Rect | null;
  scale?: { p1: Point; p2: Point } | null;
  measurements?: readonly Measurement[];
  /** Called when the user finishes dragging with a drawing tool; points are in original pixels. */
  onDraw?: (tool: DrawTool, a: Point, b: Point) => void;
  /** Detected particles (outlines on the working grid) and the working copy's scale to the original. */
  particles?: readonly ParticleOverlay[];
  workScale?: number;
  /** Threshold preview, drawn over the image: a canvas the size of the working copy. */
  mask?: HTMLCanvasElement | null;
  /** Called when the Select tool is clicked (not dragged); extend is true with Shift, Ctrl or Cmd. */
  onPick?: (point: Point, extend: boolean) => void;
  /** Accessible description of what the viewer is for. */
  label: string;
}

interface Gesture {
  mode: 'none' | 'draw' | 'pan' | 'pinch';
  start?: { distance: number; view: ViewTransform; mid: Point };
  last?: Point;
  /** Where a drawing began, in original pixels, and the screen position of it. */
  from?: Point;
  fromScreen?: Point;
}

/**
 * Image on a canvas with a vector overlay for crop, scale bar and measurements. Mouse and touch:
 * drag with the pan tool to move, drag with a drawing tool to draw, pinch with two fingers to
 * zoom (a second finger cancels a drawing), the wheel zooms with Ctrl/Cmd or when the viewer
 * has focus. Keyboard: arrows pan, + and − zoom, 0 fits the image. All coordinates handed out
 * are in pixels of the original image.
 */
export function ImageViewer(props: ImageViewerProps) {
  const { image, tool, crop, scale, measurements = [], onDraw, onPick, label } = props;
  const particles = props.particles ?? [];
  const workScale = props.workScale ?? 1;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewTransform | null>(null);
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ mode: 'none' });

  const fit = size.width > 0 ? fitView(size.width, size.height, image.width, image.height) : null;
  const minScale = fit?.scale ?? 1;

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fit the image when it first has a size and when the image changes; refit when the box
  // changes size (window resize, rotation, a panel docking) unless the user has zoomed or panned.
  const imageKey = `${image.width}x${image.height}-${image.workScale}`;
  const fittedFor = useRef('');
  const lastFit = useRef<ViewTransform | null>(null);
  useEffect(() => {
    if (!fit) return;
    const untouched =
      view === null ||
      (lastFit.current !== null &&
        view.scale === lastFit.current.scale &&
        view.tx === lastFit.current.tx &&
        view.ty === lastFit.current.ty);
    if (fittedFor.current !== imageKey || untouched) {
      fittedFor.current = imageKey;
      lastFit.current = fit;
      setView(fit);
    }
  }, [fit?.scale, fit?.tx, fit?.ty, imageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || !view || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * dpr);
    element.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    // Pixels of the working copy that one screen pixel covers: smooth when shrinking, sharp when enlarging.
    ctx.imageSmoothingEnabled = view.scale * image.workScale ** -1 < 2.5;
    ctx.drawImage(
      image.source,
      view.tx,
      view.ty,
      image.width * view.scale,
      image.height * view.scale,
    );
  }, [view, size, image]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!wheelZooms(event, element)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
      setView((v) =>
        v ? zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top, minScale) : v,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [minScale]);

  const local = (event: PointerEvent): Point => {
    const rect = (box.current as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!view) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        mode: 'pinch',
        start: { distance: distance(a, b), view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } },
      };
      setDraft(null);
      return;
    }
    if (tool === 'pan' || tool === 'select') {
      gesture.current = { mode: 'pan', last: p, fromScreen: p };
    } else {
      const from = toImage(p, view);
      gesture.current = { mode: 'draw', from, fromScreen: p };
      setDraft({ a: from, b: from });
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!view || !pointers.current.has(event.pointerId)) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    const g = gesture.current;
    if (g.mode === 'draw' && g.from) {
      setDraft({ a: g.from, b: toImage(p, view) });
    } else if (g.mode === 'pan' && g.last) {
      setView(pan(view, p.x - g.last.x, p.y - g.last.y));
      g.last = p;
    } else if (g.mode === 'pinch' && g.start && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = distance(a, b);
      if (g.start.distance < 10 || d < 10) return;
      const zoomed = zoomAt(
        g.start.view,
        d / g.start.distance,
        g.start.mid.x,
        g.start.mid.y,
        minScale,
      );
      setView(pan(zoomed, mid.x - g.start.mid.x, mid.y - g.start.mid.y));
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    const p = local(event);
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (g.mode === 'draw' && g.from && g.fromScreen && view) {
      if (distance(p, g.fromScreen) >= MIN_DRAG_PX && tool !== 'pan' && tool !== 'select') {
        onDraw?.(tool, g.from, toImage(p, view));
      }
      setDraft(null);
      gesture.current = { mode: 'none' };
    } else if (g.mode === 'pan' && tool === 'select' && g.fromScreen && view) {
      if (distance(p, g.fromScreen) < MIN_DRAG_PX) {
        onPick?.(toImage(p, view), event.shiftKey || event.ctrlKey || event.metaKey);
      }
      gesture.current = { mode: 'none' };
    } else if (g.mode === 'pinch' && pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()] as [Point];
      gesture.current = { mode: 'pan', last: rest };
    } else if (pointers.current.size === 0) {
      gesture.current = { mode: 'none' };
    }
  };

  const zoomBy = (factor: number) =>
    setView((v) => (v ? zoomAt(v, factor, size.width / 2, size.height / 2, minScale) : v));
  const reset = () => fit && setView(fit);

  const onKeyDown = (event: KeyboardEvent) => {
    const step = 40;
    const actions: Record<string, () => void> = {
      '+': () => zoomBy(1.25),
      '=': () => zoomBy(1.25),
      '-': () => zoomBy(1 / 1.25),
      '0': reset,
      ArrowLeft: () => setView((v) => (v ? pan(v, step, 0) : v)),
      ArrowRight: () => setView((v) => (v ? pan(v, -step, 0) : v)),
      ArrowUp: () => setView((v) => (v ? pan(v, 0, step) : v)),
      ArrowDown: () => setView((v) => (v ? pan(v, 0, -step) : v)),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const s = (p: Point) => (view ? toScreen(p, view) : p);
  const zoomPercent = view && fit ? Math.round((view.scale / fit.scale) * 100) : 100;

  return (
    <div class="image-viewer-wrap">
      <div
        ref={box}
        class={`image-viewer tool-${tool}`}
        role="group"
        aria-label={`${label}. Arrow keys move the image, plus and minus zoom, 0 fits it.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} class="image-canvas" style={{ width: '100%', height: '100%' }} />
        {view && size.width > 0 && (
          <svg class="image-overlay" width={size.width} height={size.height} aria-hidden="true">
            {crop && <CropShade crop={crop} size={size} s={s} />}
            {scale && <Shape kind="scale" a={s(scale.p1)} b={s(scale.p2)} />}
            {measurements.map((m) => (
              <Shape key={m.id} kind={m.kind} a={s(m.a)} b={s(m.b)} id={m.id} />
            ))}
            {particles.length > 0 && (
              <>
                <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale / workScale})`}>
                  {particles.map((q) => (
                    <path
                      key={q.id}
                      d={q.d}
                      class={`particle-outline${q.selected ? ' is-selected' : ''}`}
                    />
                  ))}
                </g>
                {particles.length <= MAX_LABELS &&
                  particles.map((q) => {
                    const at = s({ x: q.cx, y: q.cy });
                    return (
                      <text
                        key={q.id}
                        x={at.x}
                        y={at.y}
                        class="particle-label"
                        text-anchor="middle"
                      >
                        {q.id}
                      </text>
                    );
                  })}
              </>
            )}
            {draft && tool !== 'pan' && tool !== 'select' && (
              <Shape kind={draftKind(tool)} a={s(draft.a)} b={s(draft.b)} draft />
            )}
          </svg>
        )}
      </div>
      <div class="viewer-buttons">
        <button type="button" class="btn" onClick={() => zoomBy(1.25)}>
          Zoom in
        </button>
        <button type="button" class="btn" onClick={() => zoomBy(1 / 1.25)}>
          Zoom out
        </button>
        <button type="button" class="btn" onClick={reset}>
          Fit image
        </button>
        <span class="field-hint" role="status">
          {zoomPercent} % of the fitted size (up to {MAX_ZOOM_FACTOR} ×).
        </span>
      </div>
      <p class="field-hint">
        Drag to {tool === 'pan' || tool === 'select' ? 'move the image' : 'draw'}; pinch with two
        fingers to zoom, or hold Ctrl or Cmd and scroll. Click the image first to use the keyboard.
      </p>
    </div>
  );
}

function CropShade({
  crop,
  size,
  s,
}: {
  crop: Rect;
  size: { width: number; height: number };
  s: (p: Point) => Point;
}) {
  const a = s({ x: crop.x, y: crop.y });
  const b = s({ x: crop.x + crop.width, y: crop.y + crop.height });
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return (
    <>
      <path
        d={`M0 0H${size.width}V${size.height}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`}
        class="crop-shade"
        fill-rule="evenodd"
      />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} class="shape-halo" fill="none" />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} class="shape shape-crop" fill="none" />
    </>
  );
}

type ShapeKind = 'scale' | 'line' | 'circle' | 'ellipse' | 'cropDraft' | 'cut';

/** Particle numbers are drawn on the image only while there are not too many of them. */
const MAX_LABELS = 150;

function draftKind(tool: DrawTool): ShapeKind {
  if (tool === 'crop') return 'cropDraft';
  if (tool === 'add-circle') return 'circle';
  if (tool === 'add-ellipse') return 'ellipse';
  return tool;
}

/** One overlay shape in screen coordinates: a dark outline under a coloured one, so it shows on any image. */
function Shape({
  kind,
  a,
  b,
  id,
  draft,
}: {
  kind: ShapeKind;
  a: Point;
  b: Point;
  id?: number;
  draft?: boolean;
}) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const cls = `shape shape-${kind === 'cropDraft' ? 'crop' : kind}${draft ? ' is-draft' : ''}`;
  const halo = 'shape-halo';
  const label = id !== undefined && (
    <text x={mid.x + 6} y={mid.y - 6} class="shape-label">
      {id}
    </text>
  );
  if (kind === 'ellipse' || kind === 'cropDraft') {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const body =
      kind === 'ellipse' ? (
        <>
          <ellipse cx={mid.x} cy={mid.y} rx={w / 2} ry={h / 2} class={halo} fill="none" />
          <ellipse cx={mid.x} cy={mid.y} rx={w / 2} ry={h / 2} class={cls} fill="none" />
        </>
      ) : (
        <>
          <rect x={x} y={y} width={w} height={h} class={halo} fill="none" />
          <rect x={x} y={y} width={w} height={h} class={cls} fill="none" />
        </>
      );
    return (
      <g>
        {body}
        {label}
      </g>
    );
  }
  const radius = distance(a, b) / 2;
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class={halo} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class={cls} />
      {kind === 'circle' && (
        <>
          <circle cx={mid.x} cy={mid.y} r={radius} class={halo} fill="none" />
          <circle cx={mid.x} cy={mid.y} r={radius} class={cls} fill="none" />
        </>
      )}
      {kind === 'scale' && (
        <>
          <circle cx={a.x} cy={a.y} r={4} class={cls} />
          <circle cx={b.x} cy={b.y} r={4} class={cls} />
        </>
      )}
      {label}
    </g>
  );
}
