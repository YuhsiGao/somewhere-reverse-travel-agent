import { createDestinationRecallHandler } from '../../../server/destination-recall.mjs';

export const config = { api: { bodyParser: false } };

const headersFor = (headers = {}) => {
  const normalized = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) normalized.set(name, value.join(', '));
    else if (typeof value === 'string' || typeof value === 'number') normalized.set(name, String(value));
  }
  return normalized;
};

const bodyFor = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
};

export default async function destinationRecall(req, res) {
  const headers = headersFor(req.headers);
  const method = req.method || 'GET';
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto === 'http' ? 'http' : 'https';
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await bodyFor(req);
  const request = new Request(`${protocol}://${host}${req.url || '/api/destination-recall'}`, { method, headers, body });
  const response = await createDestinationRecallHandler({ env: process.env })(request);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status).end(await response.text());
}
