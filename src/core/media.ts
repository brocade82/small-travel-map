import type { MediaLinkMode } from "../types";
import { basenameWithoutExtension, escapeLinkLabel } from "./text";

export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "mkv",
  "avi",
  "webm",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "ts",
]);

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "avif",
  "heic",
  "heif",
]);

export const LOCAL_FILE_SCHEME = "local-file://";

export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

export function normalizeMediaRoot(root: string): string {
  const normalized = normalizeSlashes(root ?? "").trim();
  if (!normalized) return "";
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function isAbsoluteMediaPath(path: string): boolean {
  const normalized = normalizeSlashes(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
}

export function joinMediaPath(root: string, relativePath: string): string {
  const normalizedRelative = normalizeSlashes(relativePath).replace(/^\.?\//, "");
  if (isAbsoluteMediaPath(normalizedRelative)) return normalizeSlashes(normalizedRelative);
  const normalizedRoot = normalizeMediaRoot(root);
  if (!normalizedRoot) return normalizedRelative;
  return `${normalizedRoot}/${normalizedRelative.replace(/^\/+/, "")}`;
}

/** Returns the path relative to the configured video root, or null. */
export function relativeMediaPath(
  absolutePath: string,
  root: string
): string | null {
  const normalized = normalizeSlashes(absolutePath);
  const normalizedRoot = normalizeMediaRoot(root);
  if (!normalizedRoot) return null;
  const prefix = `${normalizedRoot.toLowerCase()}/`;
  if (!normalized.toLowerCase().startsWith(prefix)) return null;
  return normalized.slice(normalizedRoot.length + 1);
}

export function encodeUrlPath(path: string): string {
  const normalized = normalizeSlashes(path);
  try {
    return encodeURI(normalized).replace(/#/g, "%23").replace(/\?/g, "%3F");
  } catch {
    return normalized;
  }
}

export function localFileUrl(path: string): string {
  const normalized = normalizeSlashes(path).replace(/^\/+/, "");
  return `${LOCAL_FILE_SCHEME}/${encodeUrlPath(normalized)}`;
}

/**
 * DLink's own image syntax uses file:/// with each path segment encoded.
 * Obsidian's Markdown renderer drops unrecognized schemes such as local-file://
 * for image embeds, so photos must use this form.
 */
export function absoluteFileUrl(path: string): string {
  const normalized = normalizeSlashes(path);
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
    .replace(/^([A-Za-z])%3A/, "$1:");
  return `file:///${encoded}`;
}

export function isLocalFileHref(href: string): boolean {
  return typeof href === "string" && href.toLowerCase().startsWith(LOCAL_FILE_SCHEME);
}

export function isFileHref(href: string): boolean {
  return typeof href === "string" && href.toLowerCase().startsWith("file:///");
}

/** Returns the decoded path portion of a `local-file://` URL. */
export function decodeLocalFileHref(href: string): string | null {
  if (!isLocalFileHref(href)) return null;
  const raw = href.slice(LOCAL_FILE_SCHEME.length).replace(/^\/+/, "");
  try {
    return normalizeSlashes(decodeURIComponent(raw));
  } catch {
    return normalizeSlashes(raw);
  }
}

/** Returns the decoded path portion of a `file:///` URL. */
export function decodeFileHref(href: string): string | null {
  if (!isFileHref(href)) return null;
  const raw = href.slice("file:///".length).replace(/^\/+/, "");
  try {
    return normalizeSlashes(decodeURIComponent(raw));
  } catch {
    return normalizeSlashes(raw);
  }
}

export interface ResolvedMediaHref {
  absolute: string;
  relative: string | null;
  encoded: string;
}

/**
 * `local-file:///D:/TravelMedia/a.mp4` (absolute) and
 * `local-file:///杭州/西湖/a.mp4` (root-relative) are both accepted.
 */
export function resolveVideoHref(
  href: string,
  mediaRoot: string
): ResolvedMediaHref | null {
  const decoded = decodeLocalFileHref(href) ?? decodeFileHref(href);
  if (!decoded) return null;

  if (isAbsoluteMediaPath(decoded)) {
    return {
      absolute: decoded,
      relative: relativeMediaPath(decoded, mediaRoot),
      encoded: href,
    };
  }
  const relative = decoded.replace(/^\.?\//, "").replace(/^\/+/, "");
  return {
    absolute: joinMediaPath(mediaRoot, relative),
    relative,
    encoded: localFileUrl(relative),
  };
}

/** Resolves a cover/frontmatter value that points at an external original file. */
export function resolveMediaField(value: string, mediaRoot: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (isLocalFileHref(raw)) {
    return resolveVideoHref(raw, mediaRoot)?.absolute ?? null;
  }
  if (raw.toLowerCase().startsWith("file:///")) {
    try {
      return normalizeSlashes(decodeURIComponent(raw.slice("file:///".length)));
    } catch {
      return normalizeSlashes(raw.slice("file:///".length));
    }
  }
  if (isAbsoluteMediaPath(raw)) return normalizeSlashes(raw);
  return null;
}

export function humanMediaLabel(relativePath: string): string {
  const normalized = normalizeSlashes(relativePath);
  const name = basenameWithoutExtension(normalized).replace(/_/g, " ").trim();
  const segments = normalized.split("/").filter(Boolean);
  const parent = segments.length >= 2 ? segments[segments.length - 2] : "";
  const dated = name.match(/^(\d{4}-\d{2}-\d{2})[-_\s]*(.*)$/);
  if (dated) {
    const rest = dated[2].trim();
    if (rest && !/^\d+$/.test(rest)) return `${dated[1]} ${rest}`;
    if (parent) return `${dated[1]} ${parent.replace(/_/g, " ")}`;
    if (rest) return `${dated[1]} ${rest}`;
    return dated[1];
  }
  return name || parent || "库外媒体";
}

/** Kept for existing callers/tests; media labels are shared by photos and videos. */
export function humanVideoLabel(relativePath: string): string {
  return humanMediaLabel(relativePath);
}

export interface MediaLinkOptions {
  mediaRoot: string;
  mode: MediaLinkMode;
  label?: string;
}

export function buildVideoLink(
  relativePath: string,
  options: MediaLinkOptions
): string {
  const relative = normalizeSlashes(relativePath)
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "");
  const target =
    options.mode === "absolute" ? joinMediaPath(options.mediaRoot, relative) : relative;
  const label = (options.label ?? "").trim() || `▶ ${humanMediaLabel(relative)}`;
  if (isAbsoluteMediaPath(target)) {
    // DLink turns file:/// links into blob-backed players using the original
    // file. The native local-file:// form is not a playable protocol.
    return `[${escapeLinkLabel(label)}](<${absoluteFileUrl(target)}>)`;
  }
  return `[${escapeLinkLabel(label)}](${localFileUrl(target)})`;
}

export function buildPhotoEmbed(
  relativePath: string,
  options: MediaLinkOptions
): string {
  const relative = normalizeSlashes(relativePath)
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "");
  // Photos must be absolute for DLink; use file:/// + angle brackets so the
  // Markdown renderer keeps them as images.
  const target = joinMediaPath(options.mediaRoot, relative);
  const label = (options.label ?? "").trim() || humanMediaLabel(relative);
  return `![${escapeLinkLabel(label)}](<${absoluteFileUrl(target)}>)`;
}

export interface ParsedVideoLink {
  label: string;
  href: string;
  resolved: ResolvedMediaHref | null;
}

const VIDEO_LINK_RE =
  /\[((?:\\.|[^\]\\])+)\]\((?:<)?((?:local-file|file):\/\/\/[^)\s>]+)(?:>)?\)/gi;

export function extractVideoLinks(markdown: string, mediaRoot: string): ParsedVideoLink[] {
  const links: ParsedVideoLink[] = [];
  let match: RegExpExecArray | null;
  VIDEO_LINK_RE.lastIndex = 0;
  while ((match = VIDEO_LINK_RE.exec(markdown)) !== null) {
    const label = match[1].replace(/\\([\[\]\\])/g, "$1");
    const href = match[2];
    links.push({ label, href, resolved: resolveVideoHref(href, mediaRoot) });
  }
  return links;
}

export function isVideoFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(extension);
}

export function isImageFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
