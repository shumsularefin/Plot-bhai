/*
 * Client for the COD lookup service (worker/, run on Cloudflare): searches the
 * Crystallography Open Database by elements or formula and downloads single CIF files. Only element
 * symbols, formulas and COD numbers are sent; the user's data never leave the browser. When the
 * service is not configured or cannot be reached, the step falls back to loading CIF files by hand.
 */

/**
 * Address of the deployed lookup service, without a trailing slash; empty until it is deployed.
 * VITE_COD_API overrides it at build time (used to test against a local copy).
 */
export const COD_API: string = (import.meta.env['VITE_COD_API'] as string | undefined) ?? '';

export interface CodEntry {
  id: number;
  formula: string;
  name: string | null;
  mineral: string | null;
  spaceGroup: string | null;
  spaceGroupNumber: number | null;
  cell: Record<'a' | 'b' | 'c' | 'alpha' | 'beta' | 'gamma', number | null>;
  year: number | null;
  journal: string | null;
  doi: string | null;
}

export type CodSearch =
  | { kind: 'elements'; elements: readonly string[]; only: boolean }
  | { kind: 'formula'; hill: string };

export type CodSearchResult =
  | { ok: true; count: number; results: CodEntry[] }
  | { ok: true; count: number; tooMany: true; max: number }
  | { ok: false; error: string };

const UNREACHABLE =
  'The COD lookup could not be reached. Check your connection, or load a CIF file below.';

async function call(path: string, base: string): Promise<Response | null> {
  try {
    return await fetch(`${base}${path}`, { headers: { Accept: '*/*' } });
  } catch {
    return null;
  }
}

/** Searches COD through the lookup service. */
export async function searchCod(search: CodSearch, base = COD_API): Promise<CodSearchResult> {
  const params = new URLSearchParams(
    search.kind === 'formula'
      ? { formula: search.hill }
      : { elements: search.elements.join(','), ...(search.only && { only: '1' }) },
  );
  const response = await call(`/search?${params}`, base);
  if (!response) return { ok: false, error: UNREACHABLE };
  try {
    const body = (await response.json()) as
      | { error: string }
      | { count: number; results: CodEntry[] }
      | { count: number; tooMany: true; max: number };
    if ('error' in body) return { ok: false, error: body.error };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Downloads the CIF of one COD entry as text, or a plain reason it could not. */
export async function fetchCodCif(
  id: number,
  base = COD_API,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const response = await call(`/cif/${String(id).padStart(7, '0')}`, base);
  if (!response) return { ok: false, error: UNREACHABLE };
  if (!response.ok) {
    try {
      return { ok: false, error: ((await response.json()) as { error: string }).error };
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
  }
  return { ok: true, text: await response.text() };
}
