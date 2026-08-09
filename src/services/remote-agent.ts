import type { VibeProfile } from '../types';
import { connectionHeaders, type ConnectionSettings } from './connection-settings';

export type RecalledDestination = {
  id: string;
  city: string;
  region: string;
  country: string;
  role: 'best-match' | 'unexpected' | 'easy-to-reach';
  tagline: string;
  atmosphere: string[];
  reasons: string[];
  tradeoff: string;
  budgetNote: string;
  alternative: string;
  coordinates: [number, number];
  outline: Array<{ theme: string; intro: string; anchor: string }>;
};

export type DestinationRecallRequest = {
  input: string;
  profile: VibeProfile;
  constraints: { scope: 'any' | 'domestic' | 'abroad'; days: 2 | 3 | 4; budget: 'flexible' | 'low' | 'medium'; departure: string; transport: string };
};

export async function interpretWithTokenHub(input: string, connection?: ConnectionSettings): Promise<VibeProfile> {
  let lastError: Error | undefined;
  // TokenHub can transiently reject or time out while a model worker is being
  // scheduled. One short retry prevents an otherwise healthy first interaction
  // from being immediately labelled as local-demo mode.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(connection ? connectionHeaders(connection, 'agent') : {}) }, body: JSON.stringify({ input }),
      });
      const payload = await response.json().catch(() => null) as { profile?: VibeProfile; error?: string | { message?: string } } | null;
      if (response.ok && payload?.profile) return payload.profile;
      const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
      throw new Error(message || `TokenHub 请求失败（${response.status}）`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('TokenHub 请求失败');
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }
  throw lastError;
}

/** Dynamic recall is intentionally separate from intent parsing so the UI can
 * show the user's interpreted preferences before it asks the model for places. */
export async function recallDestinationsWithTokenHub(request: DestinationRecallRequest, connection?: ConnectionSettings): Promise<RecalledDestination[]> {
  const response = await fetch('/api/destination-recall', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(connection ? connectionHeaders(connection, 'agent') : {}) }, body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null) as { candidates?: RecalledDestination[]; error?: { message?: string } } | null;
  if (!response.ok || !payload?.candidates) throw new Error(payload?.error?.message || `TokenHub 召回失败（${response.status}）`);
  return payload.candidates;
}
