// Entry point para deploy como Worker (workers.dev).
// Reaproveita a mesma lógica da Pages Function em functions/api/liturgia.js.
import { handleRequest } from '../functions/api/liturgia.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest({
      request,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
};
