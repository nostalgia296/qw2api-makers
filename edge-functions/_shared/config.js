export const BASE = 'https://gateway.qwenwork.cn';

export const UA = 'qoderwork/1.0.5';

export const CLIENT_ID = 'e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb';
export const REDIRECT_URI = 'qwenwork-cn://';

export const CHAT_URL = `${BASE}/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common`;
export const MODELS_URL = `${BASE}/algo/api/v2/model/list`;
export const USERINFO_URL = `${BASE}/api/v1/userinfo`;
export const ACCOUNT_CONTEXT_URL = `${BASE}/api/v1/adapter/user/account-context?include=user,plan,quota`;
export const POLL_URL = `${BASE}/api/v1/deviceToken/poll`;
export const REFRESH_URL = `${BASE}/api/v1/deviceToken/refresh`;
export const DEVICE_AUTH_URL = `${BASE}/device/selectAccounts`;

export const COSY_VERSION = '1.1.18';
export const IDE_VERSION = '1.0.5';
export const RELEASE_VERSION = '1.0.5-26090901';
export const BUILD = '26090901';
export const CLIENT_TYPE = '6';
export const BUSINESS_PRODUCT = 'qoder_work';
export const BUSINESS_TYPE = 'agent';
export const SCENE = 'qwork';
export const MACHINE_OS = 'x86_64_win32';

export const DEFAULT_MODEL = 'pro';
export const CONTEXT_LENGTH = 180000;
export const MAX_COMPLETION_TOKENS = 32768;

export const STATIC_MODELS = [
  { key: 'pro', name: 'QwenWork 高级 (Pro)' },
  { key: 'flash', name: 'QwenWork Qwen3.8-Flash' },
  { key: 'qwen3.8-max-preview', name: 'QwenWork Qwen3.8-Max' },
];

export const KV_NAMES = ['QWENWORK_KV', 'qwenwork_kv', 'QWENWORK2API_KV', 'my_kv', 'KV'];

export const SETTINGS_KEY = 'settings';
export const SESSION_KEY = 'admin_session';
export const ACCOUNT_PREFIX = 'acct_';
export const LOGIN_PREFIX = 'login_';
export const STATS_KEY = 'stats';

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const COOLDOWN_MS = 60 * 1000;
export const COOLDOWN_SHORT_MS = 15 * 1000;
export const REFRESH_MARGIN_MS = 30 * 60 * 1000;
export const MODELS_CACHE_MS = 5 * 60 * 1000;
