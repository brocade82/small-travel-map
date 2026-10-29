import { App, EventRef, parseYaml, TAbstractFile, TFile } from "obsidian";
import type {
  LegacyRecord,
  LogRecord,
  PlaceRecord,
  TripRecord,
  TravelMapSettings,
} from "../types";
import { normalizeSlashes } from "../core/media";
import { splitFrontmatter } from "../core/text";
import { parseLegacy, parseLog, parsePlace, parseTrip } from "./records";

export type TravelRecord = PlaceRecord | LogRecord | TripRecord | LegacyRecord;

export interface IndexIssue {
  kind: "missing-id" | "duplicate-id" | "missing-place-id" | "bad-frontmatter";
  filePath: string;
  message: string;
}

interface IndexData {
  places: Map<string, PlaceRecord>;
  logs: Map<string, LogRecord>;
  trips: Map<string, TripRecord>;
  legacy: Map<string, LegacyRecord>;
  byId: Map<string, PlaceRecord | LogRecord | TripRecord>;
  problems: Map<string, string>;
  duplicateIds: Map<string, string[]>;
}

const EMPTY_DATA = (): IndexData => ({
  places: new Map(),
  logs: new Map(),
  trips: new Map(),
  legacy: new Map(),
  byId: new Map(),
  problems: new Map(),
  duplicateIds: new Map(),
});

export class TravelIndex {
  private data: IndexData = EMPTY_DATA();
  private listeners = new Set<() => void>();
  private pending = new Set<string>();
  private timer: number | null = null;
  private vaultRefs: EventRef[] = [];
  private metadataRefs: EventRef[] = [];
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private disposed = false;
  private initialized = false;

  constructor(
    private readonly app: App,
    private readonly settings: () => TravelMapSettings
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return this.readyPromise;
    this.initialized = true;
    try {
      await new Promise<void>((resolve) => this.app.workspace.onLayoutReady(resolve));
      await this.rebuild();
      this.attachEvents();
    } catch (error) {
      console.error("[travel-map] 初始化索引失败", error);
    } finally {
      this.resolveReady();
    }
    return this.readyPromise;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("[travel-map] index listener failed", error);
      }
    }
  }

  private attachEvents(): void {
    const schedule = (file: TAbstractFile) => this.schedule(file.path);
    this.vaultRefs.push(
      this.app.vault.on("create", schedule),
      this.app.vault.on("modify", schedule),
      this.app.vault.on("delete", (file) => {
        this.removePath(file.path);
        this.emit();
      }),
      this.app.vault.on("rename", (file, oldPath) => {
        this.removePath(oldPath);
        this.schedule(file.path);
      })
    );
    this.metadataRefs.push(
      this.app.metadataCache.on("changed", (file) => this.schedule(file.path))
    );
  }

  private schedule(path: string): void {
    if (this.disposed) return;
    this.pending.add(path);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 300);
  }

  private async flush(): Promise<void> {
    const paths = Array.from(this.pending);
    this.pending.clear();
    if (paths.length === 0) return;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.refreshFile(file);
      } else {
        this.removePath(path);
      }
    }
    this.recomputeDuplicates();
    this.emit();
  }

  isUnderBase(path: string): boolean {
    const base = normalizeSlashes(this.settings().baseFolder || "旅游")
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    const normalized = normalizeSlashes(path).toLowerCase();
    return normalized === base || normalized.startsWith(`${base}/`);
  }

  private async frontmatterOf(file: TFile): Promise<Record<string, unknown> | null> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached) return cached as Record<string, unknown>;
    try {
      const text = await this.app.vault.cachedRead(file);
      const split = splitFrontmatter(text);
      if (!split.frontmatter) return null;
      const parsed = parseYaml(split.frontmatter);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch (error) {
      console.debug("[travel-map] frontmatter fallback failed", file.path, error);
      return null;
    }
  }

  async rebuild(): Promise<void> {
    this.data = EMPTY_DATA();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isUnderBase(file.path)) continue;
      await this.ingest(file);
    }
    this.recomputeDuplicates();
    this.emit();
  }

  async refreshFile(file: TFile): Promise<void> {
    this.removePath(file.path);
    if (!this.isUnderBase(file.path)) return;
    await this.ingest(file);
    this.recomputeDuplicates();
    this.emit();
  }

  /** Refresh by path, creating a TFile lookup first. */
  async refreshPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.refreshFile(file);
  }

  private async ingest(file: TFile): Promise<void> {
    const frontmatter = await this.frontmatterOf(file);
    if (!frontmatter) {
      this.data.legacy.set(file.path, parseLegacy(file.path, file.stat.mtime));
      return;
    }
    const kind = frontmatter.kind;
    if (kind === "place") {
      const record = parsePlace(file.path, frontmatter, file.stat.mtime);
      if (!record) {
        this.data.problems.set(file.path, "地点档案缺少 id");
        return;
      }
      this.data.places.set(file.path, record);
      this.addId(record);
      return;
    }
    if (kind === "travel-log") {
      const record = parseLog(file.path, frontmatter, file.stat.mtime);
      if (!record) {
        this.data.problems.set(file.path, "旅行日志缺少 id");
        return;
      }
      this.data.logs.set(file.path, record);
      this.addId(record);
      return;
    }
    if (kind === "trip") {
      const record = parseTrip(file.path, frontmatter, file.stat.mtime);
      if (!record) {
        this.data.problems.set(file.path, "行程缺少 id");
        return;
      }
      this.data.trips.set(file.path, record);
      this.addId(record);
      return;
    }
    if (kind === "overview" || kind === "city") {
      return;
    }
    this.data.legacy.set(file.path, parseLegacy(file.path, file.stat.mtime));
  }

  private addId(record: PlaceRecord | LogRecord | TripRecord): void {
    if (!this.data.byId.has(record.id)) {
      this.data.byId.set(record.id, record);
    }
  }

  private recomputeDuplicates(): void {
    const seen = new Map<string, string[]>();
    const all: Array<PlaceRecord | LogRecord | TripRecord> = [
      ...this.data.places.values(),
      ...this.data.logs.values(),
      ...this.data.trips.values(),
    ];
    for (const record of all) {
      const paths = seen.get(record.id) ?? [];
      paths.push(record.filePath);
      seen.set(record.id, paths);
    }
    this.data.duplicateIds = new Map(
      Array.from(seen.entries()).filter(([, paths]) => paths.length > 1)
    );
  }

  private removePath(path: string): void {
    const existing =
      this.data.places.get(path) ?? this.data.logs.get(path) ?? this.data.trips.get(path);
    if (existing && this.data.byId.get(existing.id) === existing) {
      this.data.byId.delete(existing.id);
    }
    this.data.places.delete(path);
    this.data.logs.delete(path);
    this.data.trips.delete(path);
    this.data.legacy.delete(path);
    this.data.problems.delete(path);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    for (const ref of this.metadataRefs) this.app.metadataCache.offref(ref);
    this.vaultRefs = [];
    this.metadataRefs = [];
    this.listeners.clear();
  }

  getPlaces(): PlaceRecord[] {
    return Array.from(this.data.places.values());
  }

  getLogs(): LogRecord[] {
    return Array.from(this.data.logs.values());
  }

  getTrips(): TripRecord[] {
    return Array.from(this.data.trips.values());
  }

  getLegacy(): LegacyRecord[] {
    return Array.from(this.data.legacy.values());
  }

  getPlace(id: string): PlaceRecord | undefined {
    const record = this.data.byId.get(id);
    return record && record.kind === "place" ? record : undefined;
  }

  getPlaceByPath(filePath: string): PlaceRecord | undefined {
    return this.data.places.get(filePath);
  }

  getLog(id: string): LogRecord | undefined {
    const record = this.data.byId.get(id);
    return record && record.kind === "travel-log" ? record : undefined;
  }

  getTrip(id: string): TripRecord | undefined {
    const record = this.data.byId.get(id);
    return record && record.kind === "trip" ? record : undefined;
  }

  getById(id: string): PlaceRecord | LogRecord | TripRecord | undefined {
    return this.data.byId.get(id);
  }

  hasId(id: string): boolean {
    return this.data.byId.has(id);
  }

  findPlaceByAmapId(amapPoiId: string): PlaceRecord | undefined {
    for (const place of this.data.places.values()) {
      if (place.amapPoiId && place.amapPoiId === amapPoiId) return place;
      if (place.id === amapPoiId) return place;
    }
    return undefined;
  }

  getLogsForPlace(placeId: string): LogRecord[] {
    if (!placeId) return [];
    return this.getLogs().filter((log) => log.placeId === placeId);
  }

  getPlaceForLog(log: LogRecord): PlaceRecord | undefined {
    return log.placeId ? this.getPlace(log.placeId) : undefined;
  }

  getIssues(): IndexIssue[] {
    const issues: IndexIssue[] = [];
    for (const [path, message] of this.data.problems) {
      issues.push({ kind: "missing-id", filePath: path, message });
    }
    for (const [id, paths] of this.data.duplicateIds) {
      for (const path of paths) {
        issues.push({
          kind: "duplicate-id",
          filePath: path,
          message: `重复 id ${id}（共 ${paths.length} 个文件）`,
        });
      }
    }
    for (const log of this.data.logs.values()) {
      if (!log.placeId) {
        issues.push({
          kind: "missing-place-id",
          filePath: log.filePath,
          message: "旅行日志没有 place_id，时间线可用但无法关联地点",
        });
      }
    }
    return issues;
  }

  getCounts(): { places: number; logs: number; trips: number; legacy: number } {
    return {
      places: this.data.places.size,
      logs: this.data.logs.size,
      trips: this.data.trips.size,
      legacy: this.data.legacy.size,
    };
  }
}
