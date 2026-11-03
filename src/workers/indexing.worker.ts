import {
  indexPattern,
  type IndexingSolution,
  type IndexSystem,
} from '../core/xrd/reference/indexing';

export interface IndexingRequest {
  id: number;
  positions: number[];
  wavelength: number;
  systems: IndexSystem[];
  tolerance: number;
}

export type IndexingResponse = { id: number; solutions: IndexingSolution[] | null };

/** Tries cells off the main thread: a two-parameter search takes a second or more. */
self.onmessage = ({ data }: MessageEvent<IndexingRequest>) => {
  let solutions: IndexingSolution[] | null;
  try {
    solutions = indexPattern(data.positions, data.wavelength, data.systems, {
      tolerance: data.tolerance,
      minEdge: 2,
      maxEdge: 25,
    });
  } catch {
    solutions = null;
  }
  (self as unknown as Worker).postMessage({ id: data.id, solutions } satisfies IndexingResponse);
};
