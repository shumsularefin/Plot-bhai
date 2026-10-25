/*
 * COD lookup for Plot Bhai: a Cloudflare Worker (free plan) that searches the Crystallography Open
 * Database and returns single CIF files, adding the CORS header browsers need. It answers only two
 * kinds of request and nothing else, so it cannot be used as a general proxy:
 *
 *   GET /search?elements=Bi,V,O[&only=1]   structures containing these elements (only=1: no others)
 *   GET /search?formula=Bi O4 V             structures with exactly this formula (Hill order, spaces)
 *     → { count, results: [{ id, formula, name, mineral, spaceGroup, spaceGroupNumber, cell,
 *         year, journal, doi }] }, or { count, tooMany: true } when count > MAX_RESULTS
 *   GET /cif/1234567                        the CIF of COD entry 1234567, as text
 *
 * No user data passes through it: only element symbols, formulas and COD numbers. Responses are
 * cached for a day at Cloudflare to spare COD (index.js). Deployed by .github/workflows/worker.yml;
 * docs/cod-lookup.md has the one-time setup.
 */

const COD = 'https://www.crystallography.net/cod';
/** Larger result sets are refused: parsing them would exceed the free plan's CPU time per request. */
export const MAX_RESULTS = 300;
const MAX_CIF_BYTES = 5 * 1024 * 1024;
const CACHE_SECONDS = 86400;

/** Sites allowed to call the lookup: the live site, its Firebase preview channels and local development. */
const ALLOWED_ORIGINS = [
  /^https:\/\/plot-bhai\.web\.app$/,
  /^https:\/\/plot-bhai\.firebaseapp\.com$/,
  /^https:\/\/plot-bhai--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
];

const ELEMENTS = new Set(
  (
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
    'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm ' +
    'Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No ' +
    'Lr D'
  ).split(' '),
);
/** A formula in COD's form: element symbols with optional amounts, separated by single spaces. */
const FORMULA = /^[A-Z][a-z]?(\d+(\.\d+)?)?( [A-Z][a-z]?(\d+(\.\d+)?)?){0,11}$/;

export function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
  return {
    ...(allowed && { 'Access-Control-Allow-Origin': origin }),
    Vary: 'Origin',
  };
}

function reply(body, status, origin, type = 'application/json; charset=utf-8') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': type,
      'Cache-Control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
    },
  });
}

/** COD query parameters for a search request, or an error message. */
export function codQuery(params) {
  const formula = params.get('formula');
  const elements = params.get('elements');
  if (formula !== null) {
    const f = formula.trim();
    if (
      !FORMULA.test(f) ||
      !f.split(' ').every((part) => ELEMENTS.has(part.replace(/[\d.]+$/, '')))
    )
      return { error: 'The formula is not in the expected form, for example "Bi O4 V".' };
    return { query: new URLSearchParams({ formula: f }) };
  }
  if (elements !== null) {
    const list = [...new Set(elements.split(',').map((e) => e.trim()))].filter(Boolean);
    if (list.length === 0 || list.length > 8 || !list.every((e) => ELEMENTS.has(e)))
      return { error: 'Choose between one and eight element symbols.' };
    const query = new URLSearchParams();
    list.forEach((e, i) => query.set(`el${i + 1}`, e));
    if (params.get('only') === '1') {
      query.set('strictmin', String(list.length));
      query.set('strictmax', String(list.length));
    }
    return { query };
  }
  return { error: 'Give elements or a formula.' };
}

/** The fields the site shows, from one COD result row. */
export function trimEntry(row) {
  const number = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    id: Number(row.file),
    formula: String(row.formula ?? '')
      .replace(/^-\s*|\s*-$/g, '')
      .trim(),
    name: row.chemname ?? row.commonname ?? null,
    mineral: row.mineral ?? null,
    spaceGroup: row.sg ?? null,
    spaceGroupNumber: number(row.sgNumber),
    cell: {
      a: number(row.a),
      b: number(row.b),
      c: number(row.c),
      alpha: number(row.alpha),
      beta: number(row.beta),
      gamma: number(row.gamma),
    },
    year: number(row.year),
    journal: row.journal ?? null,
    doi: row.doi ?? null,
  };
}

async function search(url, origin, fetcher) {
  const built = codQuery(url.searchParams);
  if (built.error) return reply({ error: built.error }, 400, origin);
  const count = Number(
    (await (await fetcher(`${COD}/result?${built.query}&format=count`)).text()).trim(),
  );
  if (!Number.isFinite(count))
    return reply({ error: 'COD did not answer as expected.' }, 502, origin);
  if (count > MAX_RESULTS) return reply({ count, tooMany: true, max: MAX_RESULTS }, 200, origin);
  if (count === 0) return reply({ count: 0, results: [] }, 200, origin);
  const rows = await (await fetcher(`${COD}/result?${built.query}&format=json`)).json();
  return reply({ count: rows.length, results: rows.map(trimEntry) }, 200, origin);
}

async function cif(id, origin, fetcher) {
  const response = await fetcher(`${COD}/${id}.cif`);
  if (response.status === 404) return reply({ error: `COD has no entry ${id}.` }, 404, origin);
  if (!response.ok) return reply({ error: 'COD did not answer as expected.' }, 502, origin);
  const text = await response.text();
  if (text.length > MAX_CIF_BYTES) return reply({ error: 'The file is too large.' }, 502, origin);
  return reply(text, 200, origin, 'chemical/x-cif; charset=utf-8');
}

/** Answers one request; `fetcher` is fetch, replaced in tests. */
export async function handle(request, fetcher = fetch) {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Max-Age': '86400',
      },
    });
  if (request.method !== 'GET') return reply({ error: 'Only GET is supported.' }, 405, origin);
  const url = new URL(request.url);
  try {
    if (url.pathname === '/search') return await search(url, origin, fetcher);
    const match = /^\/cif\/(\d{7})$/.exec(url.pathname);
    if (match) return await cif(match[1], origin, fetcher);
  } catch {
    return reply({ error: 'COD could not be reached. Try again later.' }, 502, origin);
  }
  return reply({ error: 'Not found.' }, 404, origin);
}
