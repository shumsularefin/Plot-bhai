import { fitBands, type BandFitOptions } from '../core/ftir/bands';
import { detectPeaks, type DetectedPeak, type DetectionOptions } from '../core/xrd/peaks/detect';
import { fitPeaks, type FitOptions, type PeakGuess, type RegionFit } from '../core/xrd/peaks/fit';

export type PeaksRequest =
  | { id: number; kind: 'detect'; x: Float64Array; y: Float64Array; options: DetectionOptions }
  | {
      id: number;
      kind: 'fit';
      x: Float64Array;
      y: Float64Array;
      guesses: PeakGuess[];
      options: FitOptions;
    }
  | { id: number; kind: 'bands'; x: Float64Array; y: Float64Array; options: BandFitOptions };

export type PeaksResponse =
  | { id: number; kind: 'detect'; peaks: DetectedPeak[] }
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'fit'; regions: RegionFit[] }
  | { id: number; kind: 'error' };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<PeaksRequest>) => void) | null;
  postMessage(message: PeaksResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  try {
    if (request.kind === 'detect') {
      scope.postMessage({
        id: request.id,
        kind: 'detect',
        peaks: detectPeaks(request.x, request.y, request.options),
      });
    } else if (request.kind === 'bands') {
      const region = fitBands(request.x, request.y, request.options);
      scope.postMessage({ id: request.id, kind: 'fit', regions: [region] });
    } else {
      const regions = fitPeaks(
        request.x,
        request.y,
        request.guesses,
        request.options,
        (done, total) => scope.postMessage({ id: request.id, kind: 'progress', done, total }),
      );
      scope.postMessage({ id: request.id, kind: 'fit', regions });
    }
  } catch {
    scope.postMessage({ id: request.id, kind: 'error' });
  }
};
