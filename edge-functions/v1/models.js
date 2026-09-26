import { getKV } from '../_shared/kv.js';
import { getSettings, readBearer, matchAPIKey, apiAuthDisabled } from '../_shared/auth.js';
import { listAccounts, isUsable, needsRefresh, refreshAccount } from '../_shared/accounts.js';
import { modelList } from '../_shared/upstream.js';
import { STATIC_MODELS, CONTEXT_LENGTH, MAX_COMPLETION_TOKENS, MODELS_CACHE_MS } from '../_shared/config.js';
import { json, error, preflight } from '../_shared/http.js';

const CREATED = 1700000000;

let cache = { at: 0, models: null };

function toOpenAI(models) {
  return models.map((m) => ({
    id: m.key,
    object: 'model',
    created: CREATED,
    owned_by: 'qwenwork',
    context_length: m.maxInputTokens || CONTEXT_LENGTH,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    display_name: m.name,
    vision: !!m.isVL,
    supports_image_input: !!m.isVL,
    reasoning: !!m.isReasoning,
    supports_reasoning: !!m.isReasoning,
    max_input_tokens: m.maxInputTokens || CONTEXT_LENGTH,
    supported_generation_methods: ['chat'],
  }));
}

function fallbackModels() {
  return toOpenAI(STATIC_MODELS.map((m) => ({ key: m.key, name: m.name, maxInputTokens: CONTEXT_LENGTH })));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();

  const kv = getKV(env);
  if (!kv) return error('KV namespace is not bound to this project', 500, 'kv_unbound');

  const settings = await getSettings(kv);
  if (!settings.allowAnonymous && !apiAuthDisabled(env)) {
    const key = matchAPIKey(settings, readBearer(request));
    if (!key) return error('invalid api key', 401, 'invalid_api_key');
  }

  if (cache.models && Date.now() - cache.at < MODELS_CACHE_MS) {
    return json({ object: 'list', data: cache.models });
  }

  let accounts = await listAccounts(kv);
  for (let i = 0; i < accounts.length; i++) {
    if (needsRefresh(accounts[i])) {
      accounts[i] = await refreshAccount(kv, accounts[i]).catch(() => accounts[i]);
    }
  }

  const candidates = accounts.filter((a) => isUsable(a)).sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));

  for (const account of candidates) {
    try {
      const models = await modelList(account);
      if (models.length > 0) {
        cache = { at: Date.now(), models: toOpenAI(models) };
        return json({ object: 'list', data: cache.models });
      }
    } catch {
      /* try next account */
    }
  }

  return json({ object: 'list', data: fallbackModels() });
}
