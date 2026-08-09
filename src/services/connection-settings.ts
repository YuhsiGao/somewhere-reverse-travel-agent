export type ConnectionSettings = {
  gateway: string;
  agentModel: string;
  visionModel: string;
  apiKey: string;
};

const PREFERENCE_STORAGE_KEY = 'somewhere.connection-preferences.v1';
const SESSION_KEY_STORAGE_KEY = 'somewhere.connection-key.v1';
export const TOKENHUB_GATEWAY = 'https://tokenhub.tencentmaas.com';

export const defaultConnectionSettings: ConnectionSettings = {
  gateway: TOKENHUB_GATEWAY,
  agentModel: 'hy3',
  visionModel: 'youtu-vita',
  apiKey: '',
};

const isModelName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const isGateway = (value: unknown): value is string => typeof value === 'string' && value.replace(/\/$/, '') === TOKENHUB_GATEWAY;

export function readConnectionSettings(): ConnectionSettings {
  try {
    const preference: unknown = JSON.parse(window.localStorage.getItem(PREFERENCE_STORAGE_KEY) || 'null');
    const storedKey = window.sessionStorage.getItem(SESSION_KEY_STORAGE_KEY) || '';
    if (!preference || typeof preference !== 'object' || Array.isArray(preference)) return { ...defaultConnectionSettings, apiKey: storedKey.slice(0, 500) };
    const value = preference as Partial<ConnectionSettings>;
    return {
      gateway: isGateway(value.gateway) ? value.gateway.replace(/\/$/, '') : defaultConnectionSettings.gateway,
      agentModel: isModelName(value.agentModel) ? value.agentModel : defaultConnectionSettings.agentModel,
      visionModel: isModelName(value.visionModel) ? value.visionModel : defaultConnectionSettings.visionModel,
      apiKey: storedKey.slice(0, 500),
    };
  } catch { return { ...defaultConnectionSettings }; }
}

/** Persists non-secret preferences only. The key survives a reload, but never a
 * browser-session restart; it is never written to localStorage. */
export function saveConnectionSettings(settings: ConnectionSettings): ConnectionSettings {
  const safe: ConnectionSettings = {
    gateway: isGateway(settings.gateway) ? settings.gateway.replace(/\/$/, '') : defaultConnectionSettings.gateway,
    agentModel: isModelName(settings.agentModel.trim()) ? settings.agentModel.trim() : defaultConnectionSettings.agentModel,
    visionModel: isModelName(settings.visionModel.trim()) ? settings.visionModel.trim() : defaultConnectionSettings.visionModel,
    apiKey: settings.apiKey.trim().slice(0, 500),
  };
  try {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify({ gateway: safe.gateway, agentModel: safe.agentModel, visionModel: safe.visionModel }));
    if (safe.apiKey) window.sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, safe.apiKey);
    else window.sessionStorage.removeItem(SESSION_KEY_STORAGE_KEY);
  } catch { /* storage can be unavailable; the in-memory settings still work */ }
  return safe;
}

export function connectionHeaders(settings: ConnectionSettings, kind: 'agent' | 'vision'): HeadersInit {
  const headers: Record<string, string> = {
    'x-somewhere-gateway': settings.gateway,
    'x-somewhere-model': kind === 'vision' ? settings.visionModel : settings.agentModel,
  };
  if (settings.apiKey) headers['x-somewhere-api-key'] = settings.apiKey;
  return headers;
}

export function hasConnectionKey(settings: Pick<ConnectionSettings, 'apiKey'>): boolean {
  return settings.apiKey.trim().length > 0;
}
