/**
 * Optional cross-instance governor for public upstreams. Upstash REST is used
 * directly so the service has no browser dependency or SDK lock-in. Without
 * credentials callers retain their existing single-instance demo limiter.
 */
const configured = (env) => typeof env.UPSTASH_REDIS_REST_URL === 'string' && /^https:\/\//.test(env.UPSTASH_REDIS_REST_URL)
  && typeof env.UPSTASH_REDIS_REST_TOKEN === 'string' && env.UPSTASH_REDIS_REST_TOKEN.length > 10;

export function createSharedRateGovernor(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const fetchFn = options.fetch ?? globalThis.fetch;
  const enabled = configured(env) && typeof fetchFn === 'function';
  return {
    enabled,
    /** `granted` means this process owns the public request slot; fail closed when configured but unreachable. */
    async reserve(key, intervalMs) {
      if (!enabled) return 'not-configured';
      const safeInterval = Math.max(100, Math.min(60_000, Math.floor(intervalMs)));
      const safeKey = `somewhere:public-rate:${String(key).replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120)}`;
      try {
        const url = new URL(env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '') + `/set/${encodeURIComponent(safeKey)}/1/NX/PX/${safeInterval}`);
        const response = await fetchFn(url, { method: 'POST', headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) return 'unavailable';
        return payload?.result === 'OK' ? 'granted' : 'denied';
      } catch { return 'unavailable'; }
    },
  };
}
