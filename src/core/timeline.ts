import { normalizeDate } from "./dates";
import { normalizeAdcode, provinceNameOf, cityNameOf } from "./regions";

export interface TimelineItem {
  id: string;
  filePath: string;
  title: string;
  placeId: string;
  placeName: string;
  city?: string;
  province?: string;
  tags: string[];
  visitedStart?: string;
  visitedEnd?: string;
  date?: string;
  pinned: boolean;
  cover?: string;
  excerpt: string;
  mtime: number;
}

export interface TimelineFilter {
  city?: string;
  tag?: string;
  query?: string;
  pinnedOnly?: boolean;
}

function timestampOf(item: TimelineItem): number {
  const date = normalizeDate(item.visitedStart ?? item.date);
  if (date) {
    const parsed = Date.parse(`${date}T00:00:00`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return item.mtime;
}

/** Pinned first, then travel date descending, then title. */
export function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const delta = timestampOf(b) - timestampOf(a);
    if (delta !== 0) return delta;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

export function filterTimeline(
  items: TimelineItem[],
  filter: TimelineFilter
): TimelineItem[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (filter.pinnedOnly && !item.pinned) return false;
    if (filter.city && item.city !== filter.city) return false;
    if (filter.tag && !item.tags.includes(filter.tag)) return false;
    if (query) {
      const haystack = [item.title, item.placeName, item.excerpt, ...item.tags]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function timelineCities(items: TimelineItem[]): string[] {
  const cities = new Set<string>();
  for (const item of items) {
    if (item.city) cities.add(item.city);
  }
  return Array.from(cities).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function timelineTags(items: TimelineItem[]): string[] {
  const tags = new Set<string>();
  for (const item of items) {
    for (const tag of item.tags) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function decorateTimelineItem(input: {
  id: string;
  filePath: string;
  title: string;
  placeId: string;
  placeName?: string;
  adcode?: string;
  tags: string[];
  visitedStart?: string;
  visitedEnd?: string;
  date?: string;
  pinned: boolean;
  cover?: string;
  excerpt: string;
  mtime: number;
}): TimelineItem {
  const adcode = normalizeAdcode(input.adcode);
  return {
    id: input.id,
    filePath: input.filePath,
    title: input.title,
    placeId: input.placeId,
    placeName: input.placeName ?? input.title,
    city: adcode ? cityNameOf(adcode) : undefined,
    province: adcode ? provinceNameOf(adcode) : undefined,
    tags: input.tags,
    visitedStart: normalizeDate(input.visitedStart) ?? undefined,
    visitedEnd: normalizeDate(input.visitedEnd) ?? undefined,
    date: normalizeDate(input.date) ?? undefined,
    pinned: input.pinned,
    cover: input.cover,
    excerpt: input.excerpt,
    mtime: input.mtime,
  };
}
