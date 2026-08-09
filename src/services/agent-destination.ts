import type { DayPlan, Destination, Role, TravelDataSource } from '../types';
import type { RecalledDestination } from './remote-agent';

const ROLE_LABEL: Record<Role, string> = {
  'best-match': '最像你描述的地方', unexpected: '更意外的选择', 'easy-to-reach': '更容易抵达的选择',
};

const fallbackImage = 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1200&q=80';

function sourceFor(place: RecalledDestination): TravelDataSource {
  return {
    label: 'Agent 生成的体验草案（未核验）',
    url: `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${place.city} ${place.region}`)}`,
    status: 'agent-generated-unverified',
    updatedAt: '',
    note: '目的地与体验锚点由 AI 本次生成，尚未通过地图、营业、交通、价格或安全数据核验。',
  };
}

/** Converts the small, server-validated recall payload into the existing card,
 * map and detail contract. The outline intentionally uses generic experience
 * anchors rather than pretending that unverified POIs are confirmed. */
export function destinationFromAgent(place: RecalledDestination): Destination {
  const source = sourceFor(place);
  const itinerary: DayPlan[] = place.outline.map((day, index) => ({
    day: index + 1,
    theme: day.theme,
    intro: day.intro,
    moments: [day.anchor],
    pois: [{
      id: `${place.id}-day-${index + 1}-anchor`, name: day.anchor, category: 'neighborhood', coordinates: place.coordinates,
      stayMinutes: 90, whyItFits: '这是 Agent 给出的体验锚点，不是已核验的具体景点或营业地点。',
      operatingRisk: '该体验锚点由 AI 生成，未核验地点存在、营业、预约、票务、天气、道路或安全状态；请在出发前自行确认。', source,
    }],
    travelLegs: [], dataStatus: 'agent-generated-unverified', lastUpdated: '',
  }));
  return {
    id: place.id, city: place.city, region: place.region, country: place.country, role: place.role, roleLabel: ROLE_LABEL[place.role],
    matchScore: place.role === 'best-match' ? 92 : place.role === 'unexpected' ? 86 : 81,
    tagline: place.tagline, atmosphere: place.atmosphere, reasons: place.reasons, tradeoff: place.tradeoff,
    days: itinerary.length, tripDayOptions: [2, 3, 4], budget: place.budgetNote, season: '季节感由 Agent 根据你的描述推断，出发前请核验。',
    image: fallbackImage, coordinates: place.coordinates, itinerary,
    reminder: '本次目的地与体验锚点由 Agent 动态生成，未核验交通、价格、天气、营业、签证或安全。', alternative: place.alternative,
  };
}
