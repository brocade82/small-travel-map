import { requestUrl } from "obsidian";
import fs from "node:fs";
import path from "node:path";
import type {
  AmapKeys,
  AmapPoi,
  AmapSearchResult,
  AmapSuggestion,
  QuotaSnapshot,
  TravelMapSettings,
} from "../types";
import { AmapError } from "../types";
import { monthKey, todayIso } from "../core/dates";
import { filterSuggestions, rankPois } from "../core/amap-rank";
import { isPathInside, redactSecrets } from "../core/security";

const API_BASE = "https://restapi.amap.com";
const CACHE_LIMIT = 50;
const MIN_INTERVAL_MS = 350;

interface QuotaStore {
  day: string;
  month: string;
  dayCount: number;
  monthCount: number;
}

type KeySource = "env" | "file" | "mixed" | "none";

interface KeyStatus {
  web: boolean;
  js: boolean;
  security: boolean;
  source: KeySource;
  configPath: string;
  configError?: string;
}

function envValue(name: string): string | undefined {
  try {
    if (typeof process !== "undefined" && process.env) {
      const value = process.env[name];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }
  } catch {
    // process may be unavailable in a future sandboxed renderer.
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class AmapWebService {
  private keys: AmapKeys = {};
  private keySource: KeySource = "none";
  private keysLoaded = false;
  private configError: string | null = null;
  private quota: QuotaStore;
  private sessionCount = 0;
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private searchCache = new Map<string, AmapSearchResult>();
  private suggestionCache = new Map<string, AmapSuggestion[]>();

  constructor(
    private readonly settings: () => TravelMapSettings,
    private readonly vaultName: string,
    private readonly onQuotaChange?: () => void,
    private readonly vaultBasePath?: () => string | null
  ) {
    this.quota = this.loadQuota();
  }

  private storageKey(): string {
    return `travel-map:quota:${this.vaultName}`;
  }

  private loadQuota(): QuotaStore {
    const today = todayIso();
    const month = monthKey();
    try {
      const raw = window.localStorage.getItem(this.storageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<QuotaStore>;
        return {
          day: parsed.day === today ? today : today,
          month: parsed.month === month ? month : month,
          dayCount: parsed.day === today ? Number(parsed.dayCount) || 0 : 0,
          monthCount: parsed.month === month ? Number(parsed.monthCount) || 0 : 0,
        };
      }
    } catch {
      // Ignore corrupt counters; they are diagnostics, not travel data.
    }
    return { day: today, month, dayCount: 0, monthCount: 0 };
  }

  private saveQuota(): void {
    try {
      window.localStorage.setItem(this.storageKey(), JSON.stringify(this.quota));
    } catch {
      // Quota counters are best effort.
    }
  }

  private rollQuotaWindow(): void {
    const today = todayIso();
    const month = monthKey();
    if (this.quota.day !== today) {
      this.quota.day = today;
      this.quota.dayCount = 0;
    }
    if (this.quota.month !== month) {
      this.quota.month = month;
      this.quota.monthCount = 0;
    }
  }

  private readKeyFile(): AmapKeys {
    const configured = this.settings().amapConfigPath?.trim();
    this.configError = null;
    if (!configured) return {};
    const vaultBase = this.vaultBasePath?.();
    if (vaultBase && isPathInside(vaultBase, configured)) {
      this.configError = "Key 文件不能放在 Vault 内；已拒绝读取，请移到 Vault 外再试。";
      console.warn("[travel-map] 拒绝读取 Vault 内的 Key 文件：", configured);
      return {};
    }
    const filePath = path.resolve(configured);
    try {
      if (!fs.existsSync(filePath)) return {};
      const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        webKey:
          firstString(parsed.webKey) ??
          firstString(parsed.web_key) ??
          firstString(parsed.AMAP_WEB_KEY),
        jsKey:
          firstString(parsed.jsKey) ??
          firstString(parsed.js_key) ??
          firstString(parsed.AMAP_JS_KEY),
        securityCode:
          firstString(parsed.securityCode) ??
          firstString(parsed.security_code) ??
          firstString(parsed.AMAP_SECURITY_CODE),
      };
    } catch (error) {
      console.warn(
        `[travel-map] 无法读取高德 Key 配置文件（不会显示内容）：${filePath}`,
        redactSecrets((error as Error).message)
      );
      return {};
    }
  }

  async refreshKeys(): Promise<void> {
    const fromEnv: AmapKeys = {
      webKey: envValue("AMAP_WEB_KEY"),
      jsKey: envValue("AMAP_JS_KEY"),
      securityCode: envValue("AMAP_SECURITY_CODE"),
    };
    const fromFile = this.readKeyFile();
    this.keys = {
      webKey: fromEnv.webKey ?? fromFile.webKey,
      jsKey: fromEnv.jsKey ?? fromFile.jsKey,
      securityCode: fromEnv.securityCode ?? fromFile.securityCode,
    };
    const envUsed = Boolean(fromEnv.webKey || fromEnv.jsKey || fromEnv.securityCode);
    const fileUsed = Boolean(fromFile.webKey || fromFile.jsKey || fromFile.securityCode);
    this.keySource = envUsed && fileUsed ? "mixed" : envUsed ? "env" : fileUsed ? "file" : "none";
    this.keysLoaded = true;
    console.debug("[travel-map] 高德 Key 状态", {
      web: Boolean(this.keys.webKey),
      js: Boolean(this.keys.jsKey),
      security: Boolean(this.keys.securityCode),
      source: this.keySource,
    });
  }

  private async ensureKeys(): Promise<void> {
    if (!this.keysLoaded) await this.refreshKeys();
  }

  async keyStatus(): Promise<KeyStatus> {
    await this.ensureKeys();
    return {
      web: Boolean(this.keys.webKey),
      js: Boolean(this.keys.jsKey),
      security: Boolean(this.keys.securityCode),
      source: this.keySource,
      configPath: this.settings().amapConfigPath,
      configError: this.configError ?? undefined,
    };
  }

  async jsCredentials(): Promise<{ jsKey?: string; securityCode?: string }> {
    await this.ensureKeys();
    return { jsKey: this.keys.jsKey, securityCode: this.keys.securityCode };
  }

  isOffline(): boolean {
    try {
      return typeof navigator !== "undefined" && navigator.onLine === false;
    } catch {
      return false;
    }
  }

  quotaSnapshot(): QuotaSnapshot {
    this.rollQuotaWindow();
    return {
      day: this.quota.day,
      month: this.quota.month,
      dayCount: this.quota.dayCount,
      monthCount: this.quota.monthCount,
      sessionCount: this.sessionCount,
      sessionLimit: this.sessionLimit(),
    };
  }

  private sessionLimit(): number {
    const configured = Number(this.settings().sessionSearchLimit);
    if (!Number.isFinite(configured)) return 60;
    return Math.min(500, Math.max(1, Math.trunc(configured)));
  }

  resetSessionCount(): void {
    this.sessionCount = 0;
    this.onQuotaChange?.();
  }

  resetAllCounters(): void {
    this.sessionCount = 0;
    this.quota = { day: todayIso(), month: monthKey(), dayCount: 0, monthCount: 0 };
    this.saveQuota();
    this.onQuotaChange?.();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task) as Promise<T>;
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async throttle(): Promise<void> {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private remember<K, V>(cache: Map<K, V>, key: K, value: V): void {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  private async call(
    endpoint: string,
    params: Record<string, string | undefined>
  ): Promise<Record<string, unknown>> {
    await this.ensureKeys();
    if (this.isOffline()) {
      throw new AmapError("offline", "当前离线，搜索与地图都不可用；本地档案仍可浏览。");
    }
    if (!this.keys.webKey) {
      throw new AmapError(
        "key",
        "未配置高德 Web 服务 Key。请在环境变量 AMAP_WEB_KEY 或库外配置文件中配置。"
      );
    }
    if (this.sessionCount >= this.sessionLimit()) {
      throw new AmapError(
        "quota",
        "本次会话搜索次数已达上限，可重启视图继续。"
      );
    }

    const query = new URLSearchParams();
    query.set("key", this.keys.webKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, value);
    }
    const url = `${API_BASE}${endpoint}?${query.toString()}`;

    let response;
    try {
      response = await requestUrl({ url, method: "GET", throw: false });
    } catch (error) {
      throw new AmapError(
        "network",
        `高德请求失败：${redactSecrets((error as Error).message ?? "") || "网络不可达"}`
      );
    }

    this.sessionCount += 1;
    this.rollQuotaWindow();
    this.quota.dayCount += 1;
    this.quota.monthCount += 1;
    this.saveQuota();
    this.onQuotaChange?.();

    if (response.status !== 200) {
      throw new AmapError("network", `高德服务返回 HTTP ${response.status}`);
    }

    let data: Record<string, unknown>;
    try {
      data = response.json as Record<string, unknown>;
    } catch (error) {
      throw new AmapError("server", "高德返回的不是有效 JSON");
    }

    const infocode = firstString(data.infocode);
    const info = firstString(data.info);
    console.debug("[travel-map] 高德请求", {
      endpoint,
      status: data.status,
      infocode,
      session: this.sessionCount,
      day: this.quota.dayCount,
      month: this.quota.monthCount,
    });

    if (data.status !== "1") {
      throw this.classifyError(infocode, info);
    }
    return data;
  }

  private classifyError(infocode?: string, info?: string): AmapError {
    const token = `${infocode ?? ""} ${info ?? ""}`.toUpperCase();
    const keyProblem =
      token.includes("INVALID_USER_KEY") ||
      token.includes("INVALID_USER_SCODE") ||
      token.includes("INVALID_USER_SIGNATURE") ||
      token.includes("USERKEY_PLAT_NOMATCH") ||
      token.includes("INVALID_USER_DOMAIN") ||
      token.includes("SERVICE_NOT_AVAILABLE") ||
      ["10001", "10002", "10005", "10009", "10013", "10021"].includes(infocode ?? "");
    const quotaProblem =
      token.includes("OVER_LIMIT") ||
      token.includes("OVER_QUOTA") ||
      token.includes("QUOTA") ||
      token.includes("TOO_FREQUENT") ||
      token.includes("DAILY") ||
      ["10003", "10004", "10010", "10044", "10045"].includes(infocode ?? "");

    if (keyProblem) {
      return new AmapError(
        "key",
        "高德 Key 未配置、类型不对或已失效，请到设置页检查（Key 不回显）。",
        infocode,
        info
      );
    }
    if (quotaProblem) {
      return new AmapError(
        "quota",
        "高德接口额度已用完或请求过于频繁；可以继续手写记录，明天再试。",
        infocode,
        info
      );
    }
    return new AmapError(
      "server",
      `高德接口返回错误：${redactSecrets(info || infocode || "未知错误")}`,
      infocode,
      info
    );
  }

  async search(
    keywords: string,
    options: { city?: string } = {}
  ): Promise<AmapSearchResult> {
    const query = keywords.trim();
    if (!query) return { count: "0", pois: [] };
    const settings = this.settings();
    const city = options.city?.trim() || undefined;
    const types = settings.poiTypes?.trim() || undefined;
    const cacheKey = `p|${city ?? ""}|${types ?? ""}|${query.toLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      this.remember(this.searchCache, cacheKey, cached);
      return cached;
    }

    return this.enqueue(async () => {
      const data = await this.call("/v3/place/text", {
        keywords: query,
        types,
        city,
        citylimit: city ? "true" : undefined,
        offset: "20",
        page: "1",
        extensions: "all",
        output: "json",
      });
      const pois = Array.isArray(data.pois)
        ? (data.pois as Array<Record<string, unknown>>)
            .map((poi) => this.toPoi(poi))
            .filter((poi) => Boolean(poi.name))
        : [];
      const ranked = rankPois(pois, query, city);
      const result: AmapSearchResult = {
        count: firstString(data.count) ?? String(pois.length),
        pois: ranked,
      };
      this.remember(this.searchCache, cacheKey, result);
      return result;
    });
  }

  private toPoi(poi: Record<string, unknown>): AmapPoi {
    return {
      id: firstString(poi.id) ?? "",
      name: firstString(poi.name) ?? "",
      type: firstString(poi.type),
      typecode: firstString(poi.typecode),
      address: firstString(poi.address),
      location: firstString(poi.location),
      pname: firstString(poi.pname),
      cityname: firstString(poi.cityname),
      adname: firstString(poi.adname),
      adcode: firstString(poi.adcode),
      pcode: firstString(poi.pcode),
      citycode: firstString(poi.citycode),
      tel: firstString(poi.tel),
      photos: Array.isArray(poi.photos)
        ? (poi.photos as Array<Record<string, unknown>>).map((photo) => ({
            title: firstString(photo.title),
            url: firstString(photo.url),
          }))
        : undefined,
      biz_ext:
        poi.biz_ext && typeof poi.biz_ext === "object"
          ? { rating: firstString((poi.biz_ext as Record<string, unknown>).rating) }
          : undefined,
    };
  }

  async suggest(
    keywords: string,
    options: { city?: string } = {}
  ): Promise<AmapSuggestion[]> {
    const query = keywords.trim();
    if (query.length < 2) return [];
    const city = options.city?.trim() || undefined;
    const cacheKey = `s|${city ?? ""}|${query.toLowerCase()}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached) {
      this.remember(this.suggestionCache, cacheKey, cached);
      return cached;
    }

    return this.enqueue(async () => {
      const data = await this.call("/v3/assistant/inputtips", {
        keywords: query,
        city,
        citylimit: city ? "true" : undefined,
        datatype: "poi",
        output: "json",
      });
      const tips = Array.isArray(data.tips)
        ? (data.tips as Array<Record<string, unknown>>)
            .map((tip) => ({
              id: firstString(tip.id),
              name: firstString(tip.name) ?? "",
              district: firstString(tip.district),
              adcode: firstString(tip.adcode),
              location: firstString(tip.location),
              address: firstString(tip.address),
              typecode: firstString(tip.typecode),
              cityname: firstString(tip.cityname),
            }))
            .filter((tip) => Boolean(tip.name))
        : [];
      const filtered = filterSuggestions(tips, query).slice(0, 10);
      this.remember(this.suggestionCache, cacheKey, filtered);
      return filtered;
    });
  }
}
