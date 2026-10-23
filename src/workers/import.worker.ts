import { importFile, importText } from '../core/xrd/import';
import type { ImportResult } from '../core/xrd/types';

export type ImportRequest =
  | { id: number; kind: 'file'; file: File }
  | { id: number; kind: 'text'; name: string; text: string };

export interface ImportResponse {
  id: number;
  result: ImportResult;
}

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<ImportRequest>) => void) | null;
  postMessage(message: ImportResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async ({ data: request }) => {
  let result: ImportResult;
  try {
    result =
      request.kind === 'file'
        ? importFile(request.file.name, new Uint8Array(await request.file.arrayBuffer()))
        : importText(request.name, request.text);
  } catch {
    result = { ok: false, error: 'Something went wrong while reading this file.' };
  }
  const transfer = result.ok
    ? [
        result.pattern.twoTheta.buffer,
        result.pattern.intensity.buffer,
        result.pattern.sigma?.buffer,
      ].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
    : [];
  scope.postMessage({ id: request.id, result }, transfer);
};
