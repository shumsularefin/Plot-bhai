/** Types of the COD lookup handler (lookup.js), for the tests. */
export const MAX_RESULTS: number;
export function codQuery(params: URLSearchParams): { query: URLSearchParams } | { error: string };
export function trimEntry(row: Record<string, unknown>): Record<string, unknown>;
export function corsHeaders(origin: string | null): Record<string, string>;
export function handle(
  request: Request,
  fetcher?: (url: string) => Promise<Response>,
): Promise<Response>;
