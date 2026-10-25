/*
 * Entry point of the COD lookup Worker: Cloudflare's cache in front of the request handler in
 * lookup.js. Only the default export is allowed here (Workers treat named exports as entry points).
 */
import { corsHeaders, handle } from './lookup.js';

export default {
  async fetch(request, env, context) {
    // Cloudflare's cache, keyed by the URL alone (the CORS header is added per request).
    const cache = globalThis.caches?.default;
    const key = new Request(new URL(request.url).toString());
    if (request.method === 'GET' && cache) {
      const hit = await cache.match(key);
      if (hit) {
        const response = new Response(hit.body, hit);
        const cors = corsHeaders(request.headers.get('Origin'));
        response.headers.delete('Access-Control-Allow-Origin');
        for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
        return response;
      }
    }
    const response = await handle(request);
    if (request.method === 'GET' && cache && response.status === 200)
      context.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};
