/**
 * 真实模型接入的边界说明：浏览器端只调用自有服务端代理，绝不携带 TokenHub secret。
 * 这里保留一个小型 adapter 契约，后续可由 /api/travel-agent 实现。
 */
export type TokenHubRequest = { input: string; scenario?: string };
export type TokenHubClient = (request: TokenHubRequest) => Promise<unknown>;

export const createTokenHubClient = (endpoint = '/api/travel-agent', timeoutMs = 15000): TokenHubClient => async (request) => {
  if (typeof fetch === 'undefined') throw new Error('Travel agent is unavailable in this browser');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = typeof window !== 'undefined' ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller?.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Travel agent request failed: ${response.status}`);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error('Travel agent returned invalid JSON');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Travel agent request timed out');
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};
