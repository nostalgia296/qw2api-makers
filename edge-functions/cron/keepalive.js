import { getKV } from '../_shared/kv.js';
import { getSettings, checkSession, readAdminToken, readBearer, matchAPIKey, adminAuthDisabled } from '../_shared/auth.js';
import { listAccounts, refreshAccount, needsRefresh, saveAccount } from '../_shared/accounts.js';
import { json, error, preflight, readJSON, cleanErrorText } from '../_shared/http.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();

  const kv = getKV(env);
  if (!kv) return error('KV namespace is not bound to this project', 500, 'kv_unbound');

  const settings = await getSettings(kv);
  const url = new URL(request.url);
  const body = (await readJSON(request)) || {};
  const provided = String(body.token || url.searchParams.get('token') || request.headers.get('x-cron-token') || '');
  const authorized =
    adminAuthDisabled(env) ||
    (settings.cronToken && provided === settings.cronToken) ||
    (env && env.CRON_TOKEN && provided === env.CRON_TOKEN) ||
    (await checkSession(kv, readAdminToken(request))) ||
    !!matchAPIKey(settings, readBearer(request));

  const force = authorized && (body.force === true || url.searchParams.get('force') === '1');
  const accounts = await listAccounts(kv);
  const results = [];
  let refreshedCount = 0;

  for (const account of accounts) {
    if (account.disabled) {
      results.push({ id: account.id, nickname: account.nickname, status: 'skipped-disabled' });
      continue;
    }
    if (!force && !needsRefresh(account)) {
      results.push({ id: account.id, nickname: account.nickname, status: 'fresh' });
      continue;
    }
    if (!account.refreshToken) {
      results.push({ id: account.id, nickname: account.nickname, status: 'no-refresh-token' });
      continue;
    }
    try {
      const updated = await refreshAccount(kv, account);
      refreshedCount++;
      if (updated.lastError) updated.lastError = '';
      await saveAccount(kv, updated);
      results.push({ id: updated.id, nickname: updated.nickname, status: 'refreshed', expiresAt: updated.expiresAt });
    } catch (err) {
      account.lastError = cleanErrorText(err && err.message ? err.message : err);
      if (/401|403|session/i.test(account.lastError)) account.disabled = true;
      await saveAccount(kv, account);
      results.push({ id: account.id, nickname: account.nickname, status: 'failed', error: account.lastError });
    }
  }

  return json({
    ok: true,
    force,
    authorized,
    refreshed: refreshedCount,
    accounts: results,
  });
}
