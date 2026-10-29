const DATE_RE = /(\d{4})[-_.](\d{2})[-_.](\d{2})/;
const COMPACT_DATE_RE = /(\d{4})(\d{2})(\d{2})/;

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `2026-10-26T21:40:00+08:00`, matching the schema examples. */
export function toLocalIsoString(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(
    absolute % 60
  ).padStart(2, "0")}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return `${local.toISOString().slice(0, 19)}${offset}`;
}

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

/** Returns `YYYY-MM-DD` when the value looks like a date, otherwise null. */
export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : formatDate(date);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!validDay(year, month, day)) return null;
    return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
  return null;
}

/** Pulls a date out of an old note's filename; used by the importer. */
export function deriveDateFromFilename(filename: string): string | null {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const separated = withoutExtension.match(DATE_RE);
  if (separated) {
    const year = Number(separated[1]);
    const month = Number(separated[2]);
    const day = Number(separated[3]);
    if (validDay(year, month, day)) {
      return `${separated[1]}-${separated[2]}-${separated[3]}`;
    }
  }
  const compact = withoutExtension.match(COMPACT_DATE_RE);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    if (validDay(year, month, day)) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
  }
  return null;
}

export function todayIso(date: Date = new Date()): string {
  return formatDate(date);
}

/**
 * Finds the most specific date embedded in a path. Test folders can use
 * names such as `2026.7.24-example/2026.8.18`, so the last match wins.
 */
export function deriveDateFromPath(value: string): string | null {
  const matches = Array.from(
    value.matchAll(/(20\d{2})[.\-_/](\d{1,2})[.\-_/](\d{1,2})/g)
  );
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!validDay(year, month, day)) continue;
    return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
