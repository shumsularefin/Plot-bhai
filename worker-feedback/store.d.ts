import type { Store } from './feedback.js';

/** Minimal shape of a D1 database, as used by store.js. */
export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first(): Promise<Record<string, unknown> | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
      all(): Promise<{ results: Record<string, unknown>[] }>;
    };
  };
}
export function d1Store(db: D1Like): Store;
