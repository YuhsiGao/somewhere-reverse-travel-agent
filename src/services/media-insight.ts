import type { ImageInsight } from '../hooks/useLocalMedia';
import { connectionHeaders, type ConnectionSettings } from './connection-settings';
import { apiUrl } from './api-url';

const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 1000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type MediaInsightErrorCode = 'image_too_large' | 'unsupported_image' | 'file_read_failed' | 'service_unavailable' | 'service_timeout' | 'invalid_response';

/** A deliberately generic error: never surface upstream details or media metadata. */
export class MediaInsightError extends Error {
  constructor(public readonly code: MediaInsightErrorCode) {
    super(code === 'image_too_large'
      ? '图片超过 1MB，请先压缩或选择更小的图片后再分析。'
      : code === 'unsupported_image'
        ? '仅支持 JPG、PNG 或 WebP 图片。'
        : code === 'service_timeout'
          ? '图片理解服务响应超时；图片链接已校验，但暂时没有得到模型结果。你可以稍后重试，或自己补充图片关键词。'
          : '图片灵感服务暂时不可用，请稍后重试或继续只使用文字偏好。');
    this.name = 'MediaInsightError';
  }
}

export function validateImageForAnalysis(file: File): MediaInsightErrorCode | undefined {
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) return 'unsupported_image';
  if (file.size > MAX_IMAGE_BYTES) return 'image_too_large';
  return undefined;
}

/** Reads the explicitly authorized file in memory only. It is never cached or persisted. */
export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new MediaInsightError('file_read_failed'));
    reader.onabort = () => reject(new MediaInsightError('file_read_failed'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new MediaInsightError('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

function validatedTags(value: unknown): ImageInsight[] | undefined {
  if (!Array.isArray(value) || value.length < 3 || value.length > 6) return undefined;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== 'string') return undefined;
    const label = tag.replace(/\s+/g, ' ').trim();
    if (!label || label.length > 30 || seen.has(label)) return undefined;
    seen.add(label);
    labels.push(label);
  }
  return labels.map((label) => ({ label }));
}

/** The server summary is intentionally discarded: only confirmed, bounded tags leave this service. */
export function parseMediaInsightResponse(value: unknown): ImageInsight[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as { insight?: unknown; meta?: unknown };
  if (!payload.insight || typeof payload.insight !== 'object' || Array.isArray(payload.insight)) return undefined;
  const insight = payload.insight as { summary?: unknown; tags?: unknown };
  // Require the full server contract, while deliberately never returning summary.
  if (typeof insight.summary !== 'string' || !insight.summary.trim() || insight.summary.length > 240) return undefined;
  return validatedTags(insight.tags);
}

export type MediaInsightClientOptions = {
  fetcher?: typeof fetch;
  readAsDataUrl?: (file: File) => Promise<string>;
  connection?: ConnectionSettings;
};

async function requestInsight(body: { imageDataUrl?: string; imageUrl?: string; description?: string }, fetcher: typeof fetch, connection?: ConnectionSettings): Promise<ImageInsight[]> {
  try {
    const response = await fetcher(apiUrl('/api/media-insight'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(connection ? connectionHeaders(connection, 'vision') : {}) }, body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    const tags = response.ok ? parseMediaInsightResponse(payload) : undefined;
    if (!tags) {
      const code = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { error?: { code?: unknown } }).error?.code
        : undefined;
      throw new MediaInsightError(response.ok ? 'invalid_response' : code === 'upstream_timeout' ? 'service_timeout' : 'service_unavailable');
    }
    return tags;
  } catch (error) {
    if (error instanceof MediaInsightError) throw error;
    throw new MediaInsightError('service_unavailable');
  }
}

/**
 * Sends only a user-authorized image and optional user-authored description.
 * It neither persists the file nor returns the service's free-form summary.
 */
export async function analyzeAuthorizedImage(file: File, description: string, options: MediaInsightClientOptions = {}): Promise<ImageInsight[]> {
  const validationError = validateImageForAnalysis(file);
  if (validationError) throw new MediaInsightError(validationError);

  const readAsDataUrl = options.readAsDataUrl ?? readImageAsDataUrl;
  const fetcher = options.fetcher ?? globalThis.fetch;
  let imageDataUrl: string;
  try {
    imageDataUrl = await readAsDataUrl(file);
  } catch (error) {
    if (error instanceof MediaInsightError) throw error;
    throw new MediaInsightError('file_read_failed');
  }

  return requestInsight({ imageDataUrl, ...(description.trim() ? { description: description.trim().slice(0, MAX_DESCRIPTION_LENGTH) } : {}) }, fetcher, options.connection);
}

/** A pasted link is sent to the provider only after the person explicitly asks
 * for analysis. URL validation remains server-side so the browser never needs
 * to decide whether an address is safe to relay. */
export async function analyzeAuthorizedImageUrl(imageUrl: string, description: string, fetcher: typeof fetch = globalThis.fetch, connection?: ConnectionSettings): Promise<ImageInsight[]> {
  const url = imageUrl.trim();
  if (!/^https:\/\//i.test(url)) throw new MediaInsightError('unsupported_image');
  return requestInsight({ imageUrl: url, ...(description.trim() ? { description: description.trim().slice(0, MAX_DESCRIPTION_LENGTH) } : {}) }, fetcher, connection);
}
