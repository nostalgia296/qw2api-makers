import { uuid } from './crypto.js';
import { DEFAULT_MODEL, BUSINESS_PRODUCT, BUSINESS_TYPE } from './config.js';

export function mapModel(name) {
  const m = String(name || '').trim();
  switch (m) {
    case '':
    case 'auto':
    case 'advanced':
    case 'pro':
      return 'pro';
    case 'lite':
    case 'flash':
      return 'flash';
    case 'max':
    case 'qwen3.8-max':
    case 'qwen3.8-max-preview':
      return 'qwen3.8-max-preview';
    default:
      return m;
  }
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const part of value) {
      if (part && typeof part === 'object' && typeof part.text === 'string') out += part.text;
    }
    return out;
  }
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function splitMessages(payload) {
  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const sysParts = [];
  const messages = [];
  let lastUser = '';
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'system') {
      const text = contentText(item.content);
      if (text) sysParts.push(text);
      continue;
    }
    messages.push(item);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      lastUser = contentText(m.content);
      break;
    }
  }
  return { system: sysParts.join('\n\n'), messages, lastUser };
}

export function buildBody(payload, modelKey, desensitize) {
  const key = modelKey || DEFAULT_MODEL;
  const requestID = uuid();
  const { system, messages, lastUser: first } = splitMessages(payload);
  let lastUser = first;
  if (!lastUser) {
    for (const m of messages) {
      if (m && m.role === 'user') {
        lastUser = contentText(m.content);
        if (lastUser) break;
      }
    }
  }
  if (!lastUser) lastUser = 'ping';

  const tokenCap = payload.max_completion_tokens !== undefined ? payload.max_completion_tokens : payload.max_tokens;
  const parameters = {};
  for (const k of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
    if (payload[k] !== undefined && payload[k] !== null) parameters[k] = payload[k];
  }
  if (tokenCap !== undefined && tokenCap !== null) {
    const n = Number(tokenCap);
    if (Number.isFinite(n) && n > 0) parameters.max_tokens = Math.floor(n);
  }
  if (parameters.max_tokens === undefined) parameters.max_tokens = 32000;

  const tools = !(payload.tool_choice === 'none') && Array.isArray(payload.tools) ? payload.tools : [];
  const isReasoning = false;

  let systemText = system;
  let upstreamMessages = messages;
  let upstreamTools = tools;
  let upstreamText = lastUser;
  if (desensitize && typeof desensitize === 'function') {
    systemText = desensitize(systemText);
    upstreamText = desensitize(upstreamText);
    upstreamMessages = messages.map((m) => {
      if (!m || typeof m !== 'object') return m;
      if (m.role === 'user' && hasCliMarker(contentText(m.content))) {
        return { ...m, content: desensitize(contentText(m.content)) };
      }
      return m;
    });
    upstreamTools = tools.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const fn = t.function && typeof t.function === 'object' ? t.function : null;
      const copy = { ...t };
      if (typeof t.description === 'string') copy.description = desensitize(t.description);
      if (fn) {
        copy.function = { ...fn };
        if (typeof fn.name === 'string') copy.function.name = desensitize(fn.name);
        if (typeof fn.description === 'string') copy.function.description = desensitize(fn.description);
      }
      return copy;
    });
  }

  return JSON.stringify({
    request_id: requestID,
    request_set_id: requestID,
    chat_record_id: requestID,
    session_id: uuid(),
    stream: true,
    chat_task: 'FREE_INPUT',
    chat_context: {
      text: upstreamText,
      features: [],
      extra: {
        context: [],
        modelConfig: { key, is_reasoning: isReasoning },
        originalContent: upstreamText,
      },
      chatPrompt: '',
      imageUrls: null,
    },
    is_reply: true,
    is_retry: false,
    source: 1,
    version: '3',
    agent_id: 'agent_common',
    task_id: 'common',
    session_type: 'qoder_work',
    aliyun_user_type: '',
    model_config: {
      key,
      display_name: key,
      model: '',
      format: 'openai',
      is_vl: true,
      is_reasoning: isReasoning,
      api_key: '',
      url: '',
      source: 'system',
      max_input_tokens: 180000,
    },
    system: systemText,
    messages: upstreamMessages,
    tools: upstreamTools,
    parameters,
    business: {
      product: BUSINESS_PRODUCT,
      type: BUSINESS_TYPE,
      version: '1',
      feature_switches: {},
    },
  });
}

function hasCliMarker(text) {
  return (
    typeof text === 'string' &&
    (text.includes('# AGENTS.md instructions') || text.includes('<system-reminder>'))
  );
}
