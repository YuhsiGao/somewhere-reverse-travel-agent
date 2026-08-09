import { createPoiVerificationHandler } from '../../../server/poi-verification.mjs';

// The shared core owns parsing and the 4 KB limit. Configuration comes only
// from Vercel's process environment; this adapter never reads local files.
export const config = { api: { bodyParser: false } };

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
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
};

const requestUrl = (req, headers) => {
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto === 'http' ? 'http' : 'https';
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost';
  return `${protocol}://${host}${req.url || '/api/poi-verification'}`;
};

/** Convert a Vercel Node req/res pair to the platform-neutral POI BFF core. */
export default async function poiVerification(req, res) {
  const headers = normalizeHeaders(req.headers);
  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readNodeBody(req);
  const request = new Request(requestUrl(req, headers), { method, headers, body });
  const response = await createPoiVerificationHandler({ env: process.env })(request);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status).end(await response.text());
}
