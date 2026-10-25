import {
  refineRietveld,
  type RietveldInput,
  type RietveldOutcome,
} from '../core/xrd/rietveld/refine';

export type RietveldRequest = { id: number; input: RietveldInput };

export type RietveldResponse =
  | { id: number; kind: 'progress'; stage: string }
  | { id: number; kind: 'done'; outcome: RietveldOutcome };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<RietveldRequest>) => void) | null;
  postMessage(message: RietveldResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  let outcome: RietveldOutcome;
  try {
    outcome = refineRietveld(request.input, (stage) =>
      scope.postMessage({ id: request.id, kind: 'progress', stage }),
    );
  } catch (e) {
    outcome = {
      ok: false,
      error: `The refinement failed: ${e instanceof Error ? e.message : 'unknown problem'}.`,
    };
  }
  scope.postMessage({ id: request.id, kind: 'done', outcome });
};
