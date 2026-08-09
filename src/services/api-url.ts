type RuntimeConfig = { apiBaseUrl?: unknown };

declare global { interface Window { __SOMEWHERE_RUNTIME__?: RuntimeConfig } }

/** Keeps local Vite and existing relative /api deployments working, while a
 * CloudBase runtime config can point static hosting at its HTTP function. */
export function apiUrl(path: string): string {
  const configured = typeof window !== 'undefined' ? window.__SOMEWHERE_RUNTIME__?.apiBaseUrl : undefined;
  const base = typeof configured === 'string' ? configured.trim().replace(/\/$/, '') : '';
  return base ? `${base}${path}` : path;
}
