import { indexPattern, type IndexOptions, type IndexSolution } from '../core/xrd/indexing/index';

export interface IndexingRequest {
  id: number;
  positions: number[];
  options: IndexOptions;
}

export type IndexingResponse =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'done'; solutions: IndexSolution[] };

/** Indexing tries hundreds of thousands of trial cells, so it runs off the main thread. */
self.onmessage = ({ data }: MessageEvent<IndexingRequest>) => {
  const post = (message: IndexingResponse) => (self as unknown as Worker).postMessage(message);
  let last = 0;
  const solutions = indexPattern(data.positions, data.options, (fraction) => {
    if (fraction - last < 0.02) return;
    last = fraction;
    post({ id: data.id, kind: 'progress', fraction });
  });
  post({ id: data.id, kind: 'done', solutions });
};
