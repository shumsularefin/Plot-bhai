import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { nearestIndex } from './decimate';
import { PlotSvg, plotMargins } from './PlotSvg';
import type { AxisLabels, Domain, PlotSeries } from './types';
import { clampDomain, panDomain, zoomDomain } from './view';

const FONT_SIZE = 12;
const LINE_WIDTH = 1.25;

interface InteractivePlotProps {
  series: readonly PlotSeries[];
  labels: AxisLabels;
  domain: Domain;
  extent: Domain;
  minSpan: number;
  onDomainChange: (domain: Domain) => void;
  /** Formats an x value for the readout, for example "2θ 31.78°". */
  formatX: (x: number) => string;
  /** Accessible description of the plot. */
  description: string;
}

interface Pointer {
  x: number;
  y: number;
}

/**
 * Screen plot with zoom and pan along x: mouse wheel, drag, two-finger pinch, keyboard
 * (arrows pan, + and − zoom, 0 resets) and a hover or tap readout. Vertical swipes still
 * scroll the page on touch screens. Redraws at most once per animation frame.
 */
export function InteractivePlot(props: InteractivePlotProps) {
  const { series, labels, domain, extent, minSpan, onDomainChange, formatX, description } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const height = Math.round(Math.min(520, Math.max(260, width * 0.6)));
  const m = plotMargins(FONT_SIZE);
  const innerW = Math.max(1, width - m.left - m.right);

  // Latest values for event handlers that live across renders.
  const live = useRef({ domain, extent, minSpan, innerW, onDomainChange });
  live.current = { domain, extent, minSpan, innerW, onDomainChange };

  const frame = useRef<number | null>(null);
  const pending = useRef<Domain | null>(null);
  const commit = (next: Domain) => {
    const { extent: e, minSpan: s, onDomainChange: change } = live.current;
    pending.current = clampDomain(next, e, s);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) change(pending.current);
      pending.current = null;
    });
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  /** Data x value under a client x coordinate. */
  const valueAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const {
      domain: [a, b],
      innerW: w,
    } = live.current;
    const left = (rect?.left ?? 0) + m.left;
    return a + ((clientX - left) / w) * (b - a);
  };

  // Wheel zoom needs a non-passive listener so the page does not scroll at the same time.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
      commit(zoomDomain(pending.current ?? live.current.domain, factor, valueAt(event.clientX)));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<{ start: Domain; points: Pointer[]; moved: boolean } | null>(null);

  const startGesture = () => {
    gesture.current = {
      start: live.current.domain,
      points: [...pointers.current.values()].map((p) => ({ ...p })),
      moved: gesture.current?.moved ?? false,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) {
      if (event.pointerType === 'mouse') setHoverX(valueAt(event.clientX));
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;
    const now = [...pointers.current.values()];
    const [a, b] = g.start;
    const perPixel = (b - a) / live.current.innerW;
    if (now.length === 1 && g.points.length === 1) {
      const dx = (now[0] as Pointer).x - (g.points[0] as Pointer).x;
      if (Math.abs(dx) > 3) g.moved = true;
      if (g.moved) commit(panDomain(g.start, -dx * perPixel));
    } else if (now.length >= 2 && g.points.length >= 2) {
      g.moved = true;
      const [p0, p1] = g.points as [Pointer, Pointer];
      const [n0, n1] = now as [Pointer, Pointer];
      const before = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const after = Math.hypot(n1.x - n0.x, n1.y - n0.y);
      if (before < 10 || after < 10) return;
      const rect = svgRef.current?.getBoundingClientRect();
      const left = (rect?.left ?? 0) + m.left;
      const anchorBefore = a + (((p0.x + p1.x) / 2 - left) / live.current.innerW) * (b - a);
      const zoomed = zoomDomain(g.start, after / before, anchorBefore);
      // Also follow the midpoint, so the gesture can pan while pinching.
      const shift =
        (((n0.x + n1.x) / 2 - (p0.x + p1.x) / 2) * (zoomed[1] - zoomed[0])) / live.current.innerW;
      commit(panDomain(zoomed, -shift));
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    const g = gesture.current;
    if (g && !g.moved && pointers.current.size === 1) setHoverX(valueAt(event.clientX));
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) startGesture();
    else gesture.current = null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const [a, b] = domain;
    const span = b - a;
    const centre = (a + b) / 2;
    const actions: Record<string, () => Domain> = {
      ArrowLeft: () => panDomain(domain, -span * 0.1),
      ArrowRight: () => panDomain(domain, span * 0.1),
      '+': () => zoomDomain(domain, 1.25, centre),
      '=': () => zoomDomain(domain, 1.25, centre),
      '-': () => zoomDomain(domain, 0.8, centre),
      '0': () => extent,
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      commit(action());
    }
  };

  const showHover = hoverX !== null && hoverX >= domain[0] && hoverX <= domain[1];
  const hoverPoints = showHover
    ? series.map((s) => {
        const i = nearestIndex(s.x, hoverX);
        return { s, x: s.x[i] as number, y: s.readoutY[i] as number };
      })
    : [];
  const readoutX = hoverPoints[0]?.x;

  return (
    <div class="interactive-plot" ref={containerRef}>
      <p class="plot-readout" aria-live="off">
        {readoutX === undefined ? (
          <span class="plot-readout-hint">
            Hover or tap the plot to read values. Scroll or pinch to zoom, drag to pan.
          </span>
        ) : (
          <>
            <span class="plot-readout-x">{formatX(readoutX)}</span>
            {hoverPoints.map(({ s, y }) => (
              <span key={s.id} class="plot-readout-item">
                <span class={`plot-swatch series-${s.colorIndex % 8}`} aria-hidden="true" />
                {series.length > 1 && <span class="plot-readout-name">{s.name}: </span>}
                {Number(y.toPrecision(6))} {s.readoutUnit}
              </span>
            ))}
          </>
        )}
      </p>
      <div
        ref={svgRef}
        class="plot-surface"
        style={{ height: `${height}px` }}
        tabIndex={0}
        role="img"
        aria-label={`${description} Use the arrow keys to pan, plus and minus to zoom, and 0 to show everything.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(event) => event.pointerType === 'mouse' && setHoverX(null)}
        onDblClick={() => commit(extent)}
        onKeyDown={onKeyDown}
      >
        {width > 0 && (
          <PlotSvg
            series={series}
            xDomain={domain}
            width={width}
            height={height}
            style={{ fontSize: FONT_SIZE, lineWidth: LINE_WIDTH }}
            labels={labels}
            samples={Math.ceil(innerW * (window.devicePixelRatio || 1))}
          >
            {readoutX !== undefined && (
              <line
                class="plot-crosshair"
                x1={((readoutX - domain[0]) / (domain[1] - domain[0])) * innerW}
                x2={((readoutX - domain[0]) / (domain[1] - domain[0])) * innerW}
                y1={0}
                y2={height - m.top - m.bottom}
              />
            )}
          </PlotSvg>
        )}
      </div>
    </div>
  );
}
