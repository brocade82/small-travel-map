import fs from "node:fs";
import path from "node:path";
import { App, TFile, parseYaml } from "obsidian";
import type { TravelMapSettings } from "../types";
import {
  deriveDateFromFilename,
  deriveDateFromPath,
  formatDate,
  normalizeDate,
  toLocalIsoString,
} from "../core/dates";
import {
  addToInventory,
  classifyImportFile,
  emptyInventory,
  isNoteKind,
  type ImportInventory,
} from "../core/import";
import { generateUniqueId } from "../core/ids";
import { adcodeFromNames, normalizeAdcode } from "../core/regions";
import {
  basenameWithoutExtension,
  firstHeading,
  sanitizeFileName,
  splitFrontmatter,
  toArray,
} from "../core/text";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

export type SkipReason =
  | "managed"
  | "inside-base"
  | "already-imported"
  | "unreadable";

export interface ImportCandidate {
  sourcePath: string;
  sourceType: "markdown" | "text";
  name: string;
  date: string;
  dateGuessed: boolean;
  city?: string;
  province?: string;
  adcode?: string;
  placeId?: string;
  placeLink?: string;
  tags: string[];
  pinned: boolean;
  cover?: string;
  body: string;
  extraFrontmatter: Record<string, unknown>;
  targetPath: string;
  targetCollision: boolean;
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail: string;
}

export interface ImportPlan {
  rootPath: string;
  external: boolean;
  totalFiles: number;
  inventory: ImportInventory;
  candidates: ImportCandidate[];
  skipped: SkippedFile[];
  missingPlace: number;
  missingDate: number;
  existingCollisions: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: Array<{ path: string; message: string }>;
}

const REASON_TEXT: Record<SkipReason, string> = {
  managed: "已有 kind，已由插件管理",
  "inside-base": "位于旅游目录内，不重复导入",
  "already-imported": "source 已存在，之前导入过",
  unreadable: "读取失败",
};

const MAX_EXTERNAL_FILES = 20_000;
const SKIP_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules"]);

interface CandidateInput {
  sourcePath: string;
  sourceType: "markdown" | "text";
  fileName: string;
  pathForDate: string;
  text: string;
  frontmatter: Record<string, unknown>;
  ctime: number;
  existingTargets: Set<string>;
}

export class ImportService {
  constructor(
    private readonly app: App,
    private readonly settings: () => TravelMapSettings,
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  private isUnderBase(filePath: string): boolean {
    return this.index.isUnderBase(filePath);
  }

  private importedSources(): Set<string> {
    const set = new Set<string>();
    for (const log of this.index.getLogs()) {
      if (log.source) set.add(this.normalizeSource(log.source));
    }
    return set;
  }

  private normalizeSource(value: string): string {
    return value.replace(/\\/g, "/").toLowerCase();
  }

  private cityFromBody(body: string): string | undefined {
    const wiki = body.match(/\[\[城市\/([^\]|#]+)/);
    if (wiki) return wiki[1].trim();
    const plain = body.match(/\[\[([^\]|#/]+?)(?:市|地区|自治州)\]\]/);
    return plain ? plain[1].trim() : undefined;
  }

  private placeFor(frontmatter: Record<string, unknown>): {
    placeId?: string;
    placeLink?: string;
  } {
    const placeId =
      typeof frontmatter.place_id === "string" ? frontmatter.place_id.trim() : "";
    if (placeId && this.index.getPlace(placeId)) {
      return { placeId };
    }
    const link = typeof frontmatter.place === "string" ? frontmatter.place.trim() : "";
    if (link) {
      const match = link.match(/^\[\[([^\]|#]+)/);
      const target = match ? match[1] : link;
      const place = this.index
        .getPlaces()
        .find(
          (candidate) =>
            candidate.filePath.replace(/\.md$/i, "") === target.replace(/\.md$/i, "")
        );
      if (place) {
        return { placeId: place.id, placeLink: this.repo.noteLinkForPath(place.filePath) };
      }
    }
    return {};
  }

  private parseFrontmatter(text: string): Record<string, unknown> {
    const split = splitFrontmatter(text);
    if (!split.frontmatter) return {};
    try {
      const parsed = parseYaml(split.frontmatter);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // Broken YAML is treated as a plain note; the body is still preserved.
      return {};
    }
  }

  private buildCandidate(input: CandidateInput): ImportCandidate {
    const {
      sourcePath,
      sourceType,
      fileName,
      pathForDate,
      text,
      frontmatter,
      ctime,
      existingTargets,
    } = input;
    const split = splitFrontmatter(text);
    const body = sourceType === "text" ? text.replace(/^\uFEFF/, "") : split.body;
    const name =
      firstHeading(text) ||
      (typeof frontmatter.name === "string" ? frontmatter.name.trim() : "") ||
      basenameWithoutExtension(fileName);
    const dateFromName = deriveDateFromFilename(fileName);
    const dateFromFrontmatter =
      normalizeDate(frontmatter.visited_start) ?? normalizeDate(frontmatter.date);
    const dateFromPath = deriveDateFromPath(pathForDate);
    const date =
      dateFromName ??
      dateFromFrontmatter ??
      dateFromPath ??
      formatDate(new Date(ctime));
    const city =
      (typeof frontmatter.city === "string" ? frontmatter.city.trim() : "") ||
      this.cityFromBody(body);
    const province =
      typeof frontmatter.province === "string" ? frontmatter.province.trim() : undefined;
    const adcode =
      normalizeAdcode(frontmatter.adcode) ?? adcodeFromNames(province, city) ?? undefined;
    const place = this.placeFor(frontmatter);

    const extra: Record<string, unknown> = {};
    if (sourceType === "markdown") {
      const reserved = new Set([
        "kind",
        "schema_version",
        "id",
        "place_id",
        "place",
        "trip",
        "visited_start",
        "visited_end",
        "date",
        "tags",
        "pinned",
        "cover",
        "created",
        "updated",
        "source",
      ]);
      for (const [key, value] of Object.entries(frontmatter)) {
        if (!reserved.has(key)) extra[key] = value;
      }
    }

    const safeName = sanitizeFileName(name, basenameWithoutExtension(fileName));
    const targetPath = `${this.repo.logFolder()}/${date}-${safeName}.md`;
    const targetCollision = existingTargets.has(targetPath.toLowerCase());
    existingTargets.add(targetPath.toLowerCase());

    return {
      sourcePath,
      sourceType,
      name: name || basenameWithoutExtension(fileName),
      date,
      dateGuessed: !dateFromName && !dateFromFrontmatter,
      city,
      province,
      adcode,
      placeId: place.placeId,
      placeLink: place.placeLink,
      tags: sourceType === "text" ? [] : toArray(frontmatter.tags),
      pinned: sourceType === "markdown" && frontmatter.pinned === true,
      cover:
        sourceType === "markdown" && typeof frontmatter.cover === "string"
          ? frontmatter.cover
          : undefined,
      body,
      extraFrontmatter: extra,
      targetPath,
      targetCollision,
    };
  }

  private summarize(plan: ImportPlan): ImportPlan {
    plan.totalFiles = plan.inventory.total;
    plan.missingPlace = plan.candidates.filter((candidate) => !candidate.placeId).length;
    plan.missingDate = plan.candidates.filter((candidate) => candidate.dateGuessed).length;
    return plan;
  }

  async scan(rootPath: string): Promise<ImportPlan> {
    const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const files = this.app.vault
      .getAllLoadedFiles()
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          (normalizedRoot === "" ||
            file.path === normalizedRoot ||
            file.path.startsWith(`${normalizedRoot}/`))
      );
    return this.scanVaultFiles(normalizedRoot, files);
  }

  private async scanVaultFiles(rootPath: string, files: TFile[]): Promise<ImportPlan> {
    const imported = this.importedSources();
    const existingTargets = new Set(
      this.index.getLogs().map((log) => log.filePath.toLowerCase())
    );
    const plan: ImportPlan = {
      rootPath,
      external: false,
      totalFiles: 0,
      inventory: emptyInventory(),
      candidates: [],
      skipped: [],
      missingPlace: 0,
      missingDate: 0,
      existingCollisions: 0,
    };

    for (const file of files) {
      const kind = classifyImportFile(file.name);
      addToInventory(plan.inventory, kind);
      if (!isNoteKind(kind)) continue;
      if (this.isUnderBase(file.path)) {
        plan.skipped.push({
          path: file.path,
          reason: "inside-base",
          detail: REASON_TEXT["inside-base"],
        });
        continue;
      }
      let text: string;
      try {
        text = await this.app.vault.cachedRead(file);
      } catch (error) {
        plan.skipped.push({
          path: file.path,
          reason: "unreadable",
          detail: `${REASON_TEXT.unreadable}：${(error as Error).message}`,
        });
        continue;
      }
      const frontmatter = kind === "markdown" ? this.parseFrontmatter(text) : {};
      if (
        frontmatter.kind === "place" ||
        frontmatter.kind === "travel-log" ||
        frontmatter.kind === "trip"
      ) {
        plan.skipped.push({
          path: file.path,
          reason: "managed",
          detail: REASON_TEXT.managed,
        });
        continue;
      }
      if (imported.has(this.normalizeSource(file.path))) {
        plan.skipped.push({
          path: file.path,
          reason: "already-imported",
          detail: REASON_TEXT["already-imported"],
        });
        continue;
      }
      const candidate = this.buildCandidate({
        sourcePath: file.path,
        sourceType: kind === "text" ? "text" : "markdown",
        fileName: file.name,
        pathForDate: file.path,
        text,
        frontmatter,
        ctime: file.stat.ctime,
        existingTargets,
      });
      plan.candidates.push(candidate);
    }

    plan.existingCollisions = plan.candidates.filter(
      (candidate) => candidate.targetCollision
    ).length;
    return this.summarize(plan);
  }

  private countCollisions(candidates: ImportCandidate[]): number {
    return candidates.filter((candidate) => candidate.targetCollision).length;
  }
  /** Scans a folder outside the vault without copying anything. */
  async scanExternal(rootPath: string): Promise<ImportPlan> {
    const input = rootPath.trim();
    if (!input || !path.isAbsolute(input)) {
      throw new Error("外部文件夹必须填写绝对路径，例如 D:\\TravelMedia");
    }
    const rootAbs = path.resolve(input);
    const stats = fs.statSync(rootAbs, { throwIfNoEntry: false });
    if (!stats || !stats.isDirectory()) {
      throw new Error(`外部文件夹不存在或不是目录：${rootAbs}`);
    }
    const imported = this.importedSources();
    const existingTargets = new Set(
      this.index.getLogs().map((log) => log.filePath.toLowerCase())
    );
    const plan: ImportPlan = {
      rootPath: rootAbs.replace(/\\/g, "/"),
      external: true,
      totalFiles: 0,
      inventory: emptyInventory(),
      candidates: [],
      skipped: [],
      missingPlace: 0,
      missingDate: 0,
      existingCollisions: 0,
    };

    const entries: Array<{ absolutePath: string; relativePath: string; name: string }> = [];
    const walk = (directory: string): void => {
      const dirents = fs.readdirSync(directory, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue;
        const absolutePath = path.join(directory, dirent.name);
        if (dirent.isDirectory()) {
          if (SKIP_DIRS.has(dirent.name.toLowerCase())) continue;
          walk(absolutePath);
          continue;
        }
        if (!dirent.isFile()) continue;
        if (entries.length >= MAX_EXTERNAL_FILES) {
          throw new Error(`外部文件夹文件数超过 ${MAX_EXTERNAL_FILES} 个，已停止扫描`);
        }
        entries.push({
          absolutePath,
          relativePath: path.relative(rootAbs, absolutePath).replace(/\\/g, "/"),
          name: dirent.name,
        });
      }
    };
    walk(rootAbs);

    for (const entry of entries) {
      const kind = classifyImportFile(entry.name);
      addToInventory(plan.inventory, kind);
      if (!isNoteKind(kind)) continue;
      let text: string;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(entry.absolutePath);
        text = fs.readFileSync(entry.absolutePath, "utf8");
      } catch (error) {
        plan.skipped.push({
          path: entry.relativePath,
          reason: "unreadable",
          detail: `${REASON_TEXT.unreadable}：${(error as Error).message}`,
        });
        continue;
      }
      const frontmatter = kind === "markdown" ? this.parseFrontmatter(text) : {};
      if (
        frontmatter.kind === "place" ||
        frontmatter.kind === "travel-log" ||
        frontmatter.kind === "trip"
      ) {
        plan.skipped.push({
          path: entry.relativePath,
          reason: "managed",
          detail: REASON_TEXT.managed,
        });
        continue;
      }
      const sourcePath = entry.absolutePath.replace(/\\/g, "/");
      if (imported.has(this.normalizeSource(sourcePath))) {
        plan.skipped.push({
          path: entry.relativePath,
          reason: "already-imported",
          detail: REASON_TEXT["already-imported"],
        });
        continue;
      }
      const candidate = this.buildCandidate({
        sourcePath,
        sourceType: kind === "text" ? "text" : "markdown",
        fileName: entry.name,
        pathForDate: entry.relativePath,
        text,
        frontmatter,
        ctime: stat.birthtimeMs || stat.mtimeMs,
        existingTargets,
      });
      plan.candidates.push(candidate);
    }

    plan.existingCollisions = this.countCollisions(plan.candidates);
    return this.summarize(plan);
  }

  async execute(plan: ImportPlan): Promise<ImportResult> {
    const result: ImportResult = { created: 0, skipped: 0, errors: [] };
    const imported = this.importedSources();
    for (const candidate of plan.candidates) {
      const normalizedSource = this.normalizeSource(candidate.sourcePath);
      if (imported.has(normalizedSource)) {
        result.skipped += 1;
        continue;
      }
      try {
        const id = generateUniqueId((token) => this.index.hasId(token));
        const now = toLocalIsoString();
        const frontmatter: Record<string, unknown> = {
          ...candidate.extraFrontmatter,
          kind: "travel-log",
          schema_version: 1,
          id,
          place_id: candidate.placeId || undefined,
          place: candidate.placeLink || undefined,
          visited_start: candidate.date,
          visited_end: candidate.date,
          date: candidate.date,
          tags: Array.from(new Set(["旅游/日志", ...candidate.tags])),
          pinned: candidate.pinned,
          cover: candidate.cover,
          source: candidate.sourcePath,
          source_format: candidate.sourceType,
          created: now,
          updated: now,
        };
        const file = await this.repo.createNote(
          this.repo.logFolder(),
          `${candidate.date}-${candidate.name}`,
          frontmatter,
          candidate.body
        );
        await this.index.refreshFile(file);
        imported.add(normalizedSource);
        result.created += 1;
      } catch (error) {
        result.errors.push({
          path: candidate.sourcePath,
          message: (error as Error).message,
        });
      }
    }
    return result;
  }
}
