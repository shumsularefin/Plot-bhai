import {
  refineRietveld,
  type RietveldInput,
  type RietveldOutcome,
} from '../core/xrd/rietveld/refine';
import { refineSeries, type SeriesItem, type SeriesPoint } from '../core/xrd/rietveld/sequential';
import { runPipeline, type ProcessingSettings } from '../core/xrd/process/pipeline';
import type { FormFactors } from '../core/xrd/reference/powder';
import scattering from '../../data/reference/scattering-factors.json';
import covalent from '../../data/reference/covalent-radii.json';
import dispersionTable from '../../data/reference/anomalous-dispersion.json';
import type { Anode, RadiationSettings } from '../core/xrd/radiation';
import type { Dispersion } from '../core/xrd/rietveld/structure';
import { dispersionFor, type DispersionFile } from '../core/xrd/rietveld/dispersion';

/** One pattern of a series, as loaded; the worker cleans and crops it like the single refinement. */
export interface SeriesPattern {
  id: string;
  name: string;
  value: number;
  twoTheta: Float64Array;
  intensity: Float64Array;
  /** Cleaning settings (normalisation off), or null to refine the uploaded data. */
  cleaning: ProcessingSettings | null;
  /** Kα2/Kα1 ratio of the model: 0 when Kα2 was stripped from this pattern. */
  ratio: number;
}

/** A series: the settings shared by every pattern (x and y are filled per pattern). */
export interface SeriesRequest {
  base: Omit<RietveldInput, 'x' | 'y'>;
  patterns: SeriesPattern[];
  radiation: RadiationSettings;
  /** 2θ range refined, degrees. */
  from: number;
  to: number;
  copyForward: boolean;
}

/** `anomalous`: the anode whose f′, f″ table to use, or missing for none. */
export type RietveldRequest =
  | { id: number; input: RietveldInput; anomalous?: Anode }
  | { id: number; series: SeriesRequest; anomalous?: Anode };

const dispersionOf = (anode?: Anode): Dispersion | undefined =>
  anode ? dispersionFor(dispersionTable as unknown as DispersionFile, anode) : undefined;
const dispersionInput = (anode?: Anode): { dispersion?: Dispersion } => {
  const dispersion = dispersionOf(anode);
  return dispersion ? { dispersion } : {};
};

export type RietveldResponse =
  | { id: number; kind: 'progress'; stage: string }
  | { id: number; kind: 'done'; outcome: RietveldOutcome }
  | { id: number; kind: 'series'; points: SeriesPoint[] };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<RietveldRequest>) => void) | null;
  postMessage(message: RietveldResponse): void;
}
const scope = self as unknown as WorkerScope;

const tables = (anode?: Anode) => ({
  factors: (scattering as unknown as { factors: FormFactors }).factors,
  radii: covalent.radii,
  ...dispersionInput(anode),
});

/** The input of one pattern of a series: cleaned (when asked), cropped, with the shared settings. */
function seriesItem(series: SeriesRequest, pattern: SeriesPattern, anode?: Anode): SeriesItem {
  const cleaned = pattern.cleaning
    ? runPipeline(pattern.twoTheta, pattern.intensity, pattern.cleaning, series.radiation)
    : null;
  const x = cleaned ? cleaned.twoTheta : pattern.twoTheta;
  const y = cleaned ? cleaned.intensity : pattern.intensity;
  const keep: number[] = [];
  x.forEach((v, i) => {
    if (v >= series.from && v <= series.to) keep.push(i);
  });
  return {
    id: pattern.id,
    name: pattern.name,
    value: pattern.value,
    input: {
      ...series.base,
      ...tables(anode),
      wavelengths: { ...series.base.wavelengths, ratio: pattern.ratio },
      x: Float64Array.from(keep, (i) => x[i] as number),
      y: Float64Array.from(keep, (i) => y[i] as number),
    },
  };
}

scope.onmessage = ({ data: request }) => {
  const progress = (stage: string) =>
    scope.postMessage({ id: request.id, kind: 'progress', stage });
  if ('series' in request) {
    const { series } = request;
    const items = series.patterns.map((p) => seriesItem(series, p, request.anomalous));
    const points = refineSeries(items, series.copyForward, refineRietveld, (index, total, stage) =>
      progress(`Pattern ${index + 1} of ${total}: ${stage}`),
    );
    scope.postMessage({ id: request.id, kind: 'series', points });
    return;
  }
  let outcome: RietveldOutcome;
  try {
    outcome = refineRietveld({ ...request.input, ...tables(request.anomalous) }, progress);
  } catch (e) {
    outcome = {
      ok: false,
      error: `The refinement failed: ${e instanceof Error ? e.message : 'unknown problem'}.`,
    };
  }
  scope.postMessage({ id: request.id, kind: 'done', outcome });
};
