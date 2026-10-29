import { TFile } from "obsidian";
import type { AmapPoi, PlaceRecord } from "../types";
import { generateUniqueId } from "../core/ids";
import { toLocalIsoString } from "../core/dates";
import { parseAmapLocation } from "../core/geo";
import {
  adcodeFromNames,
  cityNameOf,
  normalizeAdcode,
  provinceNameOf,
  shortRegionName,
} from "../core/regions";
import { sanitizeFileName } from "../core/text";
import { TravelIndex } from "./indexer";
import { VaultRepository } from "./vault-repo";

export interface SavePoiResult {
  place: PlaceRecord;
  file: TFile;
  created: boolean;
}

export class PlaceService {
  constructor(
    private readonly index: TravelIndex,
    private readonly repo: VaultRepository
  ) {}

  findExisting(poi: AmapPoi): PlaceRecord | undefined {
    if (poi.id) {
      const byAmap = this.index.findPlaceByAmapId(poi.id);
      if (byAmap) return byAmap;
    }
    const adcode = normalizeAdcode(poi.adcode) ?? adcodeFromNames(poi.pname, poi.cityname);
    const name = poi.name?.trim();
    if (!name) return undefined;
    return this.index
      .getPlaces()
      .find((place) => place.name === name && (!adcode || place.adcode === adcode));
  }

  /**
   * Saving is idempotent on the AMap POI id (and on name+adcode when AMap
   * rotates its ids). Existing archives are opened instead of duplicated.
   */
  async savePoi(poi: AmapPoi, options: { visited?: boolean } = {}): Promise<SavePoiResult> {
    const existing = this.findExisting(poi);
    if (existing) {
      const file = this.repo.getFile(existing.filePath);
      if (file) return { place: existing, file, created: false };
    }

    const name = poi.name?.trim();
    if (!name) throw new Error("高德返回的地点没有名称，无法建立档案");

    const adcode = normalizeAdcode(poi.adcode) ?? adcodeFromNames(poi.pname, poi.cityname);
    const coordinate = parseAmapLocation(poi.location);
    const province = provinceNameOf(adcode) ?? poi.pname;
    const city = cityNameOf(adcode) ?? poi.cityname;
    const district = poi.adname?.trim() || undefined;
    const id = generateUniqueId((candidate) => this.index.hasId(candidate));
    const now = toLocalIsoString();
    const bucket = shortRegionName(city || province || "") || "未分类";

    const frontmatter: Record<string, unknown> = {
      kind: "place",
      schema_version: 1,
      id,
      name,
      aliases: [],
      amap_poi_id: poi.id || undefined,
      province,
      city,
      district,
      adcode,
      lat: coordinate?.lat,
      lng: coordinate?.lng,
      coordinate_system: "GCJ-02",
      coord_source: "amap",
      visited: options.visited ?? true,
      tags: ["旅游/景点"],
      created: now,
      updated: now,
    };

    const regionLine = [province, city, district].filter(Boolean).join(" / ");
    const coordinateLine = coordinate
      ? `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}（GCJ-02）`
      : "坐标未知";
    const body = `# ${name}\n\n> ${regionLine || "行政区未知"} · ${coordinateLine}\n\n` +
      `在命令面板运行「新建旅行日志」，或在旅行时间线中为这个地点添加记录。\n`;

    const folder = this.repo.placeFolder(bucket);
    const file = await this.repo.createNote(
      folder,
      sanitizeFileName(name, "未命名地点"),
      frontmatter,
      body
    );
    await this.index.refreshFile(file);
    const place = this.index.getPlace(id);
    if (!place) throw new Error("地点档案写入后未能进入索引，请运行「重建旅游索引」");
    return { place, file, created: true };
  }

  async setVisited(placeId: string, visited: boolean): Promise<void> {
    const place = this.index.getPlace(placeId);
    if (!place) throw new Error(`地点不存在：${placeId}`);
    const file = this.repo.getFile(place.filePath);
    if (!file) throw new Error(`地点档案文件不存在：${place.filePath}`);
    await this.repo.setFrontmatter(file, {
      visited,
      updated: toLocalIsoString(),
    });
    await this.index.refreshFile(file);
  }

  async setAliases(placeId: string, aliases: string[]): Promise<void> {
    const place = this.index.getPlace(placeId);
    if (!place) throw new Error(`地点不存在：${placeId}`);
    const file = this.repo.getFile(place.filePath);
    if (!file) throw new Error(`地点档案文件不存在：${place.filePath}`);
    await this.repo.setFrontmatter(file, {
      aliases,
      updated: toLocalIsoString(),
    });
    await this.index.refreshFile(file);
  }
}
