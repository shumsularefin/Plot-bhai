/** Types for tests of the JavaScript Worker (feedback.js). */
export interface Store {
  counters(): Promise<{ visits: number; analyses: number; validations: number }>;
  bump(name: string): Promise<unknown>;
  daily(day: string, kind: string, who: string): Promise<number>;
  incrementDaily(day: string, kind: string, who: string): Promise<unknown>;
  prune(before: string): Promise<unknown>;
  addAnalysis(a: { id: string; day: string; tool: string; browser: string }): Promise<unknown>;
  analysis(
    id: string,
  ): Promise<{ id: string; day: string; tool: string; browser: string; validated: boolean } | null>;
  markValidated(id: string): Promise<unknown>;
  addValidation(v: {
    created: string;
    tool: string;
    verdict: string;
    comment: string;
    status: string;
  }): Promise<unknown>;
  approved(limit: number): Promise<unknown[]>;
  pending(limit: number): Promise<unknown[]>;
  setStatus(id: number, status: string): Promise<boolean>;
}
export const LIMITS: {
  visitsPerIp: number;
  analysesPerBrowser: number;
  analysesPerIp: number;
  validationsPerBrowser: number;
  validationsPerIp: number;
};
export const MAX_COMMENT: number;
export function dayOf(now: number): string;
export function corsHeaders(origin: string | null): Record<string, string>;
export function handle(
  request: Request,
  store: Store,
  env: { PROOF_SECRET?: string; ADMIN_TOKEN?: string },
  now?: number,
): Promise<Response>;
