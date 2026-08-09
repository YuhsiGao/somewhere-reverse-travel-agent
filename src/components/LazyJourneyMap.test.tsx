import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { JourneyMapLoadingFallback, JourneyMapLoadPrompt, loadJourneyMap } from './LazyJourneyMap';

describe('LazyJourneyMap', () => {
  it('loads the map implementation through a separate async module boundary', async () => {
    const loaded = await loadJourneyMap();

    expect(loaded.default.name).toBe('JourneyMap');
  });

  it('offers an accessible loading fallback while the map module is pending', () => {
    const fallback = JourneyMapLoadingFallback();

    expect(fallback).toMatchObject({
      type: 'section',
      props: expect.objectContaining({
        'aria-busy': 'true',
        'aria-live': 'polite',
        'aria-label': '正在加载交互地图',
      }),
    });
  });

  it('keeps the map behind an explicit, described load action', () => {
    const prompt = JourneyMapLoadPrompt({ onLoad: () => undefined });

    expect(prompt).toMatchObject({
      type: 'section',
      props: expect.objectContaining({ 'aria-label': '交互地图尚未加载' }),
    });

    const element = prompt as ReactElement<{ children: Array<{ props?: Record<string, unknown> }> }>;
    const children = element.props.children as Array<{ props?: Record<string, unknown> }>;
    const legend = children[1];
    const button = (legend.props?.children as Array<{ props?: Record<string, unknown> }>)[1];
    expect(button).toMatchObject({
      type: 'button',
      props: expect.objectContaining({
        type: 'button',
        'aria-describedby': 'journey-map-load-help',
      }),
    });
    expect(children[2]).toMatchObject({
      props: expect.objectContaining({ id: 'journey-map-load-help' }),
    });
  });
});
