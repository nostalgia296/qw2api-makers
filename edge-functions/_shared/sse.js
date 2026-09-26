import { cleanErrorText } from './http.js';

function fmtBodyText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function bodyCodeMessage(raw, status) {
  let inner;
  try {
    inner = JSON.parse(raw);
  } catch {
    return status >= 400 ? `upstream ${status}: ${String(raw).slice(0, 200)}` : '';
  }
  if (!inner || typeof inner !== 'object') return '';
  const code = inner.code;
  if (code === '400' || code === '401' || code === '403') {
    return inner.message ? String(inner.message) : `upstream ${code}`;
  }
  if (status >= 400) {
    return inner.message ? String(inner.message) : `upstream ${status}: ${String(raw).slice(0, 200)}`;
  }
  return '';
}

export function unwrapFrame(payload) {
  if (typeof payload !== 'string') return { ok: false };
  const text = String(payload).trim();
  if (!text || text === '[DONE]' || text === '{}') return { ok: false };
  let outer;
  try {
    outer = JSON.parse(text);
  } catch {
    return { ok: true, body: text };
  }
  if (!outer || typeof outer !== 'object') return { ok: false };
  if (Object.prototype.hasOwnProperty.call(outer, 'choices')) return { ok: true, body: text };
  if (outer.object === 'chat.completion.chunk' || outer.object === 'chat.completion') return { ok: true, body: text };
  if (typeof outer.statusCodeValue === 'number' && outer.statusCodeValue >= 400) {
    return { ok: false, error: bodyCodeMessage(fmtBodyText(outer.body), outer.statusCodeValue) };
  }
  if (!Object.prototype.hasOwnProperty.call(outer, 'body')) return { ok: false };
  const inner = outer.body;
  if (typeof inner === 'string') {
    if (!inner || inner === '[DONE]' || inner === '{}' || inner === 'null') return { ok: false };
    const msg = bodyCodeMessage(inner, 0);
    if (msg) return { ok: false, error: msg };
    return { ok: true, body: inner };
  }
  if (inner && typeof inner === 'object') {
    const s = JSON.stringify(inner);
    if (s === '{}' || s === '[]') return { ok: false };
    return { ok: true, body: s };
  }
  return { ok: false };
}

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    for (const key of Object.keys(v)) {
      if (!isEmptyValue(v[key])) return false;
    }
    return true;
  }
  return false;
}

export function cleanChunk(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return text;
  }
  if (!obj || typeof obj !== 'object') return text;

  if (obj.usage && typeof obj.usage === 'object') {
    let changed = false;
    for (const noise of ['raw_usage', 'sub_usages']) {
      if (Object.prototype.hasOwnProperty.call(obj.usage, noise)) {
        delete obj.usage[noise];
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(obj, noise)) {
        delete obj[noise];
        changed = true;
      }
    }
    return changed ? JSON.stringify(obj) : text;
  }

  let changed = false;
  if (Array.isArray(obj.choices)) {
    for (const choice of obj.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = choice.delta;
      if (!delta || typeof delta !== 'object') continue;
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) {
        delete delta.tool_calls;
        changed = true;
      }
      for (const noise of ['content', 'reasoning_content', 'function_call', 'refusal', 'extra_fields']) {
        if (Object.prototype.hasOwnProperty.call(delta, noise) && isEmptyValue(delta[noise])) {
          delete delta[noise];
          changed = true;
        }
      }
      if (Object.keys(delta).length === 0 && !choice.finish_reason) return '';
    }
  }
  return changed ? JSON.stringify(obj) : text;
}

function mergeToolCallDelta(merged, delta) {
  for (const key of ['id', 'type']) {
    if (merged[key] === undefined && typeof delta[key] === 'string' && delta[key] !== '') merged[key] = delta[key];
  }
  const dfn = delta.function;
  if (!dfn || typeof dfn !== 'object') return;
  if (!merged.function || typeof merged.function !== 'object') merged.function = {};
  if (typeof dfn.name === 'string' && dfn.name !== '') merged.function.name = (merged.function.name || '') + dfn.name;
  if (typeof dfn.arguments === 'string' && dfn.arguments !== '') {
    merged.function.arguments = (merged.function.arguments || '') + dfn.arguments;
  }
}

export function aggregate(chunks, model) {
  let content = '';
  let reasoning = '';
  let role = '';
  let respModel = '';
  let respID = '';
  let finish = '';
  let created = 0;
  let usage = null;
  const toolCalls = new Map();
  const toolOrder = [];

  for (const text of chunks) {
    let chunk;
    try {
      chunk = JSON.parse(text);
    } catch {
      continue;
    }
    if (!chunk || typeof chunk !== 'object') continue;
    if (typeof chunk.id === 'string' && chunk.id !== '') respID = chunk.id;
    if (typeof chunk.model === 'string' && chunk.model !== '') respModel = chunk.model;
    if (typeof chunk.created === 'number') created = chunk.created;
    if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage;
    if (!Array.isArray(chunk.choices)) continue;
    for (const choice of chunk.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = choice.delta;
      if (delta && typeof delta === 'object') {
        if (typeof delta.role === 'string' && delta.role !== '') role = delta.role;
        if (typeof delta.content === 'string') content += delta.content;
        if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            if (!call || typeof call !== 'object') continue;
            const idx = typeof call.index === 'number' ? call.index : 0;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { index: idx });
              toolOrder.push(idx);
            }
            mergeToolCallDelta(toolCalls.get(idx), call);
          }
        }
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') finish = choice.finish_reason;
    }
  }

  const message = { role: role || 'assistant', content };
  if (reasoning !== '') message.reasoning_content = reasoning;
  if (toolOrder.length > 0) {
    toolOrder.sort((a, b) => a - b);
    message.tool_calls = toolOrder.map((idx) => toolCalls.get(idx));
  }
  const result = {
    id: respID || 'chatcmpl-qwenwork',
    object: 'chat.completion',
    created: created || Math.floor(Date.now() / 1000),
    model: respModel || model,
    choices: [{ index: 0, message, finish_reason: finish || 'stop' }],
  };
  if (usage) result.usage = usage;
  return result;
}

function handleLine(line, state) {
  if (!line.startsWith('data:')) return null;
  const frame = unwrapFrame(line.slice(5));
  if (frame.error) {
    state.error = frame.error;
    return null;
  }
  if (!frame.ok) return null;
  try {
    const parsed = JSON.parse(frame.body);
    if (parsed && typeof parsed === 'object' && parsed.usage && typeof parsed.usage === 'object') state.usage = parsed.usage;
  } catch {
    /* keep raw chunk */
  }
  const cleaned = cleanChunk(frame.body);
  if (!cleaned) return null;
  return `data: ${cleaned}\n\n`;
}

export async function collectSync(upstreamBody, model) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const chunks = [];
  const state = { usage: null, error: null };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const out = handleLine(line, state);
        if (out) chunks.push(out.slice(6).trim());
      }
    }
    if (buffer) {
      const out = handleLine(buffer, state);
      if (out) chunks.push(out.slice(6).trim());
    }
  } catch (err) {
    state.error = `upstream stream read error: ${err && err.message ? err.message : err}`;
  }

  if (state.error) return { error: cleanErrorText(state.error) };
  return { completion: aggregate(chunks, model), usage: state.usage };
}

export function transform(upstreamBody, model, onUsage, { heartbeatMs = 15000 } = {}) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let notified = false;
  let heartbeat = null;
  const state = { usage: null, error: null };

  const notify = () => {
    if (notified) return;
    notified = true;
    if (onUsage) onUsage(state.usage);
  };

  const emitError = (controller, message) => {
    try {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`)
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    } catch {
      /* stream already closed by the client */
    }
  };

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const finish = () => {
    stopHeartbeat();
    notify();
  };

  return new ReadableStream({
    start(controller) {
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            /* stream already closed */
          }
        }, heartbeatMs);
        if (heartbeat.unref) heartbeat.unref();
      }
    },
    async pull(controller) {
      try {
        for (;;) {
          let read;
          try {
            read = await reader.read();
          } catch (err) {
            const message = `upstream stream read error: ${err && err.message ? err.message : err}`;
            stopHeartbeat();
            emitError(controller, message);
            notify();
            return;
          }
          if (read.done) {
            stopHeartbeat();
            if (buffer) {
              const out = handleLine(buffer, state);
              if (out) controller.enqueue(encoder.encode(out));
              buffer = '';
            }
            if (state.error) emitError(controller, state.error);
            else {
              try {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              } catch {
                /* stream already closed by the client */
              }
            }
            finish();
            return;
          }
          buffer += decoder.decode(read.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          let out = '';
          for (const line of lines) {
            const frame = handleLine(line, state);
            if (frame) out += frame;
          }
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (err) {
        finish();
        try {
          emitError(controller, `stream error: ${err && err.message ? err.message : err}`);
        } catch {
          /* already closed */
        }
      }
    },
    cancel(reason) {
      finish();
      if (reader.cancel) reader.cancel(reason);
    },
  });
}
