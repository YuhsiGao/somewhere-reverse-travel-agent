import type { GeoPoint } from '../types';
import { apiUrl } from './api-url';

export type WeatherForecast = {
  date: string;
  weatherCode: number;
  minC: number;
  maxC: number;
  precipitationProbabilityMax: number;
  windSpeedMax: number;
};

/** A local record of an explicit user-triggered forecast query. */
export type WeatherEvidence = {
  forecast: WeatherForecast;
  checkedAt: string;
};

/** Forecasts are volatile; a local query record is only exportable for a short window. */
export const WEATHER_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

export function isWeatherEvidenceFresh(evidence: WeatherEvidence | undefined, now: Date = new Date()): evidence is WeatherEvidence {
  if (!evidence || Number.isNaN(Date.parse(evidence.checkedAt))) return false;
  const age = now.getTime() - Date.parse(evidence.checkedAt);
  return age >= 0 && age <= WEATHER_EVIDENCE_MAX_AGE_MS;
}

export class WeatherForecastError extends Error {
  constructor() {
    super('所选日期暂时没有可用天气预报。');
    this.name = 'WeatherForecastError';
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export function parseWeatherResponse(value: unknown): WeatherForecast | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as { forecast?: unknown; meta?: unknown };
  if (!payload.forecast || !payload.meta || typeof payload.forecast !== 'object' || typeof payload.meta !== 'object') return undefined;
  const forecast = payload.forecast as Record<string, unknown>;
  const meta = payload.meta as Record<string, unknown>;
  if (!isDate(forecast.date) || !isNumber(forecast.weatherCode) || !isNumber(forecast.minC) || !isNumber(forecast.maxC)
    || !isNumber(forecast.precipitationProbabilityMax) || forecast.precipitationProbabilityMax < 0 || forecast.precipitationProbabilityMax > 100
    || !isNumber(forecast.windSpeedMax) || forecast.windSpeedMax < 0
    || meta.provider !== 'open-meteo' || typeof meta.updatedAt !== 'string' || Number.isNaN(Date.parse(meta.updatedAt)) || typeof meta.requestId !== 'string' || !meta.requestId) return undefined;
  return forecast as WeatherForecast;
}

export async function getWeatherForecast(coordinates: GeoPoint, date: string, fetcher: typeof fetch = globalThis.fetch): Promise<WeatherForecast> {
  try {
    const response = await fetcher(apiUrl('/api/weather'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates, date }) });
    const value: unknown = await response.json().catch(() => null);
    const forecast = response.ok ? parseWeatherResponse(value) : undefined;
    if (!forecast) throw new WeatherForecastError();
    return forecast;
  } catch (error) {
    if (error instanceof WeatherForecastError) throw error;
    throw new WeatherForecastError();
  }
}
