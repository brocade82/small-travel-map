import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TFile } from "obsidian";
import type { TravelMapSettings } from "../types";
import { toLocalIsoString } from "../core/dates";
import {
  extractVideoLinks,
  formatBytes,
  isImageFile,
  isVideoFile,
} from "../core/media";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

const execFileAsync = promisify(execFile);

export type MediaKind = "photo" | "video";

export interface MediaEntry {
  kind: MediaKind;
  relativePath: string;
  absolutePath: string;
  size: number;
  mtime: number;
  durationSeconds?: number;
  referenced: number;
}

/** Backwards-compatible alias for callers that only deal with videos. */
export type VideoEntry = MediaEntry;

export interface MissingVideoReference {
  label: string;
  absolutePath: string;
  logPath: string;
}

export interface ManifestResult {
  file: TFile;
  entries: MediaEntry[];
  missing: MissingVideoReference[];
  totalBytes: number;
}

function formatTime(mtime: number): string {
  const date = new Date(mtime);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

async function walk(dir: string, onFile: (absolutePath: string) => Promise<void>): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[travel-map] 无法读取目录 ${dir}: ${(error as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, onFile);
    } else if (entry.isFile() && (isVideoFile(entry.name) || isImageFile(entry.name))) {
      await onFile(absolute);
    }
  }
}

async function probeDuration(ffprobe: string, file: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { timeout: 15_000, windowsHide: true }
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}

export class MediaManifestService {
  constructor(
    private readonly settings: () => TravelMapSettings,
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  async scanMedia(): Promise<MediaEntry[]> {
    const root = this.settings().mediaRoot?.trim();
    if (!root) throw new Error("未配置库外媒体根目录");
    if (!fs.existsSync(root)) throw new Error(`库外媒体根目录不存在：${root}`);
    const walkRoot = path.resolve(root);
    const entries: MediaEntry[] = [];
    await walk(walkRoot, async (absolutePath) => {
      try {
        const stat = await fs.promises.stat(absolutePath);
        const kind: MediaKind = isVideoFile(absolutePath) ? "video" : "photo";
        entries.push({
          kind,
          relativePath: path.relative(walkRoot, absolutePath).replace(/\\/g, "/"),
          absolutePath: absolutePath.replace(/\\/g, "/"),
          size: stat.size,
          mtime: stat.mtimeMs,
          referenced: 0,
        });
      } catch (error) {
        console.warn(
          `[travel-map] 无法读取媒体文件 ${absolutePath}: ${(error as Error).message}`
        );
      }
    });
    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
    return entries;
  }

  async scanVideos(): Promise<MediaEntry[]> {
    return (await this.scanMedia()).filter((entry) => entry.kind === "video");
  }

  async update(): Promise<ManifestResult> {
    const settings = this.settings();
    const root = settings.mediaRoot?.trim();
    if (!root) throw new Error("未配置库外媒体根目录");
    if (!fs.existsSync(root)) throw new Error(`库外媒体根目录不存在：${root}`);

    const references = new Map<string, number>();
    const missing: MissingVideoReference[] = [];
    for (const log of this.index.getLogs()) {
      const file = this.repo.getFile(log.filePath);
      if (!file) continue;
      const text = await this.repo.readText(file);
      for (const link of extractVideoLinks(text, root)) {
        if (!link.resolved) continue;
        if (!fs.existsSync(link.resolved.absolute)) {
          missing.push({
            label: link.label,
            absolutePath: link.resolved.absolute,
            logPath: log.filePath,
          });
          continue;
        }
        if (link.resolved.relative) {
          references.set(
            link.resolved.relative,
            (references.get(link.resolved.relative) ?? 0) + 1
          );
        }
      }
    }

    const entries = await this.scanMedia();
    for (const entry of entries) {
      entry.referenced = references.get(entry.relativePath) ?? 0;
    }

    const ffprobe = settings.ffprobePath?.trim();
    if (ffprobe) {
      for (const entry of entries) {
        if (entry.kind !== "video") continue;
        entry.durationSeconds = await probeDuration(ffprobe, entry.absolutePath);
      }
    }

    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    const generatedAt = toLocalIsoString();
    const referencedCount = entries.filter((entry) => entry.referenced > 0).length;
    const photos = entries.filter((entry) => entry.kind === "photo").length;
    const videos = entries.filter((entry) => entry.kind === "video").length;

    const lines: string[] = [
      "---",
      "kind: overview",
      "generated_by: travel-map",
      `generated_at: ${generatedAt}`,
      "---",
      "",
      "# 库外媒体清单",
      "",
      "> 本文件由「更新媒体清单」命令生成。库外照片和视频不进入 Obsidian 同步、Git 或云盘备份，",
      "> 换机器或核对备份时请以这张表为准；重新运行命令会覆盖本文件。",
      "",
      `- 生成时间：${generatedAt}`,
      `- 媒体根目录：\`${root.replace(/\\/g, "/")}\``,
      `- 文件数：${entries.length}（照片 ${photos} / 视频 ${videos}；其中被引用 ${referencedCount} 个）`,
      `- 总大小：${formatBytes(totalBytes)}`,
      `- 缺失引用：${missing.length}`,
      ffprobe ? "" : "- 时长：未配置 ffprobe，视频显示为 —；照片本身不计算时长",
      "",
      "## 媒体文件",
      "",
      "| 类型 | 相对路径 | 大小 | 最后修改 | 时长 | 被引用 |",
      "|---|---|---:|---|---:|---:|",
      ...entries.map((entry) => {
        const duration =
          entry.kind === "video" && entry.durationSeconds !== undefined
            ? `${Math.floor(entry.durationSeconds / 60)}:${String(
                Math.round(entry.durationSeconds % 60)
              ).padStart(2, "0")}`
            : "—";
        return `| ${entry.kind === "photo" ? "照片" : "视频"} | \`${cell(
          entry.relativePath
        )}\` | ${formatBytes(entry.size)} | ${formatTime(entry.mtime)} | ${duration} | ${
          entry.referenced
        } |`;
      }),
      "",
      "## 缺失的库外视频",
      "",
      ...(missing.length === 0
        ? ["无。所有链接都指向存在的文件。"]
        : [
            "| 链接文字 | 解析出的绝对路径 | 所在日志 |",
            "|---|---|---|",
            ...missing.map(
              (item) =>
                `| ${cell(item.label)} | \`${cell(item.absolutePath)}\` | \`${cell(
                  item.logPath
                )}\` |`
            ),
          ]),
      "",
    ];

    const file = await this.repo.writeGenerated(this.repo.manifestPath(), lines.join("\n"));
    console.debug("[travel-map] 媒体清单已更新", {
      files: entries.length,
      missing: missing.length,
      totalBytes,
    });
    return { file, entries, missing, totalBytes };
  }
}
