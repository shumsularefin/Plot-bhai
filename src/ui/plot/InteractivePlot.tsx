import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { nearestIndex } from './decimate';
import { PlotSvg, plotMargins, visibleYDomain } from './PlotSvg';
import type { AxisLabels, Domain, PlotMarker, PlotSeries } from './types';
import { clampDomain, panDomain, zoomDomain } from './view';

const FONT_SIZE = 12;
const LINE_WIDTH = 1.25;

export interface InteractivePlotProps {
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
  /** Called with data coordinates when the plot is clicked or tapped without dragging. */
  onPlotClick?: (x: number, y: number) => void;
  markers?: readonly PlotMarker[];
  /** Readout text shown before the first hover. */
  hint?: string;
  /** Called when a marker is clicked or tapped (instead of onPlotClick). */
  onMarkerClick?: (index: number) => void;
  /** When given, markers can be dragged sideways; called with the new x while dragging. */
  onMarkerDrag?: (index: number, x: number) => void;
  onMarkerDragEnd?: () => void;
  /** Plot height in px for a given width; defaults to 60 % of the width, 260 to 520 px. */
  heightFor?: (width: number) => number;
  /** Hide the readout line (for a secondary panel that shares the main plot's readout). */
  hideReadout?: boolean;
}

/** How close (px) a pointer must be to a marker to pick it; larger for fingers. */
const HIT_MOUSE = 12;
const HIT_TOUCH = 22;

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
  const {
    series,
    labels,
    domain,
    extent,
    minSpan,
    onDomainChange,
    formatX,
    description,
    onPlotClick,
    markers,
    onMarkerClick,
    onMarkerDrag,
    onMarkerDragEnd,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const height = Math.round(props.heightFor?.(width) ?? Math.min(520, Math.max(260, width * 0.6)));
  const m = plotMargins(FONT_SIZE);
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const yDomain = visibleYDomain(series, domain);

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

  /** Index of the marker under a client position, or −1. */
  const markerAt = (clientX: number, clientY: number, touch: boolean) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !markers) return -1;
    const [a, b] = domain;
    const [y0, y1] = yDomain;
    const limit = touch ? HIT_TOUCH : HIT_MOUSE;
    let best = -1;
    let bestDistance = limit;
    markers.forEach((marker, i) => {
      const mx = rect.left + m.left + ((marker.x - a) / (b - a)) * innerW;
      const my = rect.top + m.top + innerH - ((marker.y - y0) / (y1 - y0)) * innerH;
      const distance = Math.hypot(mx - clientX, my - clientY);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  };
  const dragging = useRef<number | null>(null);

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
    if (onMarkerDrag && pointers.current.size === 0) {
      const hit = markerAt(event.clientX, event.clientY, event.pointerType !== 'mouse');
      if (hit >= 0) {
        dragging.current = hit;
        return;
      }
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragging.current !== null) {
      onMarkerDrag?.(dragging.current, valueAt(event.clientX));
      return;
    }
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
    if (dragging.current !== null) {
      dragging.current = null;
      onMarkerDragEnd?.();
      return;
    }
    const g = gesture.current;
    if (g && !g.moved && pointers.current.size === 1) {
      const x = valueAt(event.clientX);
      setHoverX(x);
      const hit = onMarkerClick
        ? markerAt(event.clientX, event.clientY, event.pointerType !== 'mouse')
        : -1;
      if (hit >= 0) onMarkerClick?.(hit);
      else if (onPlotClick) {
        const top = (svgRef.current?.getBoundingClientRect().top ?? 0) + m.top;
        const [y0, y1] = yDomain;
        onPlotClick(x, y1 - ((event.clientY - top) / innerH) * (y1 - y0));
      }
    }
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
    ? series
        .filter(
          (s) =>
            !s.quiet &&
            s.x.length > 0 &&
            hoverX >= (s.x[0] as number) &&
            hoverX <= (s.x[s.x.length - 1] as number),
        )
        .map((s) => {
          const i = nearestIndex(s.x, hoverX);
          return { s, x: s.x[i] as number, y: s.readoutY[i] as number };
        })
        .filter((point) => !Number.isNaN(point.y))
    : [];
  const readoutCount = series.filter((s) => !s.quiet).length;
  const readoutX = hoverPoints[0]?.x;

  return (
    <div class="interactive-plot" ref={containerRef}>
      {!props.hideReadout && (
        <p class="plot-readout" aria-live="off">
          {readoutX === undefined ? (
            <span class="plot-readout-hint">
              {props.hint ??
                'Hover or tap the plot to read values. Scroll or pinch to zoom, drag to pan.'}
            </span>
          ) : (
            <>
              <span class="plot-readout-x">{formatX(readoutX)}</span>
              {hoverPoints.map(({ s, y }) => (
                <span key={s.id} class="plot-readout-item">
                  <span class={`plot-swatch series-${s.colorIndex % 8}`} aria-hidden="true" />
                  {readoutCount > 1 && <span class="plot-readout-name">{s.name}: </span>}
                  {Number(y.toPrecision(6))} {s.readoutUnit}
                </span>
              ))}
            </>
          )}
        </p>
      )}
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
            yDomain={yDomain}
            {...(markers && { markers })}
          >
            {readoutX !== undefined && (
              <line
                class="plot-crosshair"
                x1={((readoutX - domain[0]) / (domain[1] - domain[0])) * innerW}
                x2={((readoutX - domain[0]) / (domain[1] - domain[0])) * innerW}
                y1={0}
                y2={innerH}
              />
            )}
          </PlotSvg>
        )}
      </div>
    </div>
  );
}
