import { describe, expect, it } from 'vitest';
import { formatDuration, localMediaSummary, normalizeImageInsights, validateLocalMedia, type LocalMedia } from '../hooks/useLocalMedia';

const image = new File(['image'], 'dusk.webp', { type: 'image/webp' });
const audio = new File(['audio'], 'private-trip/waves.m4a', { type: 'audio/mp4' });

describe('local multimodal media contract', () => {
  it('accepts specified local formats and rejects unrelated files', () => {
    expect(validateLocalMedia(image, 'image')).toBeNull();
    expect(validateLocalMedia(audio, 'audio')).toBeNull();
    expect(validateLocalMedia(new File(['x'], 'note.pdf', { type: 'application/pdf' }), 'image')).toContain('JPG');
  });

  it('enforces the image and audio size limits', () => {
    expect(validateLocalMedia(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), 'image')).toContain('超过');
    expect(validateLocalMedia(new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'large.wav', { type: 'audio/wav' }), 'audio')).toContain('超过');
  });

  it('sends only user text and confirmed structured image insights, never names, paths, file data, or object URLs', () => {
    const media: LocalMedia[] = [
      { kind: 'image', file: image, url: 'blob:private-image' },
      { kind: 'audio', file: audio, url: 'blob:private-audio', durationSeconds: 73 },
    ];
    const summary = localMediaSummary(media, '我想去安静、有海风的地方', [{ label: '暮色海岸' }]);
    expect(summary).toContain('安静');
    expect(summary).toContain('暮色海岸');
    expect(summary).not.toContain('dusk.webp');
    expect(summary).not.toContain('private-trip/waves.m4a');
    expect(summary).not.toContain('/Users/mac/private/dusk.webp');
    expect(summary).not.toContain('blob:');
    expect(summary).not.toContain('本地图片');
    expect(summary).not.toContain('本地音频');
  });

  it('normalizes only bounded structured insight labels before they can enter a summary', () => {
    expect(normalizeImageInsights([{ label: '  慢节奏  ' }, { label: '' }, { label: 42 }, '海边'])).toEqual([{ label: '慢节奏' }]);
  });

  it('formats valid audio durations and keeps unknown duration transparent', () => {
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration()).toBe('正在读取时长…');
  });
});
