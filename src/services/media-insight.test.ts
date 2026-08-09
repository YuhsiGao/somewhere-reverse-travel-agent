import { describe, expect, it, vi } from 'vitest';
import { analyzeAuthorizedImage, analyzeAuthorizedImageUrl, MediaInsightError, parseMediaInsightResponse, validateImageForAnalysis } from './media-insight';

const image = { type: 'image/png', size: 1024 } as File;
const response = { insight: { summary: '有海风的安静旅行氛围', tags: ['海风', '慢节奏', '低刺激'] }, meta: { mode: 'live' } };

describe('authorized media insight client', () => {
  it('rejects unsupported and over-limit images before reading or network requests', async () => {
    expect(validateImageForAnalysis({ type: 'image/gif', size: 4 } as File)).toBe('unsupported_image');
    expect(validateImageForAnalysis({ type: 'image/jpeg', size: 1024 * 1024 + 1 } as File)).toBe('image_too_large');
    const fetcher = vi.fn();
    await expect(analyzeAuthorizedImage({ type: 'image/jpeg', size: 1024 * 1024 + 1 } as File, '', { fetcher, readAsDataUrl: vi.fn() })).rejects.toMatchObject({ code: 'image_too_large' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts only the in-memory data URL and bounded user description, returning tags not summary', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    const tags = await analyzeAuthorizedImage(image, `  想慢一点  ${'x'.repeat(1200)}`, { fetcher, readAsDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=' });
    expect(tags).toEqual([{ label: '海风' }, { label: '慢节奏' }, { label: '低刺激' }]);
    expect(JSON.stringify(tags)).not.toContain('summary');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request).toEqual({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', description: expect.any(String) });
    expect(request.description).toHaveLength(1000);
  });

  it('requires the strict response shape and never exposes raw server failures', async () => {
    expect(parseMediaInsightResponse({ insight: { summary: 'ok', tags: ['a', 'b'] } })).toBeUndefined();
    expect(parseMediaInsightResponse({ insight: { summary: '', tags: ['a', 'b', 'c'] } })).toBeUndefined();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'secret upstream error' } }), { status: 502 }));
    await expect(analyzeAuthorizedImage(image, '', { fetcher, readAsDataUrl: async () => 'data:image/png;base64,x' })).rejects.toEqual(expect.any(MediaInsightError));
    await expect(analyzeAuthorizedImage(image, '', { fetcher, readAsDataUrl: async () => 'data:image/png;base64,x' })).rejects.not.toThrow('secret upstream error');
  });

  it('preserves the safe distinction between upstream timeout and invalid links', async () => {
    const timeoutFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'upstream_timeout' } }), { status: 504 }));
    await expect(analyzeAuthorizedImageUrl('https://images.example.com/inspiration.jpg', '', timeoutFetcher)).rejects.toMatchObject({ code: 'service_timeout' });
    await expect(analyzeAuthorizedImageUrl('http://images.example.com/inspiration.jpg', '', timeoutFetcher)).rejects.toMatchObject({ code: 'unsupported_image' });
    expect(timeoutFetcher).toHaveBeenCalledTimes(1);
  });
});
