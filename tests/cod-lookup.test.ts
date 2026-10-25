// @vitest-environment node
/*
 * The COD lookup worker (worker/lookup.js) with COD replaced by a stub: only the two allowed
 * request kinds are answered, inputs are checked before anything is sent to COD, large result
 * sets are refused, rows are trimmed, and only the site's own origins get the CORS header.
 */
import { describe, expect, it } from 'vitest';
import { codQuery, handle, MAX_RESULTS } from '../worker/lookup.js';

const SITE = 'https://plot-bhai.web.app';
const row = {
  file: '9013437',
  formula: '- Bi O4 V -',
  chemname: 'Bismuth vanadate',
  mineral: 'Clinobisvanite',
  sg: 'I 1 1 2/b',
  sgNumber: '15',
  a: '5.1935',
  b: '5.0898',
  c: '11.6972',
  alpha: '90',
  beta: '90',
  gamma: '90.387',
  year: '1979',
  journal: 'Materials Research Bulletin',
  doi: null,
  authors: 'long text that is dropped',
};

/** A stub COD that records the URLs asked for. */
function stub(count: number, rows: unknown[] = [row], status = 200) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    if (url.includes('format=count')) return new Response(`${count}\n`);
    if (url.includes('format=json')) return new Response(JSON.stringify(rows));
    return new Response(status === 200 ? 'data_9013437\n_cell_length_a 5.1935\n' : 'no', {
      status,
    });
  };
  return { asked, fetcher };
}
const get = (path: string, origin: string | null = SITE) =>
  new Request(`https://lookup.example${path}`, origin ? { headers: { Origin: origin } } : {});

describe('COD lookup worker', () => {
  it('builds COD queries for elements (optionally only those) and for a formula', () => {
    const q = (s: string) => {
      const r = codQuery(new URLSearchParams(s));
      return 'query' in r ? r.query.toString() : r.error;
    };
    expect(q('elements=Bi,V,O&only=1')).toBe('el1=Bi&el2=V&el3=O&strictmin=3&strictmax=3');
    expect(q('elements=Fe,O')).toBe('el1=Fe&el2=O');
    expect(q('formula=Bi O4 V')).toBe('formula=Bi+O4+V');
    expect(q('elements=Bi,Xx')).toMatch(/element symbols/);
    expect(q('elements=H,He,Li,Be,B,C,N,O,F')).toMatch(/element symbols/);
    expect(q('formula=Bi O4 V; drop')).toMatch(/expected form/);
    expect(q('formula=Qq2 O')).toMatch(/expected form/);
    expect(q('')).toMatch(/elements or a formula/);
  });

  it('returns trimmed results with the CORS header for the site', async () => {
    const cod = stub(1);
    const response = await handle(get('/search?elements=Bi,V,O&only=1'), cod.fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const body = (await response.json()) as { count: number; results: Record<string, unknown>[] };
    expect(body.count).toBe(1);
    expect(body.results[0]).toEqual({
      id: 9013437,
      formula: 'Bi O4 V',
      name: 'Bismuth vanadate',
      mineral: 'Clinobisvanite',
      spaceGroup: 'I 1 1 2/b',
      spaceGroupNumber: 15,
      cell: { a: 5.1935, b: 5.0898, c: 11.6972, alpha: 90, beta: 90, gamma: 90.387 },
      year: 1979,
      journal: 'Materials Research Bulletin',
      doi: null,
    });
    expect(cod.asked).toEqual([
      'https://www.crystallography.net/cod/result?el1=Bi&el2=V&el3=O&strictmin=3&strictmax=3&format=count',
      'https://www.crystallography.net/cod/result?el1=Bi&el2=V&el3=O&strictmin=3&strictmax=3&format=json',
    ]);
  });

  it('refuses result sets too large to list without downloading them', async () => {
    const cod = stub(MAX_RESULTS + 1);
    const body = await (await handle(get('/search?elements=Fe,O'), cod.fetcher)).json();
    expect(body).toEqual({ count: MAX_RESULTS + 1, tooMany: true, max: MAX_RESULTS });
    expect(cod.asked).toHaveLength(1);
  });

  it('checks input before contacting COD', async () => {
    const cod = stub(1);
    const response = await handle(get('/search?elements=Bi,Xx'), cod.fetcher);
    expect(response.status).toBe(400);
    expect(cod.asked).toHaveLength(0);
  });

  it('returns a CIF by its 7-digit COD number and nothing else', async () => {
    const ok = await handle(get('/cif/9013437'), stub(0).fetcher);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('data_9013437');
    const missing = await handle(get('/cif/0000001'), stub(0, [], 404).fetcher);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toMatch(/no entry/);
    for (const path of ['/cif/123', '/cif/../../etc', '/http://example.com', '/']) {
      const cod = stub(0);
      expect((await handle(get(path), cod.fetcher)).status, path).toBe(404);
      expect(cod.asked, path).toHaveLength(0);
    }
  });

  it('gives the CORS header only to the site, its previews and local development', async () => {
    const origin = async (o: string | null) =>
      (await handle(get('/cif/9013437', o), stub(0).fetcher)).headers.get(
        'Access-Control-Allow-Origin',
      );
    expect(await origin('https://plot-bhai--pr26-abc.web.app')).toBe(
      'https://plot-bhai--pr26-abc.web.app',
    );
    expect(await origin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(await origin('https://evil.example')).toBeNull();
    expect(await origin('https://plot-bhai.web.app.evil.example')).toBeNull();
    expect(await origin(null)).toBeNull();
  });

  it('answers preflight requests and refuses other methods', async () => {
    const preflight = await handle(
      new Request('https://lookup.example/search', {
        method: 'OPTIONS',
        headers: { Origin: SITE },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    const post = await handle(new Request('https://lookup.example/search', { method: 'POST' }));
    expect(post.status).toBe(405);
  });

  it('reports COD being unreachable plainly', async () => {
    const response = await handle(get('/search?formula=Bi O4 V'), async () => {
      throw new Error('network');
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toMatch(/could not be reached/);
  });
});
