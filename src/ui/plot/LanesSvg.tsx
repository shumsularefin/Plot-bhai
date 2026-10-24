import type { SVGAttributes } from 'preact';
import { PRINT_COLORS } from './palette';
import type { ReferenceLane } from './ReferenceLanes';
import { plotMargins, type PlotStyle } from './PlotSvg';
import type { Domain } from './types';

/** Height of one lane in an exported figure, as a multiple of the font size. */
export const LANE_HEIGHT_EM = 3.2;

interface LanesSvgProps {
  lanes: readonly ReferenceLane[];
  xDomain: Domain;
  width: number;
  style: PlotStyle;
  svgAttributes: SVGAttributes<SVGSVGElement>;
}

/**
 * Reference stick patterns for an exported figure, one lane per phase over the same 2θ range
 * and the same left and right margins as the plot above, so the sticks line up with the
 * peaks. The lane name (phase and COD ID) sits at the left edge of its lane. Reference lines
 * with no measured peak are drawn thinner and lighter, as on screen.
 */
export function LanesSvg({ lanes, xDomain, width, style, svgAttributes }: LanesSvgProps) {
  const m = plotMargins(style.fontSize);
  const innerW = Math.max(1, width - m.left - m.right);
  const laneH = style.fontSize * LANE_HEIGHT_EM;
  const height = lanes.length * laneH;
  const [x0, x1] = xDomain;
  const px = (x: number) => ((x - x0) / (x1 - x0)) * innerW;
  const font = style.print?.fontFamily;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} {...svgAttributes}>
      <rect width={width} height={height} fill="#ffffff" />
      {lanes.map((lane, i) => {
        const base = laneH - style.fontSize * 0.3;
        const stickMax = laneH - style.fontSize * 1.5;
        const colour = PRINT_COLORS[lane.colorIndex % PRINT_COLORS.length];
        return (
          <g key={lane.id} transform={`translate(${m.left} ${i * laneH})`}>
            <path d={`M0 ${base}H${innerW}`} stroke="#000000" stroke-width={0.5} fill="none" />
            {lane.lines
              .filter((l) => l.x >= x0 && l.x <= x1)
              .map((l, k) => (
                <path
                  key={k}
                  d={`M${px(l.x).toFixed(2)} ${base}v${-Math.max(style.fontSize * 0.3, l.height * stickMax)}`}
                  stroke={colour}
                  stroke-opacity={l.found === false ? 0.45 : 1}
                  stroke-width={style.lineWidth * (l.found === false ? 0.6 : 1)}
                  fill="none"
                />
              ))}
            <text
              x={style.fontSize * 0.3}
              y={style.fontSize * 0.95}
              font-family={font}
              font-size={style.fontSize}
              fill="#000000"
            >
              {lane.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
