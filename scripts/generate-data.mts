/**
 * Regenerates src/data/regions.generated.ts and src/data/china-map.generated.ts.
 *
 * Sources:
 *  - Administrative divisions: china-division (MIT), based on 民政部/统计局 data.
 *  - Province outlines and city centres: Alibaba Cloud DataV GeoAtlas
 *    (https://geo.datav.aliyun.com/areas_v3/bound/).
 *
 * The boundary data is bundled for PERSONAL use only. Before publishing the
 * plugin, verify the licence and the map-review requirements that apply in your
 * jurisdiction (the design document calls this out in §5.2).
 *
 * Run with: npm run gen:data
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cacheDir = path.join(root, "scripts", ".data-cache");
const outDir = path.join(root, "src", "data");

const DATAV = "https://geo.datav.aliyun.com/areas_v3/bound";
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 760;
const MAP_PADDING = 16;
const SIMPLIFY_TOLERANCE = 0.02;

type LngLat = [number, number];
type Ring = LngLat[];

interface Feature {
  properties: {
    adcode: number | string;
    name: string;
    level?: string;
    center?: LngLat;
    centroid?: LngLat;
    parent?: { adcode: number | string };
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
}

interface FeatureCollection {
  features: Feature[];
}

interface DivisionProvince {
  code: string;
  name: string;
}

interface DivisionCity {
  code: string;
  name: string;
  provinceCode: string;
}

interface DivisionArea {
  code: string;
  name: string;
  cityCode: string;
  provinceCode: string;
}

function ensureDirs(): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
}

async function fetchJson<T>(name: string, url: string): Promise<T> {
  const file = path.join(cacheDir, name);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
  const text = await response.text();
  const json = JSON.parse(text) as T;
  fs.writeFileSync(file, text, "utf8");
  return json;
}

function readDivision<T>(name: string): T[] {
  return JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "china-division", "dist", name), "utf8")
  ) as T[];
}

function mercatorY(lat: number): number {
  // Degree-like Mercator units so one scale can serve longitude and latitude.
  return (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
}

function ringArea(points: LngLat[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

function pointSegmentDistance(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplifySection(
  points: LngLat[],
  first: number,
  last: number,
  keep: Uint8Array,
  tolerance: number
): void {
  if (last <= first + 1) return;
  let maxDistance = 0;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const distance = pointSegmentDistance(points[i], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance > tolerance && index !== -1) {
    keep[index] = 1;
    simplifySection(points, first, index, keep, tolerance);
    simplifySection(points, index, last, keep, tolerance);
  }
}

function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const isClosed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const points = isClosed ? ring.slice(0, -1) : ring.slice();
  if (points.length <= 3) return ring;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  simplifySection(points, 0, points.length - 1, keep, tolerance);
  const simplified = points.filter((_, i) => keep[i] === 1);
  if (isClosed && simplified.length > 0) simplified.push(simplified[0]);
  return simplified;
}

interface Projected {
  minLng: number;
  maxLng: number;
  mercMin: number;
  mercMax: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function makeProjection(allRings: Ring[]): Projected {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let mercMin = Infinity;
  let mercMax = -Infinity;
  for (const ring of allRings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      const y = mercatorY(lat);
      mercMin = Math.min(mercMin, y);
      mercMax = Math.max(mercMax, y);
    }
  }
  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / (maxLng - minLng),
    (MAP_HEIGHT - MAP_PADDING * 2) / (mercMax - mercMin)
  );
  const offsetX = (MAP_WIDTH - (maxLng - minLng) * scale) / 2;
  const offsetY = (MAP_HEIGHT - (mercMax - mercMin) * scale) / 2;
  return { minLng, maxLng, mercMin, mercMax, scale, offsetX, offsetY };
}

function project(projection: Projected, lng: number, lat: number): [number, number] {
  const x = projection.offsetX + (lng - projection.minLng) * projection.scale;
  const y = projection.offsetY + (projection.mercMax - mercatorY(lat)) * projection.scale;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

function collectRings(feature: Feature): Ring[] {
  if (!feature.geometry) return [];
  const rings: Ring[] = [];
  if (feature.geometry.type === "Polygon") {
    for (const ring of feature.geometry.coordinates as number[][][]) {
      rings.push(ring.map(([lng, lat]) => [lng, lat] as LngLat));
    }
  } else if (feature.geometry.type === "MultiPolygon") {
    for (const polygon of feature.geometry.coordinates as number[][][][]) {
      for (const ring of polygon) {
        rings.push(ring.map(([lng, lat]) => [lng, lat] as LngLat));
      }
    }
  }
  return rings;
}

function ringToPath(projection: Projected, ring: Ring): string {
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(projection, ring[i][0], ring[i][1]);
    parts.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
  }
  return `${parts.join("")}Z`;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function main(): Promise<void> {
  ensureDirs();

  const china = await fetchJson<FeatureCollection>(
    "100000_full.json",
    `${DATAV}/100000_full.json`
  );
  const provinces = readDivision<DivisionProvince>("provinces.json");
  const cities = readDivision<DivisionCity>("cities.json");
  const areas = readDivision<DivisionArea>("areas.json");

  const provinceFeatures = new Map<string, Feature>();
  for (const feature of china.features) {
    const adcode = String(feature.properties.adcode);
    provinceFeatures.set(adcode, feature);
  }

  const provinceName = new Map<string, string>();
  for (const province of provinces) {
    provinceName.set(`${province.code}0000`, province.name);
  }
  provinceName.set("710000", "台湾省");
  provinceName.set("810000", "香港特别行政区");
  provinceName.set("820000", "澳门特别行政区");

  const provinceCodes = Array.from(provinceName.keys()).sort();
  const municipalityCodes = new Set(["110000", "120000", "310000", "500000"]);
  const unsupportedCodes = new Set(["710000", "810000", "820000"]);

  // City centres come from DataV; fetch one file per mainland province.
  const cityCentres = new Map<string, { lat: number; lng: number }>();
  const provincesToFetch = provinceCodes.filter(
    (code) => !municipalityCodes.has(code) && !unsupportedCodes.has(code)
  );
  for (let i = 0; i < provincesToFetch.length; i += 4) {
    const batch = provincesToFetch.slice(i, i + 4);
    await Promise.all(
      batch.map(async (code) => {
        try {
          const collection = await fetchJson<FeatureCollection>(
            `${code}_full.json`,
            `${DATAV}/${code}_full.json`
          );
          for (const feature of collection.features) {
            if (feature.properties.level !== "city") continue;
            const centre = feature.properties.center ?? feature.properties.centroid;
            if (!centre) continue;
            cityCentres.set(String(feature.properties.adcode), {
              lng: centre[0],
              lat: centre[1],
            });
          }
        } catch (error) {
          console.warn(`city centres for ${code} failed: ${(error as Error).message}`);
        }
      })
    );
  }

  // Directly administered county-level divisions: their prefecture code is a
  // placeholder ("省直辖县级行政区划"), so they roll up to the province only.
  const pseudoCityCodes = new Set(
    cities
      .filter((city) => city.name.includes("直辖县级行政区划"))
      .map((city) => `${city.code}00`)
  );
  const directCountyCodes = new Set(
    areas
      .filter((area) => pseudoCityCodes.has(`${area.cityCode}00`))
      .map((area) => area.code)
  );

  const allRings: Ring[] = [];
  const simplifiedByAdcode = new Map<string, Ring[]>();
  for (const [adcode, feature] of provinceFeatures) {
    const rings = collectRings(feature);
    allRings.push(...rings);
    const simplified: Ring[] = [];
    for (const ring of rings) {
      if (ring.length < 4) continue;
      if (ringArea(ring) < 0.0004) continue;
      const candidate = simplifyRing(ring, SIMPLIFY_TOLERANCE);
      if (candidate.length >= 4) simplified.push(candidate);
    }
    simplifiedByAdcode.set(adcode, simplified);
  }
  const projection = makeProjection(allRings);

  const provinceShapes = provinceCodes.map((adcode) => {
    const feature = provinceFeatures.get(adcode);
    const rings = simplifiedByAdcode.get(adcode) ?? [];
    const pathData = rings.map((ring) => ringToPath(projection, ring)).join("");
    const centre = feature?.properties.centroid ?? feature?.properties.center ?? [0, 0];
    const [labelX, labelY] = project(projection, centre[0], centre[1]);
    return {
      adcode,
      name: provinceName.get(adcode) ?? feature?.properties.name ?? adcode,
      path: pathData,
      labelX,
      labelY,
    };
  });

  const cityNodes = cities
    .filter((city) => !city.name.includes("直辖县级行政区划"))
    .filter((city) => !city.name.includes("市辖区") && !city.name.includes("县"))
    .filter((city) => !municipalityCodes.has(`${city.provinceCode}0000`))
    .map((city) => {
      const adcode = `${city.code}00`;
      const centre = cityCentres.get(adcode);
      return {
        adcode,
        name: city.name,
        level: "city" as const,
        parent: `${city.provinceCode}0000`,
        ...(centre ? { lat: centre.lat, lng: centre.lng } : {}),
      };
    })
    .sort((a, b) => a.adcode.localeCompare(b.adcode));

  const provinceNodes = provinceCodes.map((adcode) => {
    const feature = provinceFeatures.get(adcode);
    return {
      adcode,
      name: provinceName.get(adcode) ?? feature?.properties.name ?? adcode,
      level: "province" as const,
      parent: null,
    };
  });

  const regionsFile = `// AUTO-GENERATED by scripts/generate-data.ts. Do not edit by hand.
// Administrative divisions: china-division (MIT).
// Locations: Alibaba Cloud DataV GeoAtlas (GCJ-02), personal use only.

export type RegionLevel = "province" | "city";

export interface RegionNode {
  adcode: string;
  name: string;
  level: RegionLevel;
  parent: string | null;
  lat?: number;
  lng?: number;
}

export const REGION_NODES: RegionNode[] = ${JSON.stringify(
    [...provinceNodes, ...cityNodes],
    null,
    2
  )};

export const MUNICIPALITY_ADCODES = new Set<string>(${JSON.stringify(
    Array.from(municipalityCodes).sort()
  )});

/** Every district/county code, used only to detect typos in the adcode field. */
export const DISTRICT_ADCODES = new Set<string>(${JSON.stringify(
    Array.from(new Set(areas.map((area) => area.code))).sort()
  )});

export const DIRECT_COUNTY_ADCODES = new Set<string>(${JSON.stringify(
    Array.from(directCountyCodes).sort()
  )});

export const UNSUPPORTED_PROVINCE_ADCODES = new Set<string>(${JSON.stringify(
    Array.from(unsupportedCodes).sort()
  )});

export const REGION_DATA_SOURCE =
  "行政区划 china-division (MIT)；边界坐标 DataV GeoAtlas (GCJ-02，个人使用)";
`;

  const mapFile = `// AUTO-GENERATED by scripts/generate-data.ts. Do not edit by hand.
// Province outlines: Alibaba Cloud DataV GeoAtlas. Personal use only; verify the
// licence and map-review rules before redistributing.

export interface ProvinceShape {
  adcode: string;
  name: string;
  path: string;
  labelX: number;
  labelY: number;
}

export const MAP_WIDTH = ${MAP_WIDTH};
export const MAP_HEIGHT = ${MAP_HEIGHT};

export const MAP_PROJECTION = {
  minLng: ${projection.minLng},
  maxLng: ${projection.maxLng},
  mercMin: ${projection.mercMin},
  mercMax: ${projection.mercMax},
  scale: ${projection.scale},
  offsetX: ${projection.offsetX},
  offsetY: ${projection.offsetY},
} as const;

export const PROVINCE_SHAPES: ProvinceShape[] = [
${provinceShapes
  .map(
    (shape) =>
      `  { adcode: "${shape.adcode}", name: "${escapeString(
        shape.name
      )}", labelX: ${shape.labelX}, labelY: ${shape.labelY}, path: "${escapeString(
        shape.path
      )}" },`
  )
  .join("\n")}
];
`;

  fs.writeFileSync(path.join(outDir, "regions.generated.ts"), regionsFile, "utf8");
  fs.writeFileSync(path.join(outDir, "china-map.generated.ts"), mapFile, "utf8");

  console.log(
    `regions: ${provinceNodes.length} provinces, ${cityNodes.length} cities, ` +
      `${directCountyCodes.size} direct counties, ${cityCentres.size} city centres`
  );
  console.log(
    `map: ${provinceShapes.length} shapes, ` +
      `${(mapFile.length / 1024).toFixed(1)} KiB generated`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
