import { createWeatherHandler } from '../../../server/weather.mjs';

export const config = { api: { bodyParser: false } };

const handler = createWeatherHandler();
const normalizeHeaders = (headers = {}) => {
  const normalized = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) normalized.set(name, value.join(', '));
    else if (typeof value === 'string' || typeof value === 'number') normalized.set(name, String(value));
  }
  return normalized;
};
const readNodeBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
};
const requestUrl = (req, headers) => {
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http' ? 'http' : 'https';
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost';
  return `${proto}://${host}${req.url || '/api/weather'}`;
};

/** Vercel Node req/res adapter; no local files or secrets are read. */
export default async function weather(req, res) {
  const headers = normalizeHeaders(req.headers); const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readNodeBody(req);
  const response = await handler(new Request(requestUrl(req, headers), { method, headers, body }));
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status).end(await response.text());
}
