import { getJSON, putJSON } from './kv.js';
import { SETTINGS_KEY, SESSION_KEY, SESSION_TTL_MS } from './config.js';
import { DEFAULT_TERMS } from './desensitize.js';

export function defaultSettings() {
  return {
    initialized: false,
    adminSalt: '',
    adminHash: '',
    apiKeys: [],
    allowAnonymous: false,
    desensitize: false,
    desensitizeTerms: [],
    defaultModel: 'pro',
    requestTimeoutMs: 120000,
    streamMode: 'realtime',
  };
}

export async function getSettings(kv) {
  const stored = await getJSON(kv, SETTINGS_KEY);
  if (!stored) return defaultSettings();
  return { ...defaultSettings(), ...stored };
}

export async function saveSettings(kv, settings) {
  await putJSON(kv, SETTINGS_KEY, settings);
  return settings;
}

export async function hashPassword(password, salt) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`)));
  let out = '';
  for (let i = 0; i < digest.length; i++) out += digest[i].toString(16).padStart(2, '0');
  return out;
}

export function randomToken(bytes) {
  const r = new Uint8Array(bytes);
  crypto.getRandomValues(r);
  let out = '';
  for (let i = 0; i < r.length; i++) out += r[i].toString(16).padStart(2, '0');
  return out;
}

export async function createSession(kv) {
  const token = randomToken(24);
  await putJSON(kv, SESSION_KEY, { token, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export async function checkSession(kv, token) {
  if (!token) return false;
  const session = await getJSON(kv, SESSION_KEY);
  if (!session || session.token !== token) return false;
  if (session.expiresAt && session.expiresAt < Date.now()) return false;
  return true;
}

export async function destroySession(kv) {
  await kv.delete(SESSION_KEY);
}

export function readAdminToken(request) {
  return (
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() ||
    ''
  );
}

export function readBearer(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function envFlag(env, name) {
  const value = env ? env[name] : undefined;
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

export function apiAuthDisabled(env) {
  return envFlag(env, 'API_NO_KEY') || envFlag(env, 'DISABLE_AUTH');
}

export function adminAuthDisabled(env) {
  return envFlag(env, 'DISABLE_AUTH');
}

export function adminTokenAuthorized(env, token) {
  return !!token && !!(env && env.ADMIN_TOKEN) && env.ADMIN_TOKEN === token;
}

export function matchAPIKey(settings, token) {
  if (!token) return null;
  const keys = Array.isArray(settings.apiKeys) ? settings.apiKeys : [];
  for (const item of keys) {
    if (item && item.key && item.key === token) return item;
  }
  return null;
}

export function newAPIKey(name) {
  return {
    id: randomToken(8),
    name: name || 'default',
    key: `sk-qwenwork-${randomToken(16)}`,
    createdAt: Date.now(),
    lastUsed: 0,
  };
}

export function effectiveTerms(settings) {
  const custom = Array.isArray(settings.desensitizeTerms) ? settings.desensitizeTerms : [];
  return custom.length > 0 ? custom : DEFAULT_TERMS;
}
