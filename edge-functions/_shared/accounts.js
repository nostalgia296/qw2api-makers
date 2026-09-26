import { getJSON, putJSON, listKeys } from './kv.js';
import { cleanErrorText } from './http.js';
import { ACCOUNT_PREFIX, COOLDOWN_MS, REFRESH_MARGIN_MS } from './config.js';
import { invalidateSession } from './cosy.js';
import { refreshDeviceToken, userInfo, expiryUnix } from './upstream.js';

export const accountKey = (id) => `${ACCOUNT_PREFIX}${id}`;

export async function listAccounts(kv) {
  const keys = await listKeys(kv, ACCOUNT_PREFIX);
  const accounts = [];
  for (const key of keys) {
    const acc = await getJSON(kv, key);
    if (acc && acc.id) accounts.push(acc);
  }
  accounts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return accounts;
}

export async function getAccount(kv, id) {
  return getJSON(kv, accountKey(id));
}

export async function saveAccount(kv, account) {
  await putJSON(kv, accountKey(account.id), account);
  return account;
}

export async function deleteAccount(kv, id) {
  await kv.delete(accountKey(id));
}

export function publicView(account) {
  const now = Date.now();
  return {
    id: account.id,
    uid: account.uid || '',
    nickname: account.nickname || '',
    email: account.email || '',
    enterpriseId: account.enterpriseId || '',
    disabled: !!account.disabled,
    note: account.note || '',
    createdAt: account.createdAt || 0,
    lastUsed: account.lastUsed || 0,
    expiresAt: account.expiresAt || 0,
    expired: account.expiresAt ? account.expiresAt * 1000 <= now : false,
    cooling: !!account.cooldownUntil && account.cooldownUntil > now,
    cooldownUntil: account.cooldownUntil || 0,
    lastError: account.lastError || '',
  };
}

export function isUsable(account, now = Date.now()) {
  if (!account || account.disabled) return false;
  if (account.cooldownUntil && account.cooldownUntil > now) return false;
  if (account.expiresAt && account.expiresAt * 1000 <= now + 60 * 1000) return false;
  return true;
}

export function needsRefresh(account, now = Date.now()) {
  return !!account && !!account.refreshToken && !account.disabled && account.expiresAt * 1000 - now < REFRESH_MARGIN_MS;
}

export function pickAccount(accounts, now = Date.now()) {
  const usable = accounts.filter((a) => isUsable(a, now));
  if (usable.length === 0) return null;
  usable.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  return usable[0];
}

export function markCooldown(account, message, ms) {
  account.cooldownUntil = Date.now() + (Number(ms) > 0 ? Number(ms) : COOLDOWN_MS);
  account.lastError = cleanErrorText(message);
  return account;
}

export function markDead(account, message) {
  account.disabled = true;
  account.lastError = cleanErrorText(message);
  return account;
}

export async function refreshAccount(kv, account) {
  const data = await refreshDeviceToken(account.refreshToken);
  account.accessToken = data.token || data.device_token;
  account.refreshToken = data.refresh_token || account.refreshToken;
  account.expiresAt = expiryUnix(data);
  account.disabled = false;
  account.cooldownUntil = 0;
  account.lastError = '';
  invalidateSession(account);
  await saveAccount(kv, account);
  return account;
}

export async function enrichAccount(kv, account) {
  try {
    const info = await userInfo(account.accessToken);
    if (info) {
      if (info.id) account.uid = info.id;
      if (info.name) account.nickname = info.name;
      if (info.email) account.email = info.email;
      invalidateSession(account);
      await saveAccount(kv, account);
    }
  } catch {
    /* identity stays as captured at login */
  }
  return account;
}

export function accountId() {
  const r = new Uint8Array(8);
  crypto.getRandomValues(r);
  let out = '';
  for (let i = 0; i < r.length; i++) out += r[i].toString(16).padStart(2, '0');
  return out;
}

export function newAccount(grant, fallbackNickname) {
  const uid = (grant && grant.user_id) || '';
  let nickname = (grant && grant.user_name) || fallbackNickname || '';
  if (!nickname) nickname = uid.length > 8 ? `u${uid.slice(-8)}` : `u${uid}`;
  return {
    id: accountId(),
    uid,
    nickname,
    email: '',
    enterpriseId: '',
    accessToken: grant && (grant.token || grant.device_token),
    refreshToken: (grant && grant.refresh_token) || '',
    expiresAt: expiryUnix(grant),
    disabled: false,
    note: '',
    createdAt: Date.now(),
    lastUsed: 0,
    cooldownUntil: 0,
    lastError: '',
  };
}
