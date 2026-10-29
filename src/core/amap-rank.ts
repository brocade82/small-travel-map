import type { AmapPoi, AmapSuggestion } from "../types";

const NOISE_NAME =
  /(停车场|停车点|停车楼|停车库|售票处|售票点|乘车点|直通车|连接线|商业街|购物|入口|出口|西北门|东南门|东北门|西南门|正门|侧门|大门|地铁站|公交站|公交车站|商店|便利店|超市|百货|文创|纪念品|礼品店|餐厅|饭馆|饭店|酒店|宾馆|客栈|民宿|厕所|卫生间|游客中心|服务中心|办公室|管理处|管理所)/;

const NOISE_TYPE_PREFIXES = ["05", "06", "07", "10", "15"];

const MAIN_POI_NAME = /(风景名胜区|博物院|博物馆|景区|遗址|古城|古镇|公园|寺|塔|湖|山)$/;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s·•・\-—–_/\\()（）【】[\]]/g, "");
}

function typeCodes(poi: AmapPoi | AmapSuggestion): string[] {
  return (poi.typecode ?? "").split("|").filter(Boolean);
}

function isNoiseName(name: string, query: string): boolean {
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(name);
  if (!normalizedName) return true;
  if (normalizedName === normalizedQuery) return false;
  return NOISE_NAME.test(name);
}

function isNoiseType(poi: AmapPoi | AmapSuggestion): boolean {
  return typeCodes(poi).some((code) =>
    NOISE_TYPE_PREFIXES.some((prefix) => code.startsWith(prefix))
  );
}

function looksScenic(code: string): number {
  if (code === "110202") return 60;
  if (code.startsWith("1102")) return 30;
  if (code.startsWith("1101")) return 25;
  if (code.startsWith("1100")) return 15;
  if (code.startsWith("1401")) return 30;
  if (code.startsWith("1402") || code.startsWith("1403")) return 25;
  if (code.startsWith("1905")) return 15;
  return 0;
}

function scenicScore(poi: AmapPoi | AmapSuggestion): number {
  return Math.max(0, ...typeCodes(poi).map(looksScenic));
}

function cityScore(poi: AmapPoi, city?: string): number {
  if (!city) return 0;
  const target = normalize(city).replace(/市$/, "");
  const cityName = normalize(poi.cityname ?? "").replace(/市$/, "");
  if (!target || !cityName) return 0;
  return cityName.includes(target) || target.includes(cityName) ? 12 : 0;
}

function splitSubPoi(name: string): { parentName: string; suffix: string } | null {
  const match = name.match(/^(.+?)[-·•](.+)$/);
  if (!match) return null;
  return { parentName: match[1].trim(), suffix: match[2].trim() };
}

/**
 * Local relevance ranking for AMap search results. AMap's keyword search is
 * broad: it returns sub-spots ("故宫博物院-午门"), car parks, souvenir shops
 * and offices under scenic type codes. This ranks the main POI first, marks
 * sub-spots, and removes obvious noise.
 */
export function rankPois(
  pois: AmapPoi[],
  query: string,
  city?: string
): AmapPoi[] {
  const normalizedQuery = normalize(query);
  const seen = new Set<string>();
  const cleaned: AmapPoi[] = [];

  for (const poi of pois) {
    if (!poi.name || !poi.id) continue;
    if (isNoiseName(poi.name, query)) continue;
    if (isNoiseType(poi)) continue;
    const key = poi.id || `${normalize(poi.name)}|${poi.adcode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ ...poi });
  }

  const parentNames = new Set<string>();
  for (const poi of cleaned) {
    const split = splitSubPoi(poi.name);
    if (split) parentNames.add(normalize(split.parentName));
  }

  const ranked = cleaned.map((poi) => {
    const split = splitSubPoi(poi.name);
    const parentName = split && parentNames.has(normalize(split.parentName))
      ? split.parentName
      : undefined;
    const name = normalize(poi.name);
    let score = 0;
    if (normalizedQuery && name === normalizedQuery) score += 200;
    else if (normalizedQuery && name.startsWith(normalizedQuery)) score += 80;
    else if (normalizedQuery && name.includes(normalizedQuery)) score += 40;
    score += scenicScore(poi);
    score += cityScore(poi, city);
    if (MAIN_POI_NAME.test(poi.name)) score += 30;
    if (poi.location) score += 8;
    if (parentName) score -= 30;
    return {
      ...poi,
      isSubPoi: Boolean(parentName),
      parentName,
      _score: score,
    };
  });

  ranked.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

  return ranked.map(({ _score, ...poi }) => poi);
}

/** Removes parking/mall/office noise from input tips. */
export function filterSuggestions(
  suggestions: AmapSuggestion[],
  query: string
): AmapSuggestion[] {
  const seen = new Set<string>();
  const result: AmapSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (!suggestion.name) continue;
    if (isNoiseName(suggestion.name, query)) continue;
    if (isNoiseType(suggestion)) continue;
    const key = `${normalize(suggestion.name)}|${suggestion.adcode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}

/** True when the query targets the sub-spot's own suffix, e.g. 断桥 -> 断桥残雪. */
export function queryMatchesSubSuffix(poi: AmapPoi, query: string): boolean {
  if (!poi.isSubPoi || !poi.parentName) return true;
  const suffix = poi.name.slice(poi.parentName.length + 1);
  return normalize(suffix).includes(normalize(query));
}
