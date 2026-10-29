const INVALID_FILE_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(raw: string, fallback = "未命名"): string {
  let name = (raw ?? "")
    .normalize("NFC")
    .replace(INVALID_FILE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  if (name.length > 60) name = name.slice(0, 60).trim();
  return name || fallback;
}

export function uniqueFileName(
  base: string,
  extension: string,
  exists: (fileName: string) => boolean
): string {
  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  let candidate = `${base}${suffix}`;
  let index = 2;
  while (exists(candidate)) {
    candidate = `${base}-${index}${suffix}`;
    index += 1;
    if (index > 999) throw new Error(`同名文件过多：${base}`);
  }
  return candidate;
}

/** First level-1 heading, ignoring YAML frontmatter. */
export function firstHeading(markdown: string): string | null {
  const body = splitFrontmatter(markdown).body;
  const match = body.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : null;
}

export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return { frontmatter: null, body: normalized };
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: normalized };
  return { frontmatter: match[1], body: normalized.slice(match[0].length) };
}

export function escapeLinkLabel(text: string): string {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function basenameWithoutExtension(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function truncateText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Rough plain-text excerpt for timeline cards. */
export function excerptFromMarkdown(markdown: string, maxLength = 140): string {
  const body = splitFrontmatter(markdown).body
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/[*_>#-]/g, " ");
  return truncateText(body, maxLength);
}

export function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
