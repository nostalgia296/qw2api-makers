import { guard } from '../../_shared/admin.js';
import { getJSON } from '../../_shared/kv.js';
import { pollGrant } from '../../_shared/upstream.js';
import { LOGIN_PREFIX } from '../../_shared/config.js';
import { listAccounts, newAccount, saveAccount, publicView, enrichAccount } from '../../_shared/accounts.js';
import { json, error } from '../../_shared/http.js';

export async function onRequest(context) {
  const g = await guard(context);
  if (g.response) return g.response;
  if (g.method !== 'POST') return error('method not allowed', 405, 'invalid_request_error');

  const state = String(g.body.state || '').trim();
  if (!state) return error('state is required', 400, 'invalid_request_error');

  const key = `${LOGIN_PREFIX}${state}`;
  const record = await getJSON(g.kv, key);
  if (!record) return error('login session not found, please start again', 404, 'not_found');
  if (record.expiresAt && record.expiresAt < Date.now()) {
    await g.kv.delete(key);
    return error('login expired, please start again', 410, 'expired');
  }

  let outcome;
  try {
    outcome = await pollGrant(record.nonce, record.verifier);
  } catch (err) {
    return error(`poll failed: ${err && err.message ? err.message : err}`, 502, 'upstream_error');
  }

  if (outcome.pending) return json({ status: 'pending' });

  const fresh = newAccount(outcome.grant);
  const existing = await listAccounts(g.kv);
  const same =
    existing.find((a) => a.uid && a.uid === fresh.uid) ||
    existing.find((a) => !fresh.uid && fresh.nickname && a.nickname === fresh.nickname);

  let account = fresh;
  if (same) {
    account = same;
    for (const field of ['accessToken', 'refreshToken', 'expiresAt', 'nickname', 'enterpriseId']) {
      if (fresh[field] !== undefined && fresh[field] !== '' && fresh[field] !== 0) account[field] = fresh[field];
    }
    account.disabled = false;
    account.cooldownUntil = 0;
    account.lastError = '';
  }
  await enrichAccount(g.kv, account);
  await saveAccount(g.kv, account);
  await g.kv.delete(key);
  return json({ status: 'success', account: publicView(account) });
}
