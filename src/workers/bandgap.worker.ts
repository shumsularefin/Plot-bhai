import { runBandGapJob, type BandGapAnalysis, type BandGapJob } from '../modules/uvvis/bandGap';

export interface BandGapRequest {
  id: number;
  job: BandGapJob;
}

export type BandGapResponse =
  { id: number; analysis: BandGapAnalysis } | { id: number; analysis: null; error: string };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<BandGapRequest>) => void) | null;
  postMessage(message: BandGapResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

/** The buffers of every typed array in a result, each once (arrays may share one). */
function buffers(value: unknown, found = new Set<ArrayBuffer>()): Set<ArrayBuffer> {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) buffers(v, found);
  }
  return found;
}

scope.onmessage = ({ data: { id, job } }) => {
  let analysis: BandGapAnalysis;
  try {
    analysis = runBandGapJob(job);
  } catch (e) {
    scope.postMessage(
      { id, analysis: null, error: e instanceof Error ? e.message : String(e) },
      [],
    );
    return;
  }
  scope.postMessage({ id, analysis }, [...buffers(analysis)]);
};
