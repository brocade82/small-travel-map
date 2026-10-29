export type TravelKind = "place" | "travel-log" | "trip" | "city" | "overview";

export type CoordinateSystem = "GCJ-02";

export type CoordSource = "amap" | "exif" | "manual";

export interface PlaceFrontmatter {
  kind: "place";
  schema_version: number;
  id: string;
  name: string;
  aliases?: string[];
  amap_poi_id?: string;
  province?: string;
  city?: string;
  district?: string;
  adcode?: string | number;
  lat?: number;
  lng?: number;
  coordinate_system?: CoordinateSystem;
  coord_source?: CoordSource;
  /** false marks a wish-list place; journals still imply a visit. */
  visited?: boolean;
  tags?: string[];
  created?: string;
  updated?: string;
  source?: string;
}

export interface LogFrontmatter {
  kind: "travel-log";
  schema_version: number;
  id: string;
  place_id: string;
  place?: string;
  trip?: string;
  visited_start?: string;
  visited_end?: string;
  date?: string;
  tags?: string[];
  pinned?: boolean;
  cover?: string;
  created?: string;
  updated?: string;
  source?: string;
}

export interface TripFrontmatter {
  kind: "trip";
  schema_version: number;
  id: string;
  title: string;
  start?: string;
  end?: string;
  cities?: string[];
  tags?: string[];
  created?: string;
  updated?: string;
}

export interface PlaceRecord {
  kind: "place";
  id: string;
  filePath: string;
  name: string;
  aliases: string[];
  amapPoiId?: string;
  province?: string;
  city?: string;
  district?: string;
  adcode?: string;
  lat?: number;
  lng?: number;
  coordSource?: CoordSource;
  visited: boolean;
  tags: string[];
  created?: string;
  updated?: string;
  source?: string;
  mtime: number;
}

export interface LogRecord {
  kind: "travel-log";
  id: string;
  filePath: string;
  placeId: string;
  placeLink?: string;
  tripLink?: string;
  visitedStart?: string;
  visitedEnd?: string;
  date?: string;
  tags: string[];
  pinned: boolean;
  cover?: string;
  created?: string;
  updated?: string;
  source?: string;
  title: string;
  mtime: number;
}

export interface TripRecord {
  kind: "trip";
  id: string;
  filePath: string;
  title: string;
  start?: string;
  end?: string;
  cities: string[];
  tags: string[];
  mtime: number;
}

export interface LegacyRecord {
  kind: "legacy";
  filePath: string;
  title: string;
  mtime: number;
}

export type IndexedRecord = PlaceRecord | LogRecord | TripRecord | LegacyRecord;

export interface AmapPoi {
  id: string;
  name: string;
  type?: string;
  typecode?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  adcode?: string | number;
  pcode?: string;
  citycode?: string | number;
  photos?: Array<{ title?: string; url?: string }>;
  biz_ext?: { rating?: string | number };
  tel?: string | string[];
  /** Set by the local ranking layer, not by AMap. */
  isSubPoi?: boolean;
  parentName?: string;
}

export interface AmapSearchResult {
  count: string;
  pois: AmapPoi[];
}

export interface AmapSuggestion {
  id?: string;
  name: string;
  district?: string;
  adcode?: string | number;
  location?: string;
  address?: string | string[];
  typecode?: string;
  cityname?: string;
}

export type MapMode = "auto" | "offline";

export type MediaLinkMode = "absolute" | "relative";

export interface TravelMapSettings {
  baseFolder: string;
  /** Folder outside the vault that holds the user's original photos and videos. */
  mediaRoot: string;
  amapConfigPath: string;
  poiTypes: string;
  sessionSearchLimit: number;
  mapMode: MapMode;
  /** Folder containing the user's own map-pack GeoJSON files. Empty = plugin assets/geo. */
  mapPackDir: string;
  /** Minutes without map interaction before the live map is destroyed; 0 = never. */
  mapIdleMinutes: number;
  /** User-selectable colors for the offline map. */
  mapProvinceColor: string;
  mapCityColor: string;
  mapCountyColor: string;
  mapPlaceColor: string;
  mediaLinkMode: MediaLinkMode;
  ffprobePath: string;
}

export const DEFAULT_SETTINGS: TravelMapSettings = {
  baseFolder: "旅游",
  mediaRoot: "D:\\TravelMedia",
  amapConfigPath: "",
  poiTypes: "110000|140100|140200|140300|190500",
  sessionSearchLimit: 60,
  mapMode: "auto",
  mapPackDir: "",
  mapIdleMinutes: 0,
  mapProvinceColor: "#3b82f6",
  mapCityColor: "#10b981",
  mapCountyColor: "#f59e0b",
  mapPlaceColor: "#ef4444",
  mediaLinkMode: "absolute",
  ffprobePath: "",
};

export interface AmapKeys {
  webKey?: string;
  jsKey?: string;
  securityCode?: string;
}

export type AmapErrorKind = "offline" | "quota" | "key" | "network" | "server";

export class AmapError extends Error {
  readonly kind: AmapErrorKind;
  readonly infocode?: string;
  readonly info?: string;

  constructor(kind: AmapErrorKind, message: string, infocode?: string, info?: string) {
    super(message);
    this.name = "AmapError";
    this.kind = kind;
    this.infocode = infocode;
    this.info = info;
  }
}

export interface QuotaSnapshot {
  day: string;
  month: string;
  dayCount: number;
  monthCount: number;
  sessionCount: number;
  sessionLimit: number;
}
