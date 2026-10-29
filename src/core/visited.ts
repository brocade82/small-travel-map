import { normalizeAdcode, rollup } from "./regions";

export interface VisitPlaceInput {
  id: string;
  name: string;
  adcode?: string | null;
  /** false marks a wish-list place; a journal still counts as a visit. */
  visited: boolean;
  hasJournals: boolean;
  lat?: number;
  lng?: number;
  journalCount?: number;
}

export interface VisitedPlace {
  id: string;
  name: string;
  adcode?: string;
  lat?: number;
  lng?: number;
  journalCount: number;
  province?: string;
  city?: string;
  county?: string;
  provinceName?: string;
  cityName?: string;
}

export interface UnknownAdcodeEntry {
  id: string;
  name: string;
  adcode: string;
}

export interface VisitedState {
  places: VisitedPlace[];
  provinceCounts: Map<string, number>;
  cityCounts: Map<string, number>;
  countyCounts: Map<string, number>;
  unknown: UnknownAdcodeEntry[];
  unsupported: UnknownAdcodeEntry[];
  totalPlaces: number;
  visitedCount: number;
  locatedCount: number;
}

const EMPTY: VisitedState = {
  places: [],
  provinceCounts: new Map(),
  cityCounts: new Map(),
  countyCounts: new Map(),
  unknown: [],
  unsupported: [],
  totalPlaces: 0,
  visitedCount: 0,
  locatedCount: 0,
};

/**
 * Pure lighting calculation: a place lights its province and prefecture when
 * it is marked visited, or when at least one journal references it.
 *
 * Municipality / direct-county / HK-MO-TW exceptions live in `rollup`.
 */
export function computeVisitedState(inputs: VisitPlaceInput[]): VisitedState {
  if (inputs.length === 0) return { ...EMPTY, unknown: [], unsupported: [] };

  const state: VisitedState = {
    places: [],
    provinceCounts: new Map(),
    cityCounts: new Map(),
    countyCounts: new Map(),
    unknown: [],
    unsupported: [],
    totalPlaces: inputs.length,
    visitedCount: 0,
    locatedCount: 0,
  };

  for (const input of inputs) {
    const isVisited = input.visited || input.hasJournals;
    if (!isVisited) continue;

    const adcode = normalizeAdcode(input.adcode);
    const rolled = adcode ? rollup(adcode) : null;
    const place: VisitedPlace = {
      id: input.id,
      name: input.name,
      adcode: adcode ?? undefined,
      lat: input.lat,
      lng: input.lng,
      journalCount: input.journalCount ?? 0,
      province: rolled?.province ?? undefined,
      city: rolled?.city ?? undefined,
      county: rolled?.county ?? undefined,
    };

    if (adcode && rolled) {
      if (rolled.unsupported) {
        state.unsupported.push({ id: input.id, name: input.name, adcode });
      } else if (!rolled.known) {
        state.unknown.push({ id: input.id, name: input.name, adcode });
      } else {
        if (rolled.province) {
          state.provinceCounts.set(
            rolled.province,
            (state.provinceCounts.get(rolled.province) ?? 0) + 1
          );
        }
        if (rolled.city) {
          state.cityCounts.set(rolled.city, (state.cityCounts.get(rolled.city) ?? 0) + 1);
        }
        if (rolled.county) {
          state.countyCounts.set(
            rolled.county,
            (state.countyCounts.get(rolled.county) ?? 0) + 1
          );
        }
      }
    }

    if (
      typeof input.lat === "number" &&
      typeof input.lng === "number" &&
      Number.isFinite(input.lat) &&
      Number.isFinite(input.lng)
    ) {
      state.locatedCount += 1;
    }
    state.places.push(place);
  }

  state.visitedCount = state.places.length;
  return state;
}

export function isPlaceLit(
  state: VisitedState,
  adcode: string | null | undefined
): boolean {
  const code = normalizeAdcode(adcode);
  if (!code) return false;
  const rolled = rollup(code);
  return rolled.province !== null && state.provinceCounts.has(rolled.province);
}
