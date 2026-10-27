import type { Pattern } from '../../../core/xrd/types';
import { ANODES } from '../../../core/xrd/radiation';
import { MAX_SERIES } from '../../../ui/plot/palette';
import { xrdLabels } from '../../xrd/labels';
import { xrdStore } from '../../xrd/xrdStore';
import { curveName, digitizedNotes } from '../digitized';
import { DigitizeTool } from '../DigitizeTool';
import { drawFigure } from '../example';
import { SendButton } from '../SendButton';
import type { DigitizeTarget, SendProps } from '../target';

/*
 * Example: made-up peaks whose widths follow the Scherrer equation for 18 nm crystallites
 * (K = 0.9, Cu Kα1), with a red reference curve above them, as a figure in a paper might look.
 */
const SIZE_NM = 18;
const K = 0.9;
const PEAKS = [
  { center: 28, height: 620 },
  { center: 33, height: 900 },
  { center: 47.5, height: 480 },
  { center: 56.2, height: 380 },
  { center: 69.4, height: 260 },
];

/** FWHM in degrees 2θ of D nm crystallites: β = Kλ / (D cos θ), β in radians, λ and D in nm. */
function scherrerWidth(center: number): number {
  const lambdaNm = ANODES.Cu.kAlpha1 / 10;
  const beta = (K * lambdaNm) / (SIZE_NM * Math.cos(((center / 2) * Math.PI) / 180));
  return (beta * 180) / Math.PI;
}

function sample(x: number): number {
  const background = 90 + 60 * Math.exp(-(x - 10) / 12);
  return PEAKS.reduce((sum, p) => {
    const d = (x - p.center) / (scherrerWidth(p.center) / 2);
    return sum + p.height * (0.5 / (1 + d * d) + 0.5 * Math.exp(-Math.LN2 * d * d));
  }, background);
}

const example = () =>
  drawFigure({
    x: [10, 80],
    xTick: 10,
    xTitle: '2θ (degrees)',
    y: [0, 1600],
    yTick: 200,
    yLabelsTo: 1400,
    curves: [
      // Offset above the sample so the two curves never cross.
      { f: (x) => 1120 + 0.35 * sample(x), color: '#d62728', label: 'Reference' },
      { f: sample, color: '#000000', label: 'Sample' },
    ],
    traced: { index: 1, rgb: [0, 0, 0], at: 40 },
    marks: { x: [20, 70], y: [0, 1000] },
    description: `A generated figure, not from a real paper: the black curve has made-up peaks whose widths match ${SIZE_NM} nm crystallites (Scherrer, K = ${K}, Cu Kα1, no instrument broadening), so the size found later can be checked against ${SIZE_NM} nm.`,
  });

/** XRD step after the upload, where a handed-over pattern is seen with the others. */
const XRD_UPLOAD_STEP = 0;

function Send({ data, curve, result }: SendProps) {
  const add = async () => {
    // Saved work must be loaded first, or it would overwrite this pattern when it arrives.
    await xrdStore.ready;
    const current = xrdStore.get();
    if (current.data.patterns.length >= MAX_SERIES)
      return `The XRD analysis already holds ${MAX_SERIES} patterns, the most it can show. Remove one there, then come back.`;
    const pattern: Pattern = {
      id: crypto.randomUUID(),
      name: curveName(data),
      source: 'digitized',
      twoTheta: curve.x,
      intensity: curve.y,
      intensityUnit: 'cps',
      unitOrigin: 'user',
      synthetic: data.image?.synthetic ?? false,
      digitized: {
        image: data.image?.name ?? '',
        pixelDeg: curve.step,
        lineWidthPx: result.extraction.lineWidth,
        yScale: data.yScale,
      },
      notes: digitizedNotes(curve, target.axes),
    };
    xrdStore.set({
      ...current,
      step: XRD_UPLOAD_STEP,
      data: { ...current.data, patterns: [...current.data.patterns, pattern] },
    });
    return null;
  };
  return (
    <>
      <p>
        In the XRD Results step, a &quot;Check against the paper&quot; section compares your sizes
        with the ones the paper reports.
      </p>
      <SendButton label="Add to my XRD analysis" onSend={add} route={target.route} />
    </>
  );
}

const target: DigitizeTarget = {
  tool: 'XRD',
  route: '#/xrd',
  // The keys of the earlier "XRD from a screenshot" tool, so saved work is kept.
  storeKey: 'xrd-screenshot-session',
  imageKey: 'xrd-screenshot-image',
  figure: 'an XRD pattern',
  axes: {
    x: '2θ',
    y: 'intensity',
    xIncreasesRight: true,
    xShort: '2θ',
    yShort: 'I',
    xUnit: '°',
    xCsv: '2theta (deg)',
    xDigits: 2,
    yMayBeNegative: false,
  },
  labels: xrdLabels(false),
  example,
  Send,
};

export default function XrdFromImage() {
  return <DigitizeTool target={target} />;
}
