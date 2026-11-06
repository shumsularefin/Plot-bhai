import type { Rect } from '../core/particles/geometry';
import {
  detectParticles,
  prepareForDisplay,
  segment,
  type DetectSettings,
} from '../core/particles/detect/pipeline';
import type { Runs } from '../core/particles/detect/regions';

export type DetectRequest = {
  id: number;
  /** detect: find particles; mask: the threshold preview; adjust: the adjusted image to show. */
  kind: 'detect' | 'mask' | 'adjust';
  gray: Uint8Array;
  width: number;
  height: number;
  settings: DetectSettings;
  area: Rect | null;
};

export type DetectResponse =
  | {
      id: number;
      kind: 'detect';
      particles: Runs[];
      threshold: number;
      fellBack: boolean;
      diameter: number | null;
    }
  | {
      id: number;
      kind: 'mask';
      mask: Uint8Array;
      threshold: number;
      fellBack: boolean;
      histogram: Int32Array;
    }
  | { id: number; kind: 'adjust'; image: Uint8Array; rangeHistogram: Int32Array }
  | { id: number; kind: 'error' };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage(message: DetectResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  try {
    const { id, gray, width, height, settings, area } = request;
    if (request.kind === 'mask') {
      const { mask, threshold, fellBack, histogram } = segment(gray, width, height, settings, area);
      scope.postMessage({ id, kind: 'mask', mask, threshold, fellBack, histogram }, [
        mask.buffer,
        histogram.buffer,
      ]);
    } else if (request.kind === 'adjust') {
      const { image, rangeHistogram } = prepareForDisplay(gray, width, height, settings, area);
      // A copy, so the transfer never takes the buffer of the request's own pixels.
      const copy = image === gray ? image.slice() : image;
      scope.postMessage({ id, kind: 'adjust', image: copy, rangeHistogram }, [
        copy.buffer,
        rangeHistogram.buffer,
      ]);
    } else {
      const { particles, threshold, fellBack, diameter } = detectParticles(
        gray,
        width,
        height,
        settings,
        area,
      );
      scope.postMessage(
        { id, kind: 'detect', particles, threshold, fellBack, diameter },
        particles.map((p) => p.buffer as ArrayBuffer),
      );
    }
  } catch {
    scope.postMessage({ id: request.id, kind: 'error' }, []);
  }
};
