import http from 'node:http';
import { Readable } from 'node:stream';
import { createTokenHubAgentHandler } from './server/tokenhub-agent.mjs';
import { createDestinationRecallHandler } from './server/destination-recall.mjs';
import { createMediaInsightHandler } from './server/media-insight.mjs';
import { createPoiVerificationHandler } from './server/poi-verification.mjs';
import { createRoutingHandler } from './server/routing.mjs';
import { createWeatherHandler } from './server/weather.mjs';
import { createPoiDiscoveryHandler } from './server/poi-discovery.mjs';

const handlers = new Map([
  ['/agent', createTokenHubAgentHandler({ env: process.env })],
  ['/destination-recall', createDestinationRecallHandler({ env: process.env })],
  ['/media-insight', createMediaInsightHandler({ env: process.env })],
  ['/poi-verification', createPoiVerificationHandler({ env: process.env })],
  ['/route', createRoutingHandler({ env: process.env })],
  ['/weather', createWeatherHandler({ env: process.env })],
  ['/poi-discovery', createPoiDiscoveryHandler({ env: process.env })],
]);

const corsHeaders = {
  'access-control-allow-origin': process.env.CORS_ORIGIN || '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-somewhere-api-key, x-somewhere-gateway, x-somewhere-model',
  'access-control-max-age': '86400',
};

function normalizeHeaders(input) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return headers;
}

function createFetchRequest(req) {
  const headers = normalizeHeaders(req.headers);
  const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http' ? 'http' : 'https';
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost';
  const method = req.method || 'GET';
  const init = { method, headers, signal: AbortSignal.timeout(65_000) };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(`${protocol}://${host}${req.url || '/'}`, init);
}

async function writeFetchResponse(res, response) {
  response.headers.forEach((value, name) => res.setHeader(name, value));
  for (const [name, value] of Object.entries(corsHeaders)) res.setHeader(name, value);
  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders); res.end(); return; }
  const path = new URL(req.url || '/', 'https://localhost').pathname.replace(/^\/api/, '') || '/';
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(JSON.stringify({ ok: true, service: 'somewhere-api' }));
    return;
  }
  const handler = handlers.get(path);
  if (!handler) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(JSON.stringify({ error: { code: 'not_found', message: '接口不存在。' } }));
    return;
  }
  try { await writeFetchResponse(res, await handler(createFetchRequest(req))); }
  catch {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders });
    res.end(JSON.stringify({ error: { code: 'internal_error', message: '服务暂时不可用。' } }));
  }
});

server.listen(9000);
