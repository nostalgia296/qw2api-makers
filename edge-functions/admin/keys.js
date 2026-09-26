import { guard } from '../_shared/admin.js';
import { saveSettings, newAPIKey, hashPassword, adminAuthDisabled } from '../_shared/auth.js';
import { json, error } from '../_shared/http.js';

function mask(key) {
  if (!key) return '';
  if (key.length <= 14) return key;
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

export async function onRequest(context) {
  const g = await guard(context);
  if (g.response) return g.response;

  if (!Array.isArray(g.settings.apiKeys)) g.settings.apiKeys = [];

  if (g.method === 'GET') {
    return json({
      keys: g.settings.apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        masked: mask(k.key),
        createdAt: k.createdAt || 0,
        lastUsed: k.lastUsed || 0,
      })),
    });
  }

  if (g.method === 'POST') {
    if (g.body.action === 'reveal') {
      if (!adminAuthDisabled(g.env)) {
        const password = String(g.body.password || '');
        if (!g.settings.adminHash || (await hashPassword(password, g.settings.adminSalt)) !== g.settings.adminHash) {
          return error('password verification failed', 401, 'invalid_password');
        }
      }
      const found = g.settings.apiKeys.find((k) => k.id === String(g.body.id || ''));
      if (!found) return error('key not found', 404, 'not_found');
      return json({ id: found.id, name: found.name, key: found.key });
    }

    const item = newAPIKey(String(g.body.name || 'key').slice(0, 40));
    g.settings.apiKeys.push(item);
    await saveSettings(g.kv, g.settings);
    return json({ id: item.id, name: item.name, key: item.key });
  }

  if (g.method === 'DELETE') {
    const id = new URL(context.request.url).searchParams.get('id');
    if (!id) return error('id is required', 400, 'invalid_request_error');
    const before = g.settings.apiKeys.length;
    g.settings.apiKeys = g.settings.apiKeys.filter((k) => k.id !== id);
    if (g.settings.apiKeys.length === before) return error('key not found', 404, 'not_found');
    await saveSettings(g.kv, g.settings);
    return json({ ok: true });
  }

  return error('method not allowed', 405, 'invalid_request_error');
}
