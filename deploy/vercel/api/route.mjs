import { createRoutingHandler } from '../../../server/routing.mjs';

export const config = { api: { bodyParser: false } };

const handler = createRoutingHandler({ env: process.env });
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
  return `${proto}://${host}${req.url || '/api/route'}`;
};

/** Vercel Node req/res adapter; configuration comes exclusively from process.env. */
export default async function route(req, res) {
  const headers = normalizeHeaders(req.headers);
  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readNodeBody(req);
  const request = new Request(requestUrl(req, headers), { method, headers, body });
  const response = await handler(request);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status).end(await response.text());
}
