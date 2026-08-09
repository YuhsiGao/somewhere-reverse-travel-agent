import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DataEvidencePanel from './DataEvidencePanel';
import type { DayPlan, Destination } from '../types';

const poi = { id: 'poi', name: '测试公园', category: 'park' as const, coordinates: [120, 30] as [number, number], stayMinutes: 30, whyItFits: '测试', operatingRisk: '请确认营业与预约。', source: { label: '静态编辑库 · 测试公园（示例）', url: 'https://example.test/poi', status: 'static-editorial-demo' as const, updatedAt: '2026-08-01', note: '静态示例' } };
const itinerary: DayPlan[] = [{ day: 1, theme: '测试', intro: '测试', moments: [], pois: [poi], travelLegs: [], dataStatus: 'static-editorial-demo', lastUpdated: '2026-08-01' }];
const destination = { id: 'test', city: '测试城', region: '测试区', country: '中国', itinerary } as Destination;

describe('DataEvidencePanel', () => {
  it('renders known and departure-verification regions without claiming live data', () => {
    const html = renderToStaticMarkup(<DataEvidencePanel destination={destination} now={new Date('2026-08-05T00:00:00Z')} staleAfterDays={30} />);
    expect(html).toContain('已知');
    expect(html).toContain('出发前核验');
    expect(html).toContain('静态编辑示例，非实时数据');
    expect(html).toContain('POI 总数');
    expect(html).toContain('https://example.test/poi');
    expect(html).toContain('高风险事项 1 条');
    expect(html).not.toContain('实时数据已核验');
  });
});
