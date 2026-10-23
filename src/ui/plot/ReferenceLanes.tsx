import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { plotMargins } from './PlotSvg';
import type { Domain } from './types';

/** One reference phase: sticks at 2θ with heights as fractions of the strongest line (0 to 1). */
export interface ReferenceLane {
  id: string;
  name: string;
  /** Index into the plot palette. */
  colorIndex: number;
  lines: { x: number; height: number; found?: boolean }[];
}

/** Same font size as the interactive plot, so the lanes line up with its plot area. */
const FONT_SIZE = 12;
const LANE_HEIGHT = 36;
const BASE_GAP = 4;

interface ReferenceLanesProps {
  lanes: readonly ReferenceLane[];
  domain: Domain;
}

/**
 * Stick patterns drawn under a plot, one lane per phase, over the same x range. Lines found in
 * the measured data are solid; reference lines without a measured peak are dashed and faint.
 */
export function ReferenceLanes({ lanes, domain }: ReferenceLanesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
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

  const m = plotMargins(FONT_SIZE);
  const innerW = Math.max(1, width - m.left - m.right);
  const [x0, x1] = domain;
  const px = (x: number) => ((x - x0) / (x1 - x0)) * innerW;
  const height = lanes.length * LANE_HEIGHT;

  return (
    <div class="reference-lanes" ref={containerRef} style={{ height: `${height}px` }}>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`Reference lines of ${lanes.map((l) => l.name).join(', ')}. The table below lists every line.`}
        >
          {lanes.map((lane, i) => {
            const base = LANE_HEIGHT - BASE_GAP;
            return (
              <g key={lane.id} transform={`translate(${m.left} ${i * LANE_HEIGHT})`}>
                <line class="lane-base" x1={0} x2={innerW} y1={base} y2={base} />
                {lane.lines
                  .filter((l) => l.x >= x0 && l.x <= x1)
                  .map((l, k) => (
                    <line
                      key={k}
                      class={`plot-line series-${lane.colorIndex % 8}${l.found === false ? ' lane-missing' : ''}`}
                      x1={px(l.x)}
                      x2={px(l.x)}
                      y1={base}
                      y2={base - Math.max(3, l.height * (LANE_HEIGHT - 14))}
                    />
                  ))}
                <text class="lane-name" x={4} y={FONT_SIZE - 1}>
                  {lane.name}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
