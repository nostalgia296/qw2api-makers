import { guard } from '../_shared/admin.js';
import { listAccounts, getAccount, deleteAccount, publicView, refreshAccount, saveAccount, enrichAccount } from '../_shared/accounts.js';
import { json, error } from '../_shared/http.js';

export async function onRequest(context) {
  const g = await guard(context);
  if (g.response) return g.response;

  if (g.method === 'GET') {
    const accounts = await listAccounts(g.kv);
    return json({ accounts: accounts.map(publicView) });
  }

  if (g.method === 'DELETE') {
    const id = new URL(context.request.url).searchParams.get('id');
    if (!id) return error('id is required', 400, 'invalid_request_error');
    await deleteAccount(g.kv, id);
    return json({ ok: true });
  }

  if (g.method === 'POST') {
    const id = String(g.body.id || '');
    if (!id) return error('id is required', 400, 'invalid_request_error');
    const account = await getAccount(g.kv, id);
    if (!account) return error('account not found', 404, 'not_found');

    if (g.body.action === 'refresh') {
      try {
        const updated = await refreshAccount(g.kv, account);
        return json({ account: publicView(updated) });
      } catch (err) {
        return error(`refresh failed: ${err && err.message ? err.message : err}`, 502, 'upstream_error');
      }
    }

    if (g.body.action === 'toggle') {
      account.disabled = !account.disabled;
      await saveAccount(g.kv, account);
      return json({ account: publicView(account) });
    }

    if (g.body.action === 'sync') {
      await enrichAccount(g.kv, account);
      return json({ account: publicView(account) });
    }

    if (g.body.action === 'thaw') {
      account.cooldownUntil = 0;
      account.lastError = '';
      await saveAccount(g.kv, account);
      return json({ account: publicView(account) });
    }

    return error('unknown action', 400, 'invalid_request_error');
  }

  return error('method not allowed', 405, 'invalid_request_error');
}
