const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

export interface LngLat {
  lng: number;
  lat: number;
}

export function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let value =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  value += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return value;
}

function transformLng(x: number, y: number): number {
  let value =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  value += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return value;
}

function delta(lng: number, lat: number): LngLat {
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: dLng, lat: dLat };
}

/** WGS-84 (GPS, EXIF, GPX) -> GCJ-02 (AMap). No-op outside mainland China. */
export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error("坐标不是有效数字");
  }
  if (outOfChina(lng, lat)) return { lng, lat };
  const d = delta(lng, lat);
  return { lng: lng + d.lng, lat: lat + d.lat };
}

/** GCJ-02 -> WGS-84, iterated to invert the public transform. */
export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error("坐标不是有效数字");
  }
  if (outOfChina(lng, lat)) return { lng, lat };
  let current: LngLat = { lng, lat };
  for (let i = 0; i < 3; i++) {
    const d = delta(current.lng, current.lat);
    current = { lng: lng - d.lng, lat: lat - d.lat };
  }
  return current;
}

export function formatCoordinate(value: number, digits = 6): string {
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/** AMap returns `"lng,lat"`. */
export function parseAmapLocation(value: string | undefined | null): LngLat | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || !parts.every((part) => Number.isFinite(part))) return null;
  const [lng, lat] = parts;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}
