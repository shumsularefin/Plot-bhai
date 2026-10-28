/*
 * Feedback service for Plot Bhai: a Cloudflare Worker (free plan) with a D1 database that counts
 * visits, finished analyses and validations, and keeps validation comments until the owner
 * approves them. It never receives users' data files or results: only a random browser ID, the
 * name of the analysis section, the verdict and the comment typed by the user.
 *
 *   POST /visit      { browser }                          count a visit (once per browser per day)
 *   POST /analysis   { browser, tool }                    record a finished analysis → { id, proof }
 *   POST /validate   { browser, tool, id, proof, verdict, comment }   one validation per analysis
 *   GET  /stats                                           → { visits, analyses, validations }
 *   GET  /comments                                        → approved comments, newest first
 *   GET  /admin/pending, POST /admin/approve, /admin/reject   owner only (Bearer ADMIN_TOKEN)
 *
 * Nobody can validate without an analysis: /analysis returns an HMAC proof bound to the analysis
 * ID, the browser and the tool, and /validate checks it. Daily limits apply per browser and per
 * IP address; the IP is kept only as a salted hash that changes every day. The browser ID is
 * stored hashed as well.
 */

/** Sites allowed to call the service: the live site, its Firebase preview channels and local development. */
const ALLOWED_ORIGINS = [
  /^https:\/\/plot-bhai\.web\.app$/,
  /^https:\/\/plot-bhai\.firebaseapp\.com$/,
  /^https:\/\/plot-bhai--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
];

/** Daily limits (my choice; adjust here). */
export const LIMITS = {
  /** Distinct browsers counted as visits per IP per day. */
  visitsPerIp: 20,
  analysesPerBrowser: 30,
  analysesPerIp: 100,
  validationsPerBrowser: 5,
  validationsPerIp: 20,
};
export const MAX_COMMENT = 1000;
const TOOL = /^[\p{L}\p{N} ,.'’()–-]{1,80}$/u;
const BROWSER = /^[0-9a-f-]{36}$/;
const VERDICTS = new Set(['works', 'problem']);

export function corsHeaders(origin) {
  return origin && ALLOWED_ORIGINS.some((re) => re.test(origin))
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });

/** UTC day as YYYY-MM-DD. */
export const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

const encoder = new TextEncoder();
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings. */
function same(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function body(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Handles one request. `store` is the database (see index.js for D1), `env` holds the secrets
 * PROOF_SECRET and ADMIN_TOKEN, and `now` is the time in milliseconds.
 */
export async function handle(request, store, env, now = Date.now()) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (!env.PROOF_SECRET || !env.ADMIN_TOKEN) {
    return json({ error: 'The service is not set up.' }, 503, origin);
  }
  const day = dayOf(now);

  if (request.method === 'GET' && path === '/stats') {
    return json(await store.counters(), 200, origin);
  }
  if (request.method === 'GET' && path === '/comments') {
    return json({ comments: await store.approved(50) }, 200, origin);
  }
  if (path.startsWith('/admin/')) return admin(request, store, env, origin, path);
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404, origin);

  // Writes come only from the site itself.
  if (!corsHeaders(origin)['Access-Control-Allow-Origin']) {
    return json({ error: 'Not allowed from this site.' }, 403, origin);
  }
  const data = await body(request);
  if (!data || typeof data.browser !== 'string' || !BROWSER.test(data.browser)) {
    return json({ error: 'Bad request.' }, 400, origin);
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hmac(env.PROOF_SECRET, `ip|${day}|${ip}`);
  const browser = await hmac(env.PROOF_SECRET, `browser|${data.browser}`);

  if (path === '/visit') {
    await store.prune(dayOf(now - 2 * 86400000));
    if ((await store.daily(day, 'visit-browser', browser)) > 0) {
      return json({ counted: false }, 200, origin);
    }
    if ((await store.daily(day, 'visit-ip', ipHash)) >= LIMITS.visitsPerIp) {
      return json({ counted: false }, 200, origin);
    }
    await store.incrementDaily(day, 'visit-browser', browser);
    await store.incrementDaily(day, 'visit-ip', ipHash);
    await store.bump('visits');
    return json({ counted: true }, 200, origin);
  }

  if (typeof data.tool !== 'string' || !TOOL.test(data.tool)) {
    return json({ error: 'Bad request.' }, 400, origin);
  }

  if (path === '/analysis') {
    if (
      (await store.daily(day, 'analysis-browser', browser)) >= LIMITS.analysesPerBrowser ||
      (await store.daily(day, 'analysis-ip', ipHash)) >= LIMITS.analysesPerIp
    ) {
      return json({ error: 'Daily limit reached.' }, 429, origin);
    }
    const id = crypto.randomUUID();
    await store.addAnalysis({ id, day, tool: data.tool, browser });
    await store.incrementDaily(day, 'analysis-browser', browser);
    await store.incrementDaily(day, 'analysis-ip', ipHash);
    await store.bump('analyses');
    const proof = await hmac(env.PROOF_SECRET, `analysis|${id}|${data.browser}|${data.tool}`);
    return json({ id, proof }, 200, origin);
  }

  if (path === '/validate') {
    const comment = typeof data.comment === 'string' ? data.comment.trim() : '';
    if (
      !VERDICTS.has(data.verdict) ||
      comment.length > MAX_COMMENT ||
      typeof data.id !== 'string'
    ) {
      return json({ error: 'Bad request.' }, 400, origin);
    }
    const expected = await hmac(
      env.PROOF_SECRET,
      `analysis|${data.id}|${data.browser}|${data.tool}`,
    );
    const analysis = same(data.proof, expected) ? await store.analysis(data.id) : null;
    const yesterday = dayOf(now - 86400000);
    if (
      !analysis ||
      analysis.browser !== browser ||
      analysis.tool !== data.tool ||
      (analysis.day !== day && analysis.day !== yesterday)
    ) {
      return json({ error: 'Finish an analysis in this section first.' }, 403, origin);
    }
    if (analysis.validated) {
      return json({ error: 'This analysis was already validated.' }, 409, origin);
    }
    if (
      (await store.daily(day, 'validation-browser', browser)) >= LIMITS.validationsPerBrowser ||
      (await store.daily(day, 'validation-ip', ipHash)) >= LIMITS.validationsPerIp
    ) {
      return json({ error: 'Daily limit reached.' }, 429, origin);
    }
    await store.markValidated(data.id);
    await store.addValidation({
      created: new Date(now).toISOString(),
      tool: data.tool,
      verdict: data.verdict,
      comment,
      // Validations without a comment have nothing to approve.
      status: comment === '' ? 'approved' : 'pending',
    });
    await store.incrementDaily(day, 'validation-browser', browser);
    await store.incrementDaily(day, 'validation-ip', ipHash);
    await store.bump('validations');
    return json({ ok: true, pending: comment !== '' }, 200, origin);
  }
  return json({ error: 'Not found.' }, 404, origin);
}

async function admin(request, store, env, origin, path) {
  const auth = request.headers.get('Authorization') ?? '';
  if (!same(auth, `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'Not allowed.' }, 401, origin);
  if (request.method === 'GET' && path === '/admin/pending') {
    return json({ comments: await store.pending(100) }, 200, origin);
  }
  if (request.method === 'POST' && (path === '/admin/approve' || path === '/admin/reject')) {
    const data = await body(request);
    if (!data || !Number.isInteger(data.id)) return json({ error: 'Bad request.' }, 400, origin);
    const done = await store.setStatus(
      data.id,
      path === '/admin/approve' ? 'approved' : 'rejected',
    );
    return json({ ok: done }, done ? 200 : 404, origin);
  }
  return json({ error: 'Not found.' }, 404, origin);
}
