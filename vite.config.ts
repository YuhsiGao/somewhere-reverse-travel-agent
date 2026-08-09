import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createTokenHubAgentHandler } from './server/tokenhub-agent.mjs';
import { createDestinationRecallHandler } from './server/destination-recall.mjs';
import { createMediaInsightHandler } from './server/media-insight.mjs';
import { createPoiVerificationHandler } from './server/poi-verification.mjs';
import { createRoutingHandler } from './server/routing.mjs';
import { createWeatherHandler } from './server/weather.mjs';
import { createPoiDiscoveryHandler } from './server/poi-discovery.mjs';

function sendJson(res: import('node:http').ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function developmentTokenHubKey(env: Record<string, string>) {
  if (env.TOKENHUB_API_KEY) return env.TOKENHUB_API_KEY;
  try {
    const keyText = fs.readFileSync(path.resolve(process.cwd(), 'key.md'), 'utf8');
    return keyText.match(/^tokenhub\s*:\s*(\S+)/mi)?.[1];
  } catch {
    return undefined;
  }
}

function tokenHubProxy(env: Record<string, string>): Plugin {
  const handlerEnv = {
    ...env,
    TOKENHUB_API_KEY: developmentTokenHubKey(env),
    // Nominatim requires an identifying User-Agent. Production deliberately
    // does not inherit this fallback: deployers must set a contactable value.
    NOMINATIM_USER_AGENT: env.NOMINATIM_USER_AGENT || 'SomewhereTravelAgent/0.1 (local development)',
  };
  const agentHandler = createTokenHubAgentHandler({ env: handlerEnv });
  const destinationRecallHandler = createDestinationRecallHandler({ env: handlerEnv });
  const mediaInsightHandler = createMediaInsightHandler({ env: handlerEnv });
  const poiVerificationHandler = createPoiVerificationHandler({ env: handlerEnv });
  const routingHandler = createRoutingHandler({ env: handlerEnv });
  const weatherHandler = createWeatherHandler({ env: handlerEnv });
  const poiDiscoveryHandler = createPoiDiscoveryHandler({ env: handlerEnv });
  const serveFetchHandler = (handler: (request: Request) => Promise<Response>) => async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const abort = new AbortController();
    req.on('aborted', () => abort.abort(), { once: true });
    const headers = new Headers();
    Object.entries(req.headers).forEach(([name, value]) => {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    });
    const origin = `http://${req.headers.host || '127.0.0.1'}`;
    const method = req.method || 'GET';
    const requestInit: RequestInit & { duplex?: 'half' } = { method, headers, signal: abort.signal };
    // Route every HTTP method into the shared handler so local development has
    // the same 405/Allow contract as its Vercel adapter. Fetch forbids bodies
    // on GET/HEAD, so only stream bodies for methods that may carry one.
    if (method !== 'GET' && method !== 'HEAD') {
      requestInit.body = Readable.toWeb(req) as unknown as BodyInit;
      requestInit.duplex = 'half';
    }
    const request = new Request(new URL(req.url || '/api', origin), requestInit);
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'somewhere-tokenhub-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (/^\/(?:key\.md|\.env(?:\.|$)|\.git(?:\/|$))/i.test(pathname)) return sendJson(res, 404, { error: 'Not found' });
        return next();
      });
      server.middlewares.use('/api/agent', serveFetchHandler(agentHandler));
      server.middlewares.use('/api/destination-recall', serveFetchHandler(destinationRecallHandler));
      server.middlewares.use('/api/media-insight', serveFetchHandler(mediaInsightHandler));
      server.middlewares.use('/api/poi-verification', serveFetchHandler(poiVerificationHandler));
      server.middlewares.use('/api/route', serveFetchHandler(routingHandler));
      server.middlewares.use('/api/weather', serveFetchHandler(weatherHandler));
      server.middlewares.use('/api/poi-discovery', serveFetchHandler(poiDiscoveryHandler));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { base: './', plugins: [react(), tokenHubProxy(env)] };
});
