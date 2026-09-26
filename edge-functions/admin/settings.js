import { guard } from '../_shared/admin.js';
import { saveSettings, hashPassword, effectiveTerms, randomToken, adminAuthDisabled } from '../_shared/auth.js';
import { DEFAULT_TERMS } from '../_shared/desensitize.js';
import { json, error } from '../_shared/http.js';

function view(settings) {
  const custom = Array.isArray(settings.desensitizeTerms) ? settings.desensitizeTerms : [];
  return {
    allowAnonymous: !!settings.allowAnonymous,
    desensitize: !!settings.desensitize,
    desensitizeTerms: custom,
    useDefaultTerms: custom.length === 0,
    defaultTermsCount: DEFAULT_TERMS.length,
    activeTermsCount: effectiveTerms(settings).length,
    defaultModel: settings.defaultModel || 'pro',
    requestTimeoutMs: settings.requestTimeoutMs || 120000,
    streamMode: settings.streamMode === 'buffered' ? 'buffered' : 'realtime',
    cronToken: settings.cronToken || '',
  };
}

export async function onRequest(context) {
  const g = await guard(context);
  if (g.response) return g.response;

  if (g.method === 'GET') {
    if (!g.settings.cronToken) {
      g.settings.cronToken = `cron_${randomToken(16)}`;
      await saveSettings(g.kv, g.settings);
    }
    return json(view(g.settings));
  }

  if (g.method === 'PUT' || g.method === 'POST') {
    const body = g.body || {};
    if (body.allowAnonymous !== undefined) g.settings.allowAnonymous = !!body.allowAnonymous;
    if (body.desensitize !== undefined) g.settings.desensitize = !!body.desensitize;
    if (body.defaultModel !== undefined) g.settings.defaultModel = String(body.defaultModel || 'pro');
    if (body.streamMode !== undefined) {
      const m = String(body.streamMode);
      if (m === 'realtime' || m === 'buffered') g.settings.streamMode = m;
    }
    if (body.requestTimeoutMs !== undefined) {
      const ms = Number(body.requestTimeoutMs);
      if (Number.isFinite(ms) && ms >= 10000 && ms <= 600000) g.settings.requestTimeoutMs = ms;
    }
    if (body.desensitizeTerms !== undefined) {
      const list = Array.isArray(body.desensitizeTerms) ? body.desensitizeTerms : [];
      g.settings.desensitizeTerms = list.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 500);
    }
    if (body.password !== undefined && String(body.password) !== '') {
      const password = String(body.password);
      if (password.length < 6) return error('password must be at least 6 characters', 400, 'invalid_request_error');
      if (!adminAuthDisabled(g.env)) {
        const oldPassword = String(body.oldPassword || '');
        if (!g.settings.adminHash || (await hashPassword(oldPassword, g.settings.adminSalt)) !== g.settings.adminHash) {
          return error('password verification failed', 401, 'invalid_password');
        }
      }
      const salt = crypto.getRandomValues(new Uint8Array(8)).join('');
      g.settings.adminSalt = salt;
      g.settings.adminHash = await hashPassword(password, salt);
    }
    await saveSettings(g.kv, g.settings);
    return json(view(g.settings));
  }

  return error('method not allowed', 405, 'invalid_request_error');
}
