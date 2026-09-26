import { getKV } from '../../_shared/kv.js';
import { getSettings, readBearer, matchAPIKey, effectiveTerms, apiAuthDisabled } from '../../_shared/auth.js';
import {
  listAccounts,
  pickAccount,
  refreshAccount,
  markCooldown,
  markDead,
  saveAccount,
  needsRefresh,
} from '../../_shared/accounts.js';
import { buildBody, mapModel } from '../../_shared/body.js';
import { makeDesensitizer } from '../../_shared/desensitize.js';
import { chat as callUpstream } from '../../_shared/upstream.js';
import { transform, collectSync } from '../../_shared/sse.js';
import { json, error, sseHeaders, preflight, timeoutSignal, readJSON } from '../../_shared/http.js';
import { bump } from '../../_shared/stats.js';
import { COOLDOWN_SHORT_MS } from '../../_shared/config.js';

function replace(accounts, updated) {
  const idx = accounts.findIndex((a) => a.id === updated.id);
  if (idx >= 0) accounts[idx] = updated;
}

function isTransientStatus(status) {
  return status >= 500 || status === 429;
}

function shortCooldown() {
  return Number(COOLDOWN_SHORT_MS) > 0 ? Number(COOLDOWN_SHORT_MS) : undefined;
}

const CREDIT_EXHAUSTED_MARKERS = [
  'credits exhausted',
  'insufficient credit',
  'no credit',
  'credit exhausted',
  'out of credit',
  'quota exceeded',
  'quota exhaust',
  'credit not enough',
  'not enough credit',
  'payment required',
  '积分不足',
  '额度不足',
  '余额不足',
  '积分用完',
  '额度用尽',
  '没有积分',
];

function creditsExhaustedText(value) {
  const s = String(value === undefined || value === null ? '' : value);
  if (/\bcode["'\s:=]*14018\b/.test(s)) return true;
  const lower = s.toLowerCase();
  return CREDIT_EXHAUSTED_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

function isCreditsExhausted(status, text) {
  if (status !== 429 && status !== 402) return false;
  if (status === 402) return true;
  return creditsExhaustedText(text);
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return error('method not allowed, use POST', 405, 'invalid_request_error');

  const kv = getKV(env);
  if (!kv) return error('KV namespace is not bound to this project', 500, 'kv_unbound');

  const settings = await getSettings(kv);
  if (!settings.allowAnonymous && !apiAuthDisabled(env)) {
    const key = matchAPIKey(settings, readBearer(request));
    if (!key) return error('invalid api key', 401, 'invalid_api_key');
  }

  const payload = await readJSON(request);
  if (!payload || typeof payload !== 'object') return error('invalid json body', 400, 'invalid_request_error');
  if (!Array.isArray(payload.messages)) return error('messages is required', 400, 'invalid_request_error');

  const wantModel = String(payload.model || settings.defaultModel || 'pro').trim();
  const modelKey = mapModel(wantModel);
  const wantStream = payload.stream === true;
  const realtimeRequested =
    settings.streamMode === 'realtime' ||
    (typeof process !== 'undefined' && process.env && process.env.STREAM_REALTIME === '1');
  const useRealtime = wantStream && realtimeRequested;
  const useBuffered = wantStream && !useRealtime;
  const desensitizer = makeDesensitizer(settings.desensitize, effectiveTerms(settings));
  const bodyStr = buildBody(payload, modelKey, desensitizer);

  let accounts = await listAccounts(kv);
  if (accounts.length === 0) return error('no qwenwork account configured', 503, 'no_account');

  for (let i = 0; i < accounts.length; i++) {
    if (needsRefresh(accounts[i])) {
      accounts[i] = await refreshAccount(kv, accounts[i]).catch(() => accounts[i]);
    }
  }

  const attempts = Math.min(accounts.length, 3);
  const refreshed = new Set();
  let lastMessage = 'no available account';
  let lastStatus = 503;

  for (let n = 0; n < attempts; n++) {
    const account = pickAccount(accounts);
    if (!account) break;

    const { signal, done } = timeoutSignal(settings.requestTimeoutMs || 120000);
    let res;
    try {
      res = await callUpstream(account, modelKey, bodyStr, signal);
    } catch (err) {
      done();
      lastMessage = `upstream_error: ${err && err.message ? err.message : err}`;
      lastStatus = 502;
      markCooldown(account, lastMessage, shortCooldown());
      await saveAccount(kv, account);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      done();
      lastMessage = `upstream ${res.status}: ${String(text).slice(0, 200)}`;
      lastStatus = res.status >= 400 && res.status < 500 ? res.status : 502;
      const exhausted = isCreditsExhausted(res.status, text);
      if ((res.status === 401 || res.status === 403) && account.refreshToken && !refreshed.has(account.id)) {
        refreshed.add(account.id);
        try {
          replace(accounts, await refreshAccount(kv, account));
        } catch (err) {
          markDead(account, `refresh failed: ${err && err.message ? err.message : err}`);
          await saveAccount(kv, account);
        }
        continue;
      }
      markCooldown(account, lastMessage, isTransientStatus(res.status) ? shortCooldown() : undefined);
      if (exhausted) account.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
      await saveAccount(kv, account);
      continue;
    }

    account.lastUsed = Date.now();
    if (account.lastError) account.lastError = '';
    const persist = saveAccount(kv, account);

    if (useRealtime) {
      let statsDone;
      const statsPromise = new Promise((resolve) => {
        statsDone = resolve;
      });
      const stream = transform(res.body, wantModel, (usage) => {
        statsDone(usage);
      });
      if (waitUntil) {
        waitUntil(
          (async () => {
            await persist;
            const usage = await statsPromise;
            await bump(kv, true, usage);
          })().catch(() => {})
        );
      } else {
        persist.catch(() => {});
      }
      done();
      return new Response(stream, { headers: sseHeaders() });
    }

    const result = await collectSync(res.body, wantModel);
    done();
    await persist;
    if (result.error) {
      markCooldown(account, result.error);
      if (creditsExhaustedText(result.error)) {
        account.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
      }
      lastMessage = result.error;
      lastStatus = 502;
      continue;
    }
    const usage = result.usage || (result.completion && result.completion.usage) || null;
    if (waitUntil) waitUntil(bump(kv, true, usage).catch(() => {}));
    else bump(kv, true, usage).catch(() => {});
    if (useBuffered) {
      const c = result.completion;
      const choice = c.choices && c.choices[0];
      const msg = (choice && choice.message) || { role: 'assistant', content: '' };
      const delta = { role: msg.role, content: msg.content || '' };
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) delta.tool_calls = msg.tool_calls;
      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content !== '') {
        delta.reasoning_content = msg.reasoning_content;
      }
      const finalReason = choice && choice.finish_reason ? choice.finish_reason : 'stop';
      const first = {
        id: c.id,
        object: 'chat.completion.chunk',
        created: c.created,
        model: wantModel,
        choices: [{ index: 0, delta, finish_reason: finalReason }],
      };
      let out = `data: ${JSON.stringify(first)}\n\n`;
      if (usage) {
        out += `data: ${JSON.stringify({
          id: c.id,
          object: 'chat.completion.chunk',
          created: c.created,
          model: wantModel,
          choices: [{ index: 0, delta: {}, finish_reason: finalReason }],
          usage,
        })}\n\n`;
      }
      out += 'data: [DONE]\n\n';
      return new Response(out, { headers: sseHeaders() });
    }
    const completion = result.completion;
    completion.model = wantModel;
    return json(completion);
  }

  if (waitUntil) waitUntil(bump(kv, false, null).catch(() => {}));
  else bump(kv, false, null).catch(() => {});
  return error(lastMessage, lastStatus, lastStatus === 401 ? 'invalid_api_key' : 'upstream_error');
}
