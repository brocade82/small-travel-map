import fs from "node:fs";
import type { TravelMapSettings } from "../types";
import { toLocalIsoString } from "../core/dates";
import { extractVideoLinks, resolveMediaField } from "../core/media";
import { isKnownAdcode, rollup, provinceNameOf, cityNameOf } from "../core/regions";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

export type CheckSeverity = "error" | "warning" | "info";

export interface CheckIssue {
  severity: CheckSeverity;
  category: string;
  message: string;
  path?: string;
}

export interface SelfCheckReport {
  generatedAt: string;
  counts: { places: number; logs: number; trips: number; legacy: number };
  issues: CheckIssue[];
  stats: {
    videoLinks: number;
    missingVideos: number;
    placesWithoutAdcode: number;
    unknownAdcodes: number;
    unsupportedRegions: number;
    missingCovers: number;
  };
}

const SEVERITY_ORDER: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2 };

export class SelfCheckService {
  constructor(
    private readonly settings: () => TravelMapSettings,
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  async run(): Promise<SelfCheckReport> {
    const issues: CheckIssue[] = [];
    const stats = {
      videoLinks: 0,
      missingVideos: 0,
      placesWithoutAdcode: 0,
      unknownAdcodes: 0,
      unsupportedRegions: 0,
      missingCovers: 0,
    };

    for (const issue of this.index.getIssues()) {
      issues.push({
        severity: issue.kind === "missing-place-id" ? "warning" : "error",
        category: issue.kind === "duplicate-id" ? "ID" : "索引",
        message: issue.message,
        path: issue.filePath,
      });
    }

    for (const place of this.index.getPlaces()) {
      if (!place.adcode) {
        stats.placesWithoutAdcode += 1;
        issues.push({
          severity: "warning",
          category: "行政区",
          message: `地点「${place.name}」没有 adcode，无法点亮省市`,
          path: place.filePath,
        });
        continue;
      }
      const rolled = rollup(place.adcode);
      if (rolled.unsupported) {
        stats.unsupportedRegions += 1;
        issues.push({
          severity: "info",
          category: "行政区",
          message: `地点「${place.name}」位于港澳台（${place.adcode}），第一版不点亮`,
          path: place.filePath,
        });
      } else if (!isKnownAdcode(place.adcode)) {
        stats.unknownAdcodes += 1;
        issues.push({
          severity: "warning",
          category: "行政区",
          message: `地点「${place.name}」的 adcode ${place.adcode} 不在行政区清单中，可能无法点亮`,
          path: place.filePath,
        });
      }
    }

    for (const log of this.index.getLogs()) {
      if (log.placeId) {
        const place = this.index.getPlace(log.placeId);
        if (!place) {
          issues.push({
            severity: "error",
            category: "关联",
            message: `日志「${log.title}」引用的 place_id ${log.placeId} 不存在`,
            path: log.filePath,
          });
        }
      }
      if (log.tripLink) {
        const trip = this.repo.resolveLink(log.tripLink, log.filePath);
        if (!trip) {
          issues.push({
            severity: "warning",
            category: "关联",
            message: `日志「${log.title}」引用的行程链接无法解析`,
            path: log.filePath,
          });
        }
      }
      if (log.cover) {
        const externalCover = resolveMediaField(log.cover, this.settings().mediaRoot);
        const cover = externalCover
          ? null
          : this.repo.getFile(log.cover) ??
            this.repo.getFile(`${this.settings().baseFolder}/${log.cover}`);
        if (externalCover ? !fs.existsSync(externalCover) : !cover) {
          stats.missingCovers += 1;
          issues.push({
            severity: "warning",
            category: "媒体",
            message: `日志「${log.title}」的封面不存在：${log.cover}`,
            path: log.filePath,
          });
        }
      }

      const file = this.repo.getFile(log.filePath);
      if (!file) continue;
      const text = await this.repo.readText(file);
      const mediaRoot = this.settings().mediaRoot;
      for (const link of extractVideoLinks(text, mediaRoot)) {
        stats.videoLinks += 1;
        if (!link.resolved) {
          issues.push({
            severity: "warning",
            category: "媒体",
            message: `日志「${log.title}」中的库外视频链接无法解析：${link.href}`,
            path: log.filePath,
          });
          continue;
        }
        if (!fs.existsSync(link.resolved.absolute)) {
          stats.missingVideos += 1;
          issues.push({
            severity: "error",
            category: "媒体",
            message: `库外视频不存在：${link.resolved.absolute}`,
            path: log.filePath,
          });
        }
      }
    }

    const settings = this.settings();
    if (settings.mediaRoot && !fs.existsSync(settings.mediaRoot)) {
      issues.push({
        severity: "warning",
        category: "设置",
        message: `库外媒体根目录不存在：${settings.mediaRoot}`,
      });
    }
    if (this.index.getLegacy().length > 0) {
      issues.push({
        severity: "info",
        category: "索引",
        message: `有 ${this.index.getLegacy().length} 篇普通笔记只读兼容（可运行「导入旧笔记」升级）`,
      });
    }

    issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const report: SelfCheckReport = {
      generatedAt: toLocalIsoString(),
      counts: this.index.getCounts(),
      issues,
      stats,
    };
    console.debug("[travel-map] 数据自检", {
      counts: report.counts,
      issues: issues.length,
      ...stats,
    });
    return report;
  }

  /** Used by tooltips / the overview panel. */
  describePlace(adcode?: string | null): string {
    if (!adcode) return "未知行政区";
    const rolled = rollup(adcode);
    return [provinceNameOf(adcode), cityNameOf(adcode)]
      .filter(Boolean)
      .join(" / ") || (rolled.known ? "行政区" : "未知行政区");
  }
}
