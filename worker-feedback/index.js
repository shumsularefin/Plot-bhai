/*
 * Entry point of the feedback Worker: the request handler in feedback.js over the D1 database
 * bound as DB (schema.sql). Only the default export is allowed here (Workers treat named exports
 * as entry points).
 */
import { handle } from './feedback.js';
import { d1Store } from './store.js';

export default {
  fetch(request, env) {
    return handle(request, d1Store(env.DB), env);
  },
};
