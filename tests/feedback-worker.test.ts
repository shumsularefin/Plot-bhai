// @vitest-environment node
/*
 * The feedback Worker (worker-feedback/) on a real SQLite database with the D1 schema, through a
 * small D1-style adapter: counters, the proof that ties a validation to a finished analysis,
 * daily limits, owner approval of comments and the CORS rules.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, LIMITS, MAX_COMMENT } from '../worker-feedback/feedback.js';
import { d1Store, type D1Like } from '../worker-feedback/store.js';
import type { Store } from '../worker-feedback/feedback.js';

interface SqliteStatement {
  get(...args: unknown[]): Record<string, unknown> | undefined;
  run(...args: unknown[]): { changes: number | bigint };
  all(...args: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
// node:sqlite is loaded at run time: the bundler of the test runner does not know the module.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

function d1(db: SqliteDatabase): D1Like {
  return {
    prepare: (sql) => ({
      bind: (...args) => {
        const statement = db.prepare(sql);
        return {
          first: async () => statement.get(...args) ?? null,
          run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
          all: async () => ({ results: statement.all(...args) }),
        };
      },
    }),
  };
}

const SITE = 'https://plot-bhai.web.app';
const ENV = { PROOF_SECRET: 'test-secret', ADMIN_TOKEN: 'owner-token' };
const NOW = Date.UTC(2026, 9, 28, 12);
const BROWSER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

let store: Store;
beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker-feedback/schema.sql', import.meta.url), 'utf8'));
  store = d1Store(d1(db));
});

function post(path: string, body: unknown, ip = '203.0.113.5', origin = SITE) {
  return new Request(`https://feedback.example${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}
const call = (request: Request, now = NOW) => handle(request, store, ENV, now);
const get = (path: string, headers: Record<string, string> = {}) =>
  call(new Request(`https://feedback.example${path}`, { headers: { Origin: SITE, ...headers } }));

async function analyse(browser = BROWSER, tool = 'XRD analysis', ip?: string) {
  const response = await call(post('/analysis', { browser, tool }, ip));
  return (await response.json()) as { id: string; proof: string };
}

describe('feedback worker', () => {
  it('counts a visit once per browser per day', async () => {
    expect(await (await call(post('/visit', { browser: BROWSER }))).json()).toEqual({
      counted: true,
    });
    expect(await (await call(post('/visit', { browser: BROWSER }))).json()).toEqual({
      counted: false,
    });
    await call(post('/visit', { browser: BROWSER }), NOW + 86400000);
    expect(await (await get('/stats')).json()).toEqual({ visits: 2, analyses: 0, validations: 0 });
  });

  it('accepts a validation only with the proof of an analysis from the same browser', async () => {
    const { id, proof } = await analyse();
    const base = {
      browser: BROWSER,
      tool: 'XRD analysis',
      id,
      proof,
      verdict: 'works',
      comment: '',
    };
    expect((await call(post('/validate', { ...base, proof: 'f'.repeat(64) }))).status).toBe(403);
    expect((await call(post('/validate', { ...base, browser: OTHER }))).status).toBe(403);
    expect((await call(post('/validate', { ...base, tool: 'FTIR analysis' }))).status).toBe(403);
    // Too old: the proof holds for the day of the analysis and the next.
    expect((await call(post('/validate', base), NOW + 2 * 86400000)).status).toBe(403);
    expect((await call(post('/validate', base))).status).toBe(200);
    expect((await call(post('/validate', base))).status).toBe(409);
    expect(await (await get('/stats')).json()).toEqual({ visits: 0, analyses: 1, validations: 1 });
  });

  it('keeps comments private until the owner approves them', async () => {
    const { id, proof } = await analyse();
    const response = await call(
      post('/validate', {
        browser: BROWSER,
        tool: 'XRD analysis',
        id,
        proof,
        verdict: 'problem',
        comment: '  The size looks too large.  ',
      }),
    );
    expect(await response.json()).toEqual({ ok: true, pending: true });
    expect(await (await get('/comments')).json()).toEqual({ comments: [] });
    expect((await get('/admin/pending')).status).toBe(401);
    expect((await get('/admin/pending', { Authorization: 'Bearer wrong' })).status).toBe(401);
    const auth = { Authorization: 'Bearer owner-token' };
    const pending = (await (await get('/admin/pending', auth)).json()) as {
      comments: { id: number; comment: string }[];
    };
    expect(pending.comments[0]?.comment).toBe('The size looks too large.');
    const approve = new Request('https://feedback.example/admin/approve', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pending.comments[0]?.id }),
    });
    expect((await call(approve)).status).toBe(200);
    const shown = (await (await get('/comments')).json()) as {
      comments: { comment: string; tool: string }[];
    };
    expect(shown.comments.map((c) => [c.tool, c.comment])).toEqual([
      ['XRD analysis', 'The size looks too large.'],
    ]);
  });

  it('applies the daily limits per browser and per IP address', async () => {
    for (let i = 0; i < LIMITS.validationsPerBrowser; i++) {
      const { id, proof } = await analyse();
      const ok = await call(
        post('/validate', {
          browser: BROWSER,
          tool: 'XRD analysis',
          id,
          proof,
          verdict: 'works',
          comment: '',
        }),
      );
      expect(ok.status).toBe(200);
    }
    const { id, proof } = await analyse();
    const over = await call(
      post('/validate', {
        browser: BROWSER,
        tool: 'XRD analysis',
        id,
        proof,
        verdict: 'works',
        comment: '',
      }),
    );
    expect(over.status).toBe(429);
    // The IP limit holds across browsers: fresh browser IDs from one address.
    for (let i = LIMITS.validationsPerBrowser + 1; i < LIMITS.analysesPerIp; i++) {
      await analyse(crypto.randomUUID());
    }
    expect(
      (await call(post('/analysis', { browser: crypto.randomUUID(), tool: 'XRD analysis' })))
        .status,
    ).toBe(429);
    expect(
      (
        await call(
          post('/analysis', { browser: crypto.randomUUID(), tool: 'XRD analysis' }, '198.51.100.7'),
        )
      ).status,
    ).toBe(200);
  });

  it('refuses bad input and writes from other sites', async () => {
    expect((await call(post('/visit', { browser: 'not-a-uuid' }))).status).toBe(400);
    expect((await call(post('/analysis', { browser: BROWSER, tool: '<script>' }))).status).toBe(
      400,
    );
    expect(
      (await call(post('/visit', { browser: BROWSER }, '203.0.113.5', 'https://evil.example')))
        .status,
    ).toBe(403);
    const { id, proof } = await analyse();
    const long = await call(
      post('/validate', {
        browser: BROWSER,
        tool: 'XRD analysis',
        id,
        proof,
        verdict: 'works',
        comment: 'x'.repeat(MAX_COMMENT + 1),
      }),
    );
    expect(long.status).toBe(400);
    const stats = await get('/stats');
    expect(stats.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const foreign = await call(
      new Request('https://feedback.example/stats', {
        headers: { Origin: 'https://evil.example' },
      }),
    );
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('stores neither the IP address nor the browser ID in clear', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../worker-feedback/schema.sql', import.meta.url), 'utf8'));
    store = d1Store(d1(db));
    await call(post('/visit', { browser: BROWSER }));
    await analyse();
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM daily').all(),
      db.prepare('SELECT * FROM analyses').all(),
    ]);
    expect(dump).not.toContain('203.0.113.5');
    expect(dump).not.toContain(BROWSER);
  });

  it('says when the secrets are missing', async () => {
    const response = await handle(post('/visit', { browser: BROWSER }), store, {}, NOW);
    expect(response.status).toBe(503);
  });
});
