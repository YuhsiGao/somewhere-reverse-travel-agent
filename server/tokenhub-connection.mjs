/** Request-scoped BYOK configuration. It deliberately supports only the
 * official TokenHub gateway, so a browser setting cannot turn this BFF into an
 * arbitrary outbound proxy. Values are never included in responses or logs. */
export const TOKENHUB_GATEWAY = 'https://tokenhub.tencentmaas.com';
const MODEL_NAME = /^[A-Za-z0-9._:-]{1,120}$/;

const present = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

export function resolveTokenHubConnection(request, env, fallbackModel) {
  const headerGateway = request.headers.get('x-somewhere-gateway');
  const requestedGateway = headerGateway?.trim().replace(/\/$/, '');
  // Deployment configuration is trusted server-side. Only the browser override
  // is constrained, preventing a request from proxying to arbitrary hosts.
  if (requestedGateway && requestedGateway !== TOKENHUB_GATEWAY) return { error: 'invalid_gateway' };
  const gateway = requestedGateway || env.TOKENHUB_BASE_URL?.trim().replace(/\/$/, '') || TOKENHUB_GATEWAY;
  const headerModel = request.headers.get('x-somewhere-model')?.trim();
  const model = headerModel || env.TOKENHUB_MODEL || fallbackModel;
  if (!MODEL_NAME.test(model)) return { error: 'invalid_model' };
  const headerKey = request.headers.get('x-somewhere-api-key')?.trim();
  const apiKey = headerKey || env.TOKENHUB_API_KEY;
  if (!present(apiKey, 500)) return { error: 'missing_key' };
  return { apiKey, gateway, model };
}
