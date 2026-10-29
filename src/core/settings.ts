import { DEFAULT_SETTINGS, type MediaLinkMode, type MapMode, type TravelMapSettings } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readFolder(value: unknown, fallback: string): string {
  const text = readString(value, fallback).replace(/^\/+|\/+$/g, "");
  return text || fallback;
}

function readColor(value: unknown, fallback: string): string {
  const text = readString(value, fallback);
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

/**
 * Only copies known settings fields. If an older data.json contains a
 * `webKey`/`jsKey`/`securityCode` field, it is dropped instead of being kept
 * and written back on the next save.
 */
export function sanitizeSettings(raw: unknown): TravelMapSettings {
  const data = asRecord(raw);
  const result: TravelMapSettings = { ...DEFAULT_SETTINGS };

  result.baseFolder = readFolder(data.baseFolder, DEFAULT_SETTINGS.baseFolder);
  const legacyVideoRoot = readString(data.videoRoot, "");
  result.mediaRoot = readString(
    data.mediaRoot,
    legacyVideoRoot || DEFAULT_SETTINGS.mediaRoot
  );
  result.amapConfigPath = readString(data.amapConfigPath, DEFAULT_SETTINGS.amapConfigPath);
  result.poiTypes = readString(data.poiTypes, DEFAULT_SETTINGS.poiTypes);
  result.ffprobePath = readString(data.ffprobePath, DEFAULT_SETTINGS.ffprobePath);

  const limit = Number(data.sessionSearchLimit);
  if (Number.isFinite(limit)) {
    result.sessionSearchLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  }

  const mapMode = data.mapMode;
  result.mapMode = (mapMode === "offline" ? "offline" : "auto") as MapMode;
  result.mapPackDir = readString(data.mapPackDir, DEFAULT_SETTINGS.mapPackDir);

  const idle = Number(data.mapIdleMinutes);
  if (Number.isFinite(idle)) {
    result.mapIdleMinutes = Math.min(120, Math.max(0, Math.trunc(idle)));
  }

  result.mapProvinceColor = readColor(
    data.mapProvinceColor,
    DEFAULT_SETTINGS.mapProvinceColor
  );
  result.mapCityColor = readColor(data.mapCityColor, DEFAULT_SETTINGS.mapCityColor);
  result.mapCountyColor = readColor(data.mapCountyColor, DEFAULT_SETTINGS.mapCountyColor);
  result.mapPlaceColor = readColor(data.mapPlaceColor, DEFAULT_SETTINGS.mapPlaceColor);

  const linkMode = data.mediaLinkMode;
  result.mediaLinkMode = (linkMode === "relative" ? "relative" : "absolute") as MediaLinkMode;

  const suspicious = Object.keys(data).filter((key) => /key|secret|token|api/i.test(key));
  if (suspicious.length > 0) {
    console.warn(
      "[travel-map] data.json 中发现疑似密钥字段，已忽略且不会写回：",
      suspicious.join(", ")
    );
  }

  return result;
}

export const SETTINGS_FIELDS: Array<keyof TravelMapSettings> = [
  "baseFolder",
  "mediaRoot",
  "amapConfigPath",
  "poiTypes",
  "sessionSearchLimit",
  "mapMode",
  "mapPackDir",
  "mapIdleMinutes",
  "mapProvinceColor",
  "mapCityColor",
  "mapCountyColor",
  "mapPlaceColor",
  "mediaLinkMode",
  "ffprobePath",
];
