import { isVideoFile } from "./media";

export type ImportFileKind =
  | "markdown"
  | "text"
  | "image"
  | "video"
  | "document"
  | "other";

export interface ImportInventory {
  markdown: number;
  text: number;
  images: number;
  videos: number;
  documents: number;
  other: number;
  total: number;
}

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
  "avif",
]);

export const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "rtf",
  "odt",
  "ods",
  "odp",
  "epub",
  "mobi",
  "pages",
  "numbers",
  "key",
]);

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index + 1).toLowerCase();
}

export function classifyImportFile(fileName: string): ImportFileKind {
  const extension = extensionOf(fileName);
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "txt") return "text";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (isVideoFile(fileName)) return "video";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "other";
}

export function emptyInventory(): ImportInventory {
  return {
    markdown: 0,
    text: 0,
    images: 0,
    videos: 0,
    documents: 0,
    other: 0,
    total: 0,
  };
}

export function addToInventory(inventory: ImportInventory, kind: ImportFileKind): void {
  inventory.total += 1;
  switch (kind) {
    case "markdown":
      inventory.markdown += 1;
      break;
    case "text":
      inventory.text += 1;
      break;
    case "image":
      inventory.images += 1;
      break;
    case "video":
      inventory.videos += 1;
      break;
    case "document":
      inventory.documents += 1;
      break;
    default:
      inventory.other += 1;
  }
}

export function isNoteKind(kind: ImportFileKind): boolean {
  return kind === "markdown" || kind === "text";
}

export function inventorySummary(inventory: ImportInventory): string {
  return [
    `Markdown ${inventory.markdown}`,
    `TXT ${inventory.text}`,
    `照片 ${inventory.images}`,
    `视频 ${inventory.videos}`,
    `其他文档 ${inventory.documents + inventory.other}`,
  ].join(" · ");
}
