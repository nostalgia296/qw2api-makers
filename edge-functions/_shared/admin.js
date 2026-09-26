import { getKV } from './kv.js';
import { getSettings, readAdminToken, checkSession, adminAuthDisabled, adminTokenAuthorized } from './auth.js';
import { error, preflight, readJSON } from './http.js';

export async function guard(context, options) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return { response: preflight() };

  const kv = getKV(env);
  if (!kv) return { response: error('KV namespace is not bound to this project', 500, 'kv_unbound') };

  const settings = await getSettings(kv);
  const method = (request.method || 'GET').toUpperCase();

  if (options && options.allowBootstrap && !settings.initialized) {
    if (method !== 'POST') return { response: error('method not allowed', 405) };
    const body = await readJSON(request);
    return { kv, settings, method, body: body || {}, env };
  }

  const token = readAdminToken(request);
  const ok = (await checkSession(kv, token)) || adminTokenAuthorized(env, token) || adminAuthDisabled(env);
  if (!ok) return { response: error('admin authentication required', 401, 'unauthorized') };

  let body = null;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    body = await readJSON(request);
  }
  return { kv, settings, method, body: body || {}, env };
}
