import { useState } from 'react';
import { CloudSun, RefreshCw } from 'lucide-react';
import type { Destination } from '../types';
import { getWeatherForecast, type WeatherEvidence, type WeatherForecast } from '../services/weather';

function weatherLabel(code: number): string {
  if (code === 0) return '晴朗';
  if (code <= 3) return '多云';
  if (code <= 48) return '有雾';
  if (code <= 67) return '有雨';
  if (code <= 77) return '降雪';
  if (code <= 82) return '阵雨';
  return '雷雨';
}

function localIsoDate(): string { return new Date().toISOString().slice(0, 10); }

export default function WeatherCheck({ destination, onEvidenceChange }: { destination: Destination; onEvidenceChange?: (evidence?: WeatherEvidence) => void }) {
  const [date, setDate] = useState(localIsoDate);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [forecast, setForecast] = useState<WeatherForecast>();
  const check = async () => {
    setState('loading');
    try {
      const nextForecast = await getWeatherForecast(destination.coordinates, date);
      setForecast(nextForecast);
      onEvidenceChange?.({ forecast: nextForecast, checkedAt: new Date().toISOString() });
      setState('success');
    } catch { setForecast(undefined); onEvidenceChange?.(undefined); setState('error'); }
  };
  return <section className="weather-check" aria-labelledby="weather-check-title">
    <div><span className="section-kicker">WEATHER CHECK · ON DEMAND</span><h3 id="weather-check-title">把天气留给出发前</h3><p>选择在{destination.city}停留的日期后查询。预报会更新，不替代气象预警或出行安全判断。</p></div>
    <div className="weather-check__controls"><label>日期<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setForecast(undefined); onEvidenceChange?.(undefined); setState('idle'); }} /></label><button type="button" onClick={() => void check()} disabled={!date || state === 'loading'}>{state === 'loading' ? <RefreshCw className="spin" size={14} /> : <CloudSun size={14} />}{state === 'loading' ? '正在查询…' : '查询天气'}</button></div>
    {state === 'error' && <p className="weather-check__error" role="alert">所选日期暂时没有可用天气预报；请调整日期或在临近出发时重试。</p>}
    {state === 'success' && forecast && <p className="weather-check__result" aria-live="polite"><b>{forecast.date} · {weatherLabel(forecast.weatherCode)}</b><span>{Math.round(forecast.minC)}–{Math.round(forecast.maxC)}°C · 降水概率最高 {Math.round(forecast.precipitationProbabilityMax)}% · 最大风速 {Math.round(forecast.windSpeedMax)} km/h</span><small>来源：Open-Meteo · 查询时间以本次请求为准</small></p>}
  </section>;
}
