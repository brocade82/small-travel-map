import { App, normalizePath, TFile, TFolder } from "obsidian";
import type { TravelMapSettings } from "../types";
import { sanitizeFileName, uniqueFileName } from "../core/text";

export class VaultRepository {
  constructor(
    private readonly app: App,
    private readonly settings: () => TravelMapSettings
  ) {}

  baseFolder(): string {
    const raw = (this.settings().baseFolder || "旅游").replace(/\\/g, "/");
    return normalizePath(raw.replace(/^\/+|\/+$/g, "")) || "旅游";
  }

  folder(name: string): string {
    return normalizePath(`${this.baseFolder()}/${name}`);
  }

  placeFolder(city?: string): string {
    const bucket = city?.trim() ? sanitizeFileName(city, "未分类") : "未分类";
    return normalizePath(`${this.folder("地点")}/${bucket}`);
  }

  logFolder(): string {
    return this.folder("日志");
  }

  tripFolder(): string {
    return this.folder("行程");
  }

  photoFolder(city?: string, place?: string): string {
    const cityPart = city?.trim() ? sanitizeFileName(city, "未分类") : "未分类";
    const placePart = place?.trim() ? sanitizeFileName(place, "未命名") : "未命名";
    return normalizePath(`${this.folder("媒体")}/照片/${cityPart}/${placePart}`);
  }

  manifestPath(): string {
    return normalizePath(`${this.baseFolder()}/媒体清单.md`);
  }

  overviewPath(): string {
    return normalizePath(`${this.baseFolder()}/00-旅行总览.md`);
  }

  async ensureFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing instanceof TFile) {
        throw new Error(`创建目录失败：${current} 已是一个文件`);
      }
      try {
        await this.app.vault.createFolder(current);
      } catch (error) {
        // Another operation may have created it first.
        if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
          throw error;
        }
      }
    }
  }

  pathExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  async uniquePath(folder: string, baseName: string, extension = "md"): Promise<string> {
    const safeBase = sanitizeFileName(baseName);
    const fileName = uniqueFileName(safeBase, extension, (candidate) =>
      this.pathExists(`${folder}/${candidate}`)
    );
    return normalizePath(`${folder}/${fileName}`);
  }

  /**
   * Creates a note and adds frontmatter via processFrontMatter (never by
   * string-concatenating YAML, so user text and unknown fields survive edits).
   */
  async createNote(
    folder: string,
    baseName: string,
    frontmatter: Record<string, unknown>,
    body: string
  ): Promise<TFile> {
    await this.ensureFolder(folder);
    const path = await this.uniquePath(folder, baseName, "md");
    const file = await this.app.vault.create(path, body);
    try {
      await this.setFrontmatter(file, frontmatter);
    } catch (error) {
      await this.app.vault.delete(file);
      throw error;
    }
    return file;
  }

  async setFrontmatter(file: TFile, patch: Record<string, unknown>): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          delete frontmatter[key];
        } else {
          frontmatter[key] = value;
        }
      }
    });
  }

  async readBody(file: TFile): Promise<string> {
    const text = await this.app.vault.cachedRead(file);
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  }

  async readText(file: TFile): Promise<string> {
    return this.app.vault.cachedRead(file);
  }

  /** Used only for generated files such as 媒体清单.md. */
  async writeGenerated(path: string, content: string): Promise<TFile> {
    const normalized = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    if (existing) throw new Error(`目标路径已被目录占用：${normalized}`);
    const folder = normalized.slice(0, normalized.lastIndexOf("/"));
    if (folder) await this.ensureFolder(folder);
    return this.app.vault.create(normalized, content);
  }

  noteLink(file: TFile): string {
    return `[[${file.path.replace(/\.md$/i, "")}]]`;
  }

  noteLinkForPath(path: string): string {
    return `[[${path.replace(/\.md$/i, "")}]]`;
  }

  async openFile(file: TFile, newLeaf = false): Promise<void> {
    await this.app.workspace.getLeaf(newLeaf).openFile(file);
  }

  resourcePath(path: string): string {
    return this.app.vault.adapter.getResourcePath(normalizePath(path));
  }

  getFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }

  /** Resolves `[[...]]` and plain paths through Obsidian's link resolver. */
  resolveLink(link: string | undefined, sourcePath: string): TFile | null {
    if (!link) return null;
    const match = link.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
    const target = (match ? match[1] : link).trim();
    if (!target) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    return file instanceof TFile ? file : null;
  }
}
