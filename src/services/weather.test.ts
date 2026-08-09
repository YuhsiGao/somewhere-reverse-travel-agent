import { describe, expect, it, vi } from 'vitest';
import { getWeatherForecast, isWeatherEvidenceFresh, parseWeatherResponse, WeatherForecastError } from './weather';

const valid = { forecast: { date: '2026-08-04', weatherCode: 3, minC: 21, maxC: 30, precipitationProbabilityMax: 40, windSpeedMax: 15 }, meta: { provider: 'open-meteo', updatedAt: '2026-08-04T00:00:00.000Z', requestId: 'weather-1' } };
describe('weather client', () => {
  it('validates the small forecast contract', () => {
    expect(parseWeatherResponse(valid)).toMatchObject({ maxC: 30 });
    expect(parseWeatherResponse({ ...valid, forecast: { ...valid.forecast, precipitationProbabilityMax: 101 } })).toBeUndefined();
  });
  it('only sends coordinate and selected date', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => valid });
    await expect(getWeatherForecast([120, 30], '2026-08-04', fetcher)).resolves.toMatchObject({ minC: 21 });
    expect(fetcher).toHaveBeenCalledWith('/api/weather', expect.objectContaining({ body: JSON.stringify({ coordinates: [120, 30], date: '2026-08-04' }) }));
    await expect(getWeatherForecast([120, 30], '2026-08-04', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))).rejects.toBeInstanceOf(WeatherForecastError);
  });
  it('limits exported weather evidence to a short verification window', () => {
    const evidence = { forecast: valid.forecast, checkedAt: '2026-08-04T12:00:00.000Z' };
    expect(isWeatherEvidenceFresh(evidence, new Date('2026-08-04T12:14:59.000Z'))).toBe(true);
    expect(isWeatherEvidenceFresh(evidence, new Date('2026-08-04T12:15:01.000Z'))).toBe(false);
  });
});
