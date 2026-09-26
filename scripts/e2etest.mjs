import http from 'node:http';
import { md5 } from '../edge-functions/_shared/crypto.js';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      actual  = ${JSON.stringify(actual)}\n      expected= ${JSON.stringify(expected)}`);
}
function assert(name, condition, detail) {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition && detail !== undefined) console.log(`      ${detail}`);
}

const upstreamCalls = [];

function sseFrame(inner) {
  return `data:${JSON.stringify({ headers: {}, body: typeof inner === 'string' ? inner : JSON.stringify(inner), statusCodeValue: 200 })}\n\n`;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    upstreamCalls.push({ url: req.url, headers: req.headers, body });
    if (req.url.startsWith('/algo/api/v2/service/pro/sse/agent_chat_generation')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sseFrame({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }));
      res.write(sseFrame({ choices: [{ index: 0, delta: { content: '你好' } }] }));
      res.write(sseFrame({ choices: [{ index: 0, delta: { content: '，世界' } }] }));
      res.write(
        sseFrame({
          choices: [{ index: 0, delta: {} }],
          usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
          raw_usage: { internal: true },
        })
      );
      res.write(
        sseFrame({
          choices: [{ index: 0, delta: { content: '', function_call: null, tool_calls: [] }, finish_reason: 'stop' }],
          usage: null,
        })
      );
      res.write('data:{"body":"[DONE]"}\n\n');
      res.write('event:finish\ndata:{"duration":1}\n\n');
      res.end();
      return;
    }
    if (req.url.startsWith('/algo/api/v2/model/list')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          qwork: [
            { key: 'pro', display_name: 'Pro', enable: true, max_input_tokens: 180000 },
            { key: 'flash', display_name: 'Flash', enable: true, max_input_tokens: 180000 },
            { key: 'off', display_name: 'Off', enable: false },
          ],
        })
      );
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const target = typeof url === 'string' ? url : String(url);
  if (target.startsWith('https://gateway.qwenwork.cn')) return realFetch(base + target.slice('https://gateway.qwenwork.cn'.length), opts);
  return realFetch(target, opts);
};

const store = new Map();
globalThis.QWENWORK_KV = {
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async put(key, value) {
    store.set(key, String(value));
  },
  async delete(key) {
    store.delete(key);
  },
  async list({ prefix, cursor } = {}) {
    const all = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
    const start = cursor ? all.findIndex((k) => k > cursor) : 0;
    const keys = all.slice(start, start + 256).map((name) => ({ name }));
    return { keys, complete: start + 256 >= all.length, cursor: keys.length ? keys[keys.length - 1].name : null };
  },
};

store.set(
  'acct_test01',
  JSON.stringify({
    id: 'test01',
    uid: '1234567890',
    nickname: 'tester',
    email: 'tester@example.com',
    enterpriseId: '',
    accessToken: 'header.payload.signature',
    refreshToken: 'ory_rt_test',
    expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
    disabled: false,
    note: '',
    createdAt: Date.now(),
    lastUsed: 0,
    cooldownUntil: 0,
    lastError: '',
  })
);
store.set(
  'settings',
  JSON.stringify({
    initialized: true,
    adminSalt: 'salt',
    adminHash: 'hash',
    apiKeys: [{ id: 'k1', name: 'default', key: 'sk-test-key', createdAt: Date.now(), lastUsed: 0 }],
    allowAnonymous: false,
    desensitize: false,
    desensitizeTerms: [],
    defaultModel: 'pro',
    requestTimeoutMs: 60000,
    cronToken: 'cron_test',
  })
);

const { onRequest: chatCompletions } = await import('../edge-functions/v1/chat/completions.js');
const { onRequest: models } = await import('../edge-functions/v1/models.js');
const { onRequest: login } = await import('../edge-functions/admin/login.js');
const { onRequest: bootstrap } = await import('../edge-functions/admin/bootstrap.js');
const { onRequest: keysAdmin } = await import('../edge-functions/admin/keys.js');
const { onRequest: overviewAdmin } = await import('../edge-functions/admin/overview.js');
const { onRequest: oauthStart } = await import('../edge-functions/admin/oauth/start.js');
const { onRequest: keepalive } = await import('../edge-functions/cron/keepalive.js');

const waitUntilCalls = [];
const ctx = (request) => ({ request, env: {}, waitUntil: (p) => waitUntilCalls.push(p) });
const chatRequest = (payload, key) =>
  new Request('https://example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });

let res = await chatCompletions(ctx(chatRequest({ model: 'pro', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'wrong-key')));
check('chat rejects bad api key', res.status, 401);

res = await chatCompletions(ctx(chatRequest({ model: 'pro', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'sk-test-key')));
check('chat stream status', res.status, 200);
check('chat stream content-type', res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
const streamed = await res.text();
const streamFrames = streamed.split('\n\n').filter(Boolean);
assert('chat stream ends with [DONE]', streamFrames[streamFrames.length - 1].trim() === 'data: [DONE]', streamed);
assert('chat stream carries content delta', streamed.includes('"content":"你好"'), streamed);
assert('chat stream drops raw_usage', !streamed.includes('raw_usage'), streamed);
assert('chat stream keeps usage frame', streamed.includes('"total_tokens":16'), streamed);
assert('chat stream drops empty tool_calls shell', !streamed.includes('"tool_calls":[]'), streamed);
assert('chat stream has no empty-delta frame', !streamFrames.some((f) => f.includes('"delta":{}') && !f.includes('usage')), streamed);

const call = upstreamCalls[upstreamCalls.length - 1];
assert('upstream chat url', call.url.startsWith('/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common'), call.url);
const auth = call.headers.authorization || '';
assert('upstream bearer prefix', auth.startsWith('Bearer COSY.'), auth);
const parts = auth.slice('Bearer COSY.'.length).split('.');
check('upstream bearer parts', parts.length, 2);
const pathSig = new URL(`https://gateway.qwenwork.cn${call.url}`).pathname.replace(/^\/algo/, '');
const expectedSig = md5(`${parts[0]}\n${call.headers['cosy-key']}\n${call.headers['cosy-date']}\n${call.body}\n${pathSig}`);
check('upstream cosy signature', parts[1], expectedSig);
check('upstream cosy-version header', call.headers['cosy-version'], '1.1.18');
check('upstream model header', call.headers['x-model-key'], 'pro');
check('upstream cosy-user header', call.headers['cosy-user'], '1234567890');
assert('upstream cosy-key is 128-byte rsa blob', Buffer.from(call.headers['cosy-key'], 'base64').length === 128, call.headers['cosy-key']);

const sent = JSON.parse(call.body);
check('upstream body stream flag', sent.stream, true);
check('upstream body model key', sent.model_config.key, 'pro');
check('upstream body chat text', sent.chat_context.text, 'hi');
check('upstream body agent id', sent.agent_id, 'agent_common');
check('upstream body session type', sent.session_type, 'qoder_work');
check('upstream body default max_tokens', sent.parameters.max_tokens, 32000);
check('upstream body message count', sent.messages.length, 1);

res = await chatCompletions(ctx(chatRequest({ model: 'pro', messages: [{ role: 'user', content: 'hi' }], stream: false }, 'sk-test-key')));
check('chat sync status', res.status, 200);
const completion = await res.json();
check('chat sync object', completion.object, 'chat.completion');
check('chat sync content', completion.choices[0].message.content, '你好，世界');
check('chat sync finish_reason', completion.choices[0].finish_reason, 'stop');
check('chat sync usage', completion.usage.total_tokens, 16);
check('chat sync model', completion.model, 'pro');

res = await chatCompletions(ctx(chatRequest({ model: 'qwen3.8-max', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] }, 'sk-test-key')));
check('chat sync mapped model status', res.status, 200);
const lastCall = upstreamCalls[upstreamCalls.length - 1];
check('chat sync mapped model key', JSON.parse(lastCall.body).model_config.key, 'qwen3.8-max-preview');
check('chat sync system extracted', JSON.parse(lastCall.body).system, 'be brief');

// ---- 图片（多模态）上行 ----
const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
res = await chatCompletions(
  ctx(
    chatRequest(
      {
        model: 'pro',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '这张图里是什么？' },
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'input_image', image_url: { url: 'https://x/a.jpg' } },
            ],
          },
        ],
      },
      'sk-test-key'
    )
  )
);
check('chat image status', res.status, 200);
const imgBody = JSON.parse(upstreamCalls[upstreamCalls.length - 1].body);
check('chat image message count', imgBody.messages.length, 1);
check('chat image content passthrough', imgBody.messages[0].content.map((p) => p.type), ['text', 'image_url', 'input_image']);
check('chat image data url kept', imgBody.messages[0].content[1].image_url.url, dataUrl);
check('chat image http url kept', imgBody.messages[0].content[2].image_url.url, 'https://x/a.jpg');
check('chat image text kept', imgBody.messages[0].content[0].text, '这张图里是什么？');
check('chat image model_config is_vl', imgBody.model_config.is_vl, true);
check('chat image prompt text', imgBody.chat_context.text, '这张图里是什么？');

res = await chatCompletions(
  ctx(
    chatRequest(
      { model: 'pro', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] }] },
      'sk-test-key'
    )
  )
);
check('chat image-only status', res.status, 200);
const onlyBody = JSON.parse(upstreamCalls[upstreamCalls.length - 1].body);
check('chat image-only content passthrough', onlyBody.messages[0].content.map((p) => p.type), ['image_url']);
check('chat image-only url', onlyBody.messages[0].content[0].image_url.url, dataUrl);

res = await chatCompletions(ctx(chatRequest({ model: 'pro', messages: [{ role: 'user', content: 'hi' }] }, 'sk-test-key')));
const plainBody = JSON.parse(upstreamCalls[upstreamCalls.length - 1].body);
check('chat plain role untouched', plainBody.messages[0].role, 'user');
check('chat plain content untouched', plainBody.messages[0].content, 'hi');
assert('chat plain has no contents', plainBody.messages[0].contents === undefined, JSON.stringify(plainBody.messages[0]));

const { buildBody } = await import('../edge-functions/_shared/body.js');
const desensitized = JSON.parse(
  buildBody(
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>secret-token</system-reminder>' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    },
    'pro',
    (s) => String(s).replaceAll('secret-token', '[REDACTED]')
  )
);
check('desensitize flattens marked user content', typeof desensitized.messages[0].content, 'string');
assert(
  'desensitize redacts text',
  desensitized.messages[0].content.includes('[REDACTED]'),
  desensitized.messages[0].content
);

const capped = JSON.parse(
  buildBody(
    {
      model: 'pro',
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 1234.7,
      tool_choice: 'none',
      tools: [{ type: 'function', function: { name: 'f' } }],
    },
    'pro'
  )
);
check('body max_completion_tokens mapped', capped.parameters.max_tokens, 1234);
check('body business block', capped.business, { product: 'qoder_work', type: 'agent', version: '1', feature_switches: {} });
check('body tool_choice none drops tools', capped.tools, []);

const { cleanChunk, unwrapFrame } = await import('../edge-functions/_shared/sse.js');
const usageNoise = JSON.stringify({ id: 'x', choices: [], usage: { total_tokens: 5, raw_usage: { internal: 1 } } });
assert('cleanChunk strips usage-internal noise', !cleanChunk(usageNoise).includes('raw_usage'), cleanChunk(usageNoise));
assert('unwrapFrame rejects non-string payload', JSON.stringify(unwrapFrame(undefined)), JSON.stringify({ ok: false }));

res = await models(ctx(new Request('https://example.com/v1/models', { headers: { authorization: 'Bearer sk-test-key' } })));
const modelList = await res.json();
check('models object', modelList.object, 'list');
check('models ids', modelList.data.map((m) => m.id), ['pro', 'flash']);
check('models owned_by', modelList.data[0].owned_by, 'qwenwork');

res = await models(ctx(new Request('https://example.com/v1/models')));
check('models rejects anonymous', res.status, 401);

res = await login(
  ctx(
    new Request('https://example.com/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'whatever' }),
    })
  )
);
check('admin login rejects wrong password', res.status, 401);

const { hashPassword } = await import('../edge-functions/_shared/auth.js');
const stored = JSON.parse(store.get('settings'));
stored.adminHash = await hashPassword('secret123', 'salt');
store.set('settings', JSON.stringify(stored));

res = await login(
  ctx(
    new Request('https://example.com/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret123' }),
    })
  )
);
check('admin login accepts correct password', res.status, 200);
const adminToken = (await res.json()).token;
assert('admin session token issued', typeof adminToken === 'string' && adminToken.length > 20, String(adminToken));

res = await keysAdmin(ctx(new Request('https://example.com/admin/keys', { headers: { 'x-admin-token': adminToken } })));
check('admin keys list', (await res.json()).keys.length, 1);

res = await keysAdmin(
  ctx(
    new Request('https://example.com/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ name: 'second' }),
    })
  )
);
const createdKey = await res.json();
assert('admin key created', String(createdKey.key).startsWith('sk-qwenwork-'), JSON.stringify(createdKey));

res = await keysAdmin(ctx(new Request('https://example.com/admin/keys', { headers: { 'x-admin-token': 'bogus' } })));
check('admin rejects bad session', res.status, 401);

{
  // bootstrap: initial password setup must hand back the one-time default API key
  const seeded = store.get('settings');
  const seededSession = store.get('admin_session');
  store.delete('settings');
  res = await bootstrap(
    ctx(
      new Request('https://example.com/admin/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'secret123' }),
      })
    )
  );
  check('bootstrap status', res.status, 200);
  const boot = await res.json();
  assert('bootstrap issues session token', typeof boot.token === 'string' && boot.token.length > 20, JSON.stringify(boot));
  assert('bootstrap returns default api key', String(boot.apiKey).startsWith('sk-qwenwork-'), JSON.stringify(boot));
  const bootStored = JSON.parse(store.get('settings'));
  check('bootstrap marks initialized', bootStored.initialized, true);
  check('bootstrap default key persisted', bootStored.apiKeys[0].key, boot.apiKey);

  res = await bootstrap(
    ctx(
      new Request('https://example.com/admin/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'another1' }),
      })
    )
  );
  check('bootstrap rejected after init', res.status, 401);
  store.set('settings', seeded);
  store.set('admin_session', seededSession);
}

res = await keysAdmin(
  ctx(
    new Request('https://example.com/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ action: 'reveal', id: 'k1', password: 'wrong' }),
    })
  )
);
check('admin key reveal rejects wrong password', res.status, 401);

res = await keysAdmin(
  ctx(
    new Request('https://example.com/admin/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ action: 'reveal', id: 'k1', password: 'secret123' }),
    })
  )
);
const revealed = await res.json();
check('admin key reveal returns full key', revealed.key, 'sk-test-key');

res = await overviewAdmin(ctx(new Request('https://example.com/admin/overview?credits=0', { headers: { 'x-admin-token': adminToken } })));
const overview = await res.json();
check('overview account count', overview.total, 1);
check('overview base url', overview.baseUrl, 'https://example.com/v1');
assert('overview stats recorded requests', overview.stats.requests > 0, JSON.stringify(overview.stats));

res = await oauthStart(
  ctx(new Request('https://example.com/admin/oauth/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: '{}' }))
);
const flow = await res.json();
assert('oauth start returns device url', String(flow.url).startsWith('https://gateway.qwenwork.cn/device/selectAccounts?'), flow.url);
assert('oauth url carries pkce', flow.url.includes('challenge_method=S256') && flow.url.includes('client_id=e883ade2'), flow.url);
assert('oauth start returns state', String(flow.state).startsWith('qw_'), flow.state);
assert('oauth state persisted to kv', store.has(`login_${flow.state}`), [...store.keys()].join(','));

res = await keepalive(ctx(new Request('https://example.com/cron/keepalive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })));
const cron = await res.json();
check('cron unauthorized keeps accounts fresh', cron.accounts[0].status, 'fresh');
check('cron reports unauthorized', cron.authorized, false);

const { onRequest: settingsAdmin } = await import('../edge-functions/admin/settings.js');
res = await settingsAdmin(
  ctx(
    new Request('https://example.com/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ streamMode: 'buffered' }),
    })
  )
);
check('settings streamMode saved', (await res.json()).streamMode, 'buffered');

res = await chatCompletions(ctx(chatRequest({ model: 'pro', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'sk-test-key')));
check('chat buffered status', res.status, 200);
check('chat buffered content-type', res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
const buffered = await res.text();
const bufferedFrames = buffered.split('\n\n').filter(Boolean);
check('chat buffered frame count', bufferedFrames.length, 3);
const bufferedFirst = JSON.parse(bufferedFrames[0].slice(5));
check('chat buffered chunk object', bufferedFirst.object, 'chat.completion.chunk');
check('chat buffered delta content', bufferedFirst.choices[0].delta.content, '你好，世界');
check('chat buffered finish reason', bufferedFirst.choices[0].finish_reason, 'stop');
check('chat buffered usage frame', JSON.parse(bufferedFrames[1].slice(5)).usage.total_tokens, 16);
check('chat buffered last frame done', bufferedFrames[2].trim(), 'data: [DONE]');

res = await settingsAdmin(
  ctx(
    new Request('https://example.com/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ streamMode: 'realtime' }),
    })
  )
);
check('settings streamMode restored', (await res.json()).streamMode, 'realtime');

res = await keepalive(
  ctx(
    new Request('https://example.com/cron/keepalive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'cron_test', force: true }),
    })
  )
);
const cronForced = await res.json();
check('cron authorized', cronForced.authorized, true);
assert('cron refresh attempted upstream', upstreamCalls.some((c) => c.url === '/api/v1/deviceToken/refresh'), upstreamCalls.map((c) => c.url).join(','));

await Promise.allSettled(waitUntilCalls);
server.close();
if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
await new Promise((r) => setTimeout(r, 250));

console.log(failed === 0 ? '\nall e2e checks passed' : `\n${failed} e2e check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
