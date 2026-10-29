import type {
  LegacyRecord,
  LogFrontmatter,
  LogRecord,
  PlaceFrontmatter,
  PlaceRecord,
  TripFrontmatter,
  TripRecord,
} from "../types";
import { basenameWithoutExtension } from "../core/text";
import { normalizeAdcode } from "../core/regions";
import { normalizeDate } from "../core/dates";
import { toArray } from "../core/text";

type Frontmatter = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function coordinate(value: unknown, min: number, max: number): number | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined || parsed < min || parsed > max) return undefined;
  return parsed;
}

export function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "是"].includes(normalized)) return true;
    if (["false", "no", "0", "否"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

export function titleFromPath(filePath: string): string {
  const base = basenameWithoutExtension(filePath);
  return base.replace(/^\d{4}[-_.]?\d{2}[-_.]?\d{2}[-_\s]*/, "").trim() || base;
}

export function parsePlace(
  filePath: string,
  frontmatter: Frontmatter,
  mtime: number
): PlaceRecord | null {
  const id = stringValue(frontmatter.id);
  if (!id) return null;
  const name =
    stringValue(frontmatter.name) ?? basenameWithoutExtension(filePath) ?? "未命名地点";
  return {
    kind: "place",
    id,
    filePath,
    name,
    aliases: toArray(frontmatter.aliases),
    amapPoiId: stringValue(frontmatter.amap_poi_id),
    province: stringValue(frontmatter.province),
    city: stringValue(frontmatter.city),
    district: stringValue(frontmatter.district),
    adcode: normalizeAdcode(frontmatter.adcode) ?? undefined,
    lat: coordinate(frontmatter.lat, -90, 90),
    lng: coordinate(frontmatter.lng, -180, 180),
    coordSource: (stringValue(frontmatter.coord_source) as PlaceRecord["coordSource"]) ?? undefined,
    // A place saved by the plugin is a visited place by default; the design doc
    // allows an explicit wish-list flag, and a journal always counts as a visit.
    visited: booleanValue(frontmatter.visited, true),
    tags: toArray(frontmatter.tags),
    created: normalizeDate(frontmatter.created) ?? undefined,
    updated: normalizeDate(frontmatter.updated) ?? undefined,
    source: stringValue(frontmatter.source),
    mtime,
  };
}

export function parseLog(
  filePath: string,
  frontmatter: Frontmatter,
  mtime: number
): LogRecord | null {
  const id = stringValue(frontmatter.id);
  if (!id) return null;
  return {
    kind: "travel-log",
    id,
    filePath,
    placeId: stringValue(frontmatter.place_id) ?? "",
    placeLink: stringValue(frontmatter.place),
    tripLink: stringValue(frontmatter.trip),
    visitedStart: normalizeDate(frontmatter.visited_start) ?? undefined,
    visitedEnd: normalizeDate(frontmatter.visited_end) ?? undefined,
    date: normalizeDate(frontmatter.date) ?? undefined,
    tags: toArray(frontmatter.tags),
    pinned: booleanValue(frontmatter.pinned, false),
    cover: stringValue(frontmatter.cover),
    created: normalizeDate(frontmatter.created) ?? undefined,
    updated: normalizeDate(frontmatter.updated) ?? undefined,
    source: stringValue(frontmatter.source),
    title: titleFromPath(filePath),
    mtime,
  };
}

export function parseTrip(
  filePath: string,
  frontmatter: Frontmatter,
  mtime: number
): TripRecord | null {
  const id = stringValue(frontmatter.id);
  if (!id) return null;
  return {
    kind: "trip",
    id,
    filePath,
    title:
      stringValue(frontmatter.title) ??
      basenameWithoutExtension(filePath) ??
      "未命名行程",
    start: normalizeDate(frontmatter.start) ?? undefined,
    end: normalizeDate(frontmatter.end) ?? undefined,
    cities: toArray(frontmatter.cities),
    tags: toArray(frontmatter.tags),
    mtime,
  };
}

export function parseLegacy(filePath: string, mtime: number): LegacyRecord {
  return {
    kind: "legacy",
    filePath,
    title: basenameWithoutExtension(filePath),
    mtime,
  };
}

export function isPlaceFrontmatter(value: unknown): value is PlaceFrontmatter {
  return Boolean(value && typeof value === "object" && (value as Frontmatter).kind === "place");
}

export function isLogFrontmatter(value: unknown): value is LogFrontmatter {
  return Boolean(
    value && typeof value === "object" && (value as Frontmatter).kind === "travel-log"
  );
}

export function isTripFrontmatter(value: unknown): value is TripFrontmatter {
  return Boolean(value && typeof value === "object" && (value as Frontmatter).kind === "trip");
}
