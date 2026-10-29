import {
  DIRECT_COUNTY_ADCODES,
  DISTRICT_ADCODES,
  MUNICIPALITY_ADCODES,
  REGION_NODES,
  UNSUPPORTED_PROVINCE_ADCODES,
  type RegionNode,
} from "../data/regions.generated";

export interface AdcodeRollup {
  /** Six digit province code. */
  province: string | null;
  /** Six digit prefecture code; null for municipalities are re-used as province. */
  city: string | null;
  /** Six digit county/district code when the adcode points at that level. */
  county: string | null;
  /** The adcode was understood (province/city/district table hit). */
  known: boolean;
  /** Hong Kong, Macau or Taiwan: deliberately not lit in the first version. */
  unsupported: boolean;
}

const NODE_BY_CODE = new Map<string, RegionNode>(REGION_NODES.map((node) => [node.adcode, node]));
const CITY_BY_CODE = new Map<string, RegionNode>(
  REGION_NODES.filter((node) => node.level === "city").map((node) => [node.adcode, node])
);
const PROVINCE_BY_CODE = new Map<string, RegionNode>(
  REGION_NODES.filter((node) => node.level === "province").map((node) => [node.adcode, node])
);

/**
 * Accepts 2, 4 or 6 digit forms (`33`, `3301`, `330106`) and returns a six
 * digit adcode. Returns null when the value cannot be interpreted.
 */
export function normalizeAdcode(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(Math.trunc(value));
  }
  if (typeof value !== "string") return null;
  const digits = value.trim().split(".")[0].replace(/\D/g, "");
  if (digits.length === 2) return `${digits}0000`;
  if (digits.length === 4) return `${digits}00`;
  if (digits.length === 6) return digits;
  return null;
}

export function isMunicipality(adcode: string | null | undefined): boolean {
  const normalized = normalizeAdcode(adcode);
  return normalized !== null && MUNICIPALITY_ADCODES.has(normalized);
}

export function isDirectCounty(adcode: string | null | undefined): boolean {
  const normalized = normalizeAdcode(adcode);
  return normalized !== null && DIRECT_COUNTY_ADCODES.has(normalized);
}

export function isUnsupportedRegion(adcode: string | null | undefined): boolean {
  const normalized = normalizeAdcode(adcode);
  if (!normalized) return false;
  return (
    UNSUPPORTED_PROVINCE_ADCODES.has(normalized) ||
    UNSUPPORTED_PROVINCE_ADCODES.has(`${normalized.slice(0, 2)}0000`)
  );
}

/**
 * The lighting algorithm from the design document (§5.1). The explicit
 * exceptions matter: municipalities have no prefecture level, and directly
 * administered counties have no real prefecture.
 */
export function rollup(adcode: string | null | undefined): AdcodeRollup {
  const code = normalizeAdcode(adcode);
  if (!code) {
    return { province: null, city: null, county: null, known: false, unsupported: false };
  }

  const province = `${code.slice(0, 2)}0000`;
  const isProvinceLevel = code.slice(2) === "0000";
  const isCityLevel = !isProvinceLevel && code.slice(4) === "00";

  if (isUnsupportedRegion(code)) {
    return { province, city: null, county: null, known: true, unsupported: true };
  }
  if (MUNICIPALITY_ADCODES.has(province)) {
    return {
      province,
      city: isProvinceLevel ? null : province,
      county: isProvinceLevel ? null : code,
      known: true,
      unsupported: false,
    };
  }
  if (DIRECT_COUNTY_ADCODES.has(code)) {
    return { province, city: null, county: null, known: true, unsupported: false };
  }
  if (isProvinceLevel) {
    return { province, city: null, county: null, known: true, unsupported: false };
  }
  const known = isKnownAdcode(code);
  return {
    province,
    city: isCityLevel ? code : `${code.slice(0, 4)}00`,
    county: isCityLevel ? null : known ? code : null,
    known,
    unsupported: false,
  };
}

export function isKnownAdcode(adcode: string | null | undefined): boolean {
  const code = normalizeAdcode(adcode);
  if (!code) return false;
  return NODE_BY_CODE.has(code) || DISTRICT_ADCODES.has(code);
}

export function getProvince(adcode: string | null | undefined): RegionNode | undefined {
  const code = normalizeAdcode(adcode);
  if (!code) return undefined;
  return PROVINCE_BY_CODE.get(`${code.slice(0, 2)}0000`);
}

export function getCity(adcode: string | null | undefined): RegionNode | undefined {
  const code = normalizeAdcode(adcode);
  if (!code) return undefined;
  const rolled = rollup(code);
  if (!rolled.city) return undefined;
  const city = CITY_BY_CODE.get(rolled.city);
  if (city) return city;
  // Municipalities have no separate prefecture node: use the province node.
  return PROVINCE_BY_CODE.get(rolled.city);
}

export function provinceNameOf(adcode: string | null | undefined): string | undefined {
  return getProvince(adcode)?.name;
}

export function cityNameOf(adcode: string | null | undefined): string | undefined {
  return getCity(adcode)?.name;
}

export function provinceCodeOf(adcode: string | null | undefined): string | null {
  return rollup(adcode).province;
}

export function citiesOfProvince(provinceCode: string): RegionNode[] {
  return REGION_NODES.filter(
    (node) => node.level === "city" && node.parent === normalizeAdcode(provinceCode)
  );
}

export function allProvinces(): RegionNode[] {
  return REGION_NODES.filter((node) => node.level === "province");
}

export function allCities(): RegionNode[] {
  return REGION_NODES.filter((node) => node.level === "city");
}

export function shortRegionName(name: string): string {
  return name
    .replace(/(省|市|特别行政区|自治区|自治州|地区|盟)$/u, "")
    .replace(/(壮族|回族|维吾尔|藏族|蒙古族|朝鲜族|土家族|苗族|侗族|彝族|哈尼族|白族|傣族|傈僳族|景颇族|布依族|瑶族|黎族|畲族|满族|哈萨克|柯尔克孜|羌族)$/u, "");
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shortA = shortRegionName(a);
  const shortB = shortRegionName(b);
  return shortA === shortB || a.startsWith(shortB) || b.startsWith(shortA);
}

export function findProvinceByName(name: string): RegionNode | undefined {
  return allProvinces().find((node) => namesMatch(node.name, name));
}

export function findCityByName(
  name: string,
  provinceCode?: string | null
): RegionNode | undefined {
  const pool = provinceCode
    ? allCities().filter((node) => node.parent === normalizeAdcode(provinceCode))
    : allCities();
  return pool.find((node) => namesMatch(node.name, name));
}

/** Best-effort adcode for imported notes. City wins when both are supplied. */
export function adcodeFromNames(
  provinceName?: string,
  cityName?: string
): string | null {
  const province = provinceName ? findProvinceByName(provinceName) : undefined;
  if (cityName) {
    const city = findCityByName(cityName, province?.adcode);
    if (city) return city.adcode;
    if (province) return province.adcode;
  }
  return province?.adcode ?? null;
}

/** Human readable `浙江省 / 杭州市 / 西湖区`. Missing parts are skipped. */
export function formatRegionPath(
  province?: string,
  city?: string,
  district?: string
): string {
  return [province, city, district].filter((part) => Boolean(part && part.trim())).join(" / ");
}
