import {
  runPipeline,
  type ProcessingResult,
  type ProcessingSettings,
} from '../core/xrd/process/pipeline';
import type { RadiationSettings } from '../core/xrd/radiation';

export interface ProcessRequest {
  id: number;
  twoTheta: Float64Array;
  intensity: Float64Array;
  settings: ProcessingSettings;
  radiation: RadiationSettings;
}

export interface ProcessResponse {
  id: number;
  result: ProcessingResult | null;
}

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null;
  postMessage(message: ProcessResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  let result: ProcessingResult | null;
  try {
    result = runPipeline(request.twoTheta, request.intensity, request.settings, request.radiation);
  } catch {
    result = null;
  }
  const buffers = result
    ? [result.twoTheta, result.beforeBackground, result.background, result.intensity]
        .map((a) => a?.buffer)
        .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
    : [];
  // Arrays may be shared (a step that was off returns its input), so transfer each buffer once.
  scope.postMessage({ id: request.id, result }, [...new Set(buffers)]);
};
