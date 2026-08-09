export type Status = 'idle' | 'interpreting' | 'reviewing-vibe' | 'exploring' | 'showing-results' | 'refining' | 'showing-detail' | 'empty' | 'error';
export type Role = 'best-match' | 'unexpected' | 'easy-to-reach';
export type Scenario = 'harbor' | 'summer' | 'domestic';

export type VibeProfile = {
  summary: string;
  emotions: { label: string; score: number }[];
  environments: string[];
  pace: string;
  socialDensity: string;
  climate: string;
  constraints: string[];
};

export type GeoPoint = [longitude: number, latitude: number];
export type TravelDataStatus = 'static-editorial-demo' | 'agent-generated-unverified';
export type TravelMode = 'walk' | 'bike' | 'public-transit' | 'drive' | 'taxi';
export type PoiCategory = 'viewpoint' | 'walk' | 'neighborhood' | 'market' | 'food' | 'tea' | 'cafe' | 'museum' | 'temple' | 'beach' | 'harbor' | 'village' | 'park' | 'hot-spring' | 'transit';

/**
 * A provenance label is deliberately required for every POI. This MVP only
 * ships editor-curated example data; it never represents opening hours,
 * routing, or availability as live facts.
 */
export type TravelDataSource = {
  label: string;
  url: string;
  status: TravelDataStatus;
  updatedAt: string;
  note: string;
};

export type TravelPoi = {
  id: string;
  name: string;
  category: PoiCategory;
  coordinates: GeoPoint;
  stayMinutes: number;
  whyItFits: string;
  operatingRisk: string;
  source: TravelDataSource;
};

export type TravelLeg = {
  id: string;
  fromPoiId: string;
  toPoiId: string;
  mode: TravelMode;
  distanceKm: number;
  durationMinutes: number;
  navigationUrl: string;
  note: string;
};

export type DayPlan = {
  day: number;
  theme: string;
  intro: string;
  /** Retained for the current detail UI; derived from the executable POI plan. */
  moments: string[];
  pois: TravelPoi[];
  travelLegs: TravelLeg[];
  dataStatus: TravelDataStatus;
  lastUpdated: string;
};
export type Destination = {
  id: string; city: string; region: string; country: string; role: Role; roleLabel: string;
  matchScore: number; tagline: string; atmosphere: string[]; reasons: string[]; tradeoff: string;
  days: number; tripDayOptions: Array<2 | 3 | 4>; budget: string; season: string; image: string; coordinates: [number, number];
  /** The itinerary selected by the current UI. */
  itinerary: DayPlan[];
  /** Domestic MVP supports explicit 2–4 day plan variants without implying live routing. */
  itineraryVariants?: Partial<Record<2 | 3 | 4, DayPlan[]>>;
  reminder: string; alternative: string;
};
