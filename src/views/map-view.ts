import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type TravelMapPlugin from "../main";
import type { AmapPoi, AmapSuggestion } from "../types";
import { AmapError } from "../types";
import {
  loadAmapJs,
  resetAmapLoader,
  type AmapMapInstance,
  type AmapMarkerInstance,
  type AmapNamespace,
} from "../services/amap-js";
import {
  createBanner,
  createButton,
  createEmptyState,
  errorText,
  formatQuotaText,
  type BannerKind,
} from "../ui/dom";
import {
  createOfflineOverview,
  renderOfflineMapError,
  type OfflineOverviewHandle,
  type OfflineSelection,
} from "../ui/leaflet-overview";
import { clearMapLogPanel, showMapLogPanel } from "../ui/map-logs";
import { queryMatchesSubSuffix } from "../core/amap-rank";
import { rollup } from "../core/regions";
import type { VisitedState } from "../core/visited";
import { PlaceDetailModal } from "../ui/modals/place-modal";
import { JournalModal } from "../ui/modals/journal-modal";
import { pickPlaceForJournal } from "../ui/modals/place-picker";

export const TRAVEL_MAP_VIEW_TYPE = "travel-map-view";

type ViewMode = "map" | "overview";

export class TravelMapView extends ItemView {
  private readonly plugin: TravelMapPlugin;
  private mode: ViewMode = "overview";
  private built = false;
  private map: AmapMapInstance | null = null;
  private AMap: AmapNamespace | null = null;
  private markers: AmapMarkerInstance[] = [];
  private fitOnce = false;
  private mapLoading = false;
  private mapError: string | null = null;
  private pendingMapLoad = false;
  private mapIdleTimer: number | null = null;
  private mapLoadCount = 0;
  private offlineMap: OfflineOverviewHandle | null = null;
  private offlineMapLoading = false;
  private offlineMapFailed = false;
  private offlineRefreshSeq = 0;
  private sidebarCollapsed = false;
  private searchCollapsed = false;

  private mapEl!: HTMLElement;
  private overviewEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private searchSectionEl!: HTMLElement;
  private sidebarToggle!: HTMLButtonElement;
  private searchToggle!: HTMLButtonElement;
  private sidebarStats!: HTMLElement;
  private suggestionsEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private quotaTextEl!: HTMLElement;
  private queryInput!: HTMLInputElement;
  private cityInput!: HTMLInputElement;
  private searchButton!: HTMLButtonElement;
  private mapButton!: HTMLButtonElement;
  private overviewButton!: HTMLButtonElement;
  private statusChip!: HTMLElement;
  private includeSubPoisInput!: HTMLInputElement;
  private includeSubPois = false;

  private searchTimer: number | null = null;
  private bannerTimer: number | null = null;
  private suggestionToken = 0;
  private searchToken = 0;
  private offIndex: (() => void) | null = null;
  private results: AmapPoi[] = [];
  private lastCount = "";
  private lastQuery = "";
  private focusRequested = false;

  constructor(leaf: WorkspaceLeaf, plugin: TravelMapPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRAVEL_MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "旅游地图";
  }

  getIcon(): string {
    return "map";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("travel-map-view");
    const initial = (this.leaf.getViewState() as { state?: { mode?: string } }).state?.mode;
    if (initial === "overview" || initial === "map") this.mode = initial;
    await this.plugin.index.whenReady();
    this.buildUi();
    this.offIndex = this.plugin.index.onChange(() => {
      this.refreshAll();
    });
    this.refreshAll();
    if (this.focusRequested) {
      this.focusRequested = false;
      this.focusSearch();
    }
    if (this.pendingMapLoad) {
      this.pendingMapLoad = false;
      void this.ensureMap();
    } else if (this.mode === "map") {
      // Restored layouts must not silently initialize a billable map instance.
      this.mode = "overview";
      this.updateModeButtons();
      this.updateVisibility();
      this.refreshAll();
    }
  }

  onClose(): Promise<void> {
    this.offIndex?.();
    this.offIndex = null;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.offlineMap?.destroy();
    this.offlineMap = null;
    this.destroyMap();
    this.contentEl.empty();
    return Promise.resolve();
  }

  getState(): Record<string, unknown> {
    return {
      mode: this.mode,
      sidebarCollapsed: this.sidebarCollapsed,
      searchCollapsed: this.searchCollapsed,
    };
  }

  async setState(state: any, result: any): Promise<void> {
    if (state && (state.mode === "map" || state.mode === "overview")) {
      this.mode = state.mode;
    }
    if (state?.sidebarCollapsed === true || state?.sidebarCollapsed === false) {
      this.sidebarCollapsed = state.sidebarCollapsed;
    }
    if (state?.searchCollapsed === true || state?.searchCollapsed === false) {
      this.searchCollapsed = state.searchCollapsed;
    }
    if (this.built) {
      this.applyLayoutState();
      this.updateModeButtons();
      this.updateVisibility();
      this.refreshAll();
    }
    await super.setState(state, result);
  }

  refresh(): void {
    // Settings/index refresh may have added or changed a map pack; retry once.
    if (this.offlineMapFailed) this.offlineMapFailed = false;
    this.refreshAll();
  }

  focusSearch(): void {
    if (!this.built) {
      this.focusRequested = true;
      return;
    }
    window.setTimeout(() => {
      this.queryInput?.focus();
      this.queryInput?.select();
    }, 60);
  }

  private buildUi(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "travel-map__header" });
    const heading = header.createDiv({ cls: "travel-map__heading" });
    const icon = heading.createSpan({ cls: "travel-map__icon" });
    setIcon(icon, "map");
    heading.createEl("h2", { text: "旅游地图" });

    const modeBar = header.createDiv({ cls: "travel-map__modebar" });
    this.sidebarToggle = modeBar.createEl("button", {
      cls: "travel-mode-button travel-sidebar-toggle",
      text: this.sidebarCollapsed ? "展开侧栏" : "收起侧栏",
    });
    this.sidebarToggle.type = "button";
    this.sidebarToggle.addEventListener("click", () => this.toggleSidebar());
    this.mapButton = modeBar.createEl("button", {
      cls: "travel-mode-button",
      text: "在线地图",
    });
    this.mapButton.type = "button";
    this.mapButton.addEventListener("click", () => this.switchMode("map"));
    this.overviewButton = modeBar.createEl("button", {
      cls: "travel-mode-button",
      text: "点亮总览",
    });
    this.overviewButton.type = "button";
    this.overviewButton.addEventListener("click", () => this.switchMode("overview"));
    this.statusChip = header.createSpan({ cls: "travel-status-chip", text: "离线总览" });

    const body = contentEl.createDiv({ cls: "travel-map__body" });
    this.bodyEl = body;
    const sidebar = body.createDiv({ cls: "travel-map__sidebar" });
    this.sidebarEl = sidebar;

    const searchSection = sidebar.createDiv({ cls: "travel-search" });
    this.searchSectionEl = searchSection;
    const searchHead = searchSection.createDiv({ cls: "travel-search__head" });
    const searchTitles = searchHead.createDiv({ cls: "travel-search__titles" });
    searchTitles.createDiv({ cls: "travel-search__title", text: "搜索并保存地点" });
    searchTitles.createDiv({
      cls: "travel-search__hint",
      text: "输入至少 2 个字停顿 350ms 出联想；按回车取结果。",
    });
    this.searchToggle = searchHead.createEl("button", {
      cls: "travel-search__toggle",
      attr: { type: "button", "aria-label": "收起搜索" },
    });
    setIcon(this.searchToggle, "chevron-up");
    this.searchToggle.addEventListener("click", () => this.toggleSearch());
    const searchBody = searchSection.createDiv({ cls: "travel-search__body" });
    this.queryInput = searchBody.createEl("input", {
      type: "search",
      cls: "travel-input travel-input--search",
      attr: { placeholder: "西湖、故宫、博物馆…" },
    });
    this.cityInput = searchBody.createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder: "限定城市（可选），例如 杭州" },
    });
    const searchActions = searchBody.createDiv({ cls: "travel-search__actions" });
    this.searchButton = createButton(
      searchActions,
      "搜索",
      () => void this.runSearch(),
      { cta: true, icon: "search" }
    );
    createButton(searchActions, "清空", () => this.clearSearch(), { icon: "x" });

    const resultOptions = searchBody.createDiv({ cls: "travel-search__options" });
    this.includeSubPoisInput = resultOptions.createEl("input", { type: "checkbox" });
    this.includeSubPoisInput.id = "travel-map-include-sub-pois";
    resultOptions.createEl("label", {
      text: "显示子景点（午门、钟表馆等）",
      attr: { for: "travel-map-include-sub-pois" },
    });
    this.includeSubPoisInput.addEventListener("change", () => {
      this.includeSubPois = this.includeSubPoisInput.checked;
      if (this.results.length > 0) {
        this.renderResults(this.results, this.lastCount);
      }
    });

    this.queryInput.addEventListener("input", () => this.onQueryInput());
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.runSearch();
      }
    });
    this.cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.runSearch();
      }
    });

    this.suggestionsEl = searchBody.createDiv({ cls: "travel-suggestions" });
    this.resultsEl = searchBody.createDiv({ cls: "travel-results" });
    this.sidebarStats = sidebar.createDiv({ cls: "travel-sidebar__stats" });

    const canvas = body.createDiv({ cls: "travel-map__canvas" });
    this.bannerEl = canvas.createDiv({ cls: "travel-map__banner" });
    this.mapEl = canvas.createDiv({ cls: "travel-map__map is-hidden" });
    this.overviewEl = canvas.createDiv({ cls: "travel-map__overview" });

    const footer = canvas.createDiv({ cls: "travel-map__footer" });
    this.quotaTextEl = footer.createSpan({ cls: "travel-map__quota", text: "" });
    createButton(footer, "重置会话计数", () => {
      this.plugin.amap.resetSessionCount();
      this.updateFooter();
    }, { cls: "travel-button--small" });

    this.built = true;
    this.applyLayoutState();
    this.updateModeButtons();
    this.updateVisibility();
  }

  private toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.applyLayoutState();
    window.setTimeout(() => {
      this.offlineMap?.invalidateSize();
      (this.map as unknown as { resize?: () => void })?.resize?.();
    }, 0);
  }

  private toggleSearch(): void {
    this.searchCollapsed = !this.searchCollapsed;
    this.applyLayoutState();
  }

  private applyLayoutState(): void {
    if (!this.built) return;
    this.bodyEl.toggleClass(
      "travel-map__body--sidebar-collapsed",
      this.sidebarCollapsed
    );
    this.sidebarEl.toggleClass("is-collapsed", this.sidebarCollapsed);
    this.searchSectionEl.toggleClass("is-collapsed", this.searchCollapsed);
    this.sidebarToggle.setText(this.sidebarCollapsed ? "展开侧栏" : "收起侧栏");
    this.searchToggle.empty();
    setIcon(this.searchToggle, this.searchCollapsed ? "chevron-down" : "chevron-up");
    this.searchToggle.setAttribute(
      "aria-label",
      this.searchCollapsed ? "展开搜索" : "收起搜索"
    );
  }

  private refreshAll(): void {
    if (!this.built) return;
    const state = this.plugin.visited.compute();
    const counts = this.plugin.index.getCounts();
    this.updateStats(
      counts,
      state.provinceCounts.size,
      state.cityCounts.size,
      state.countyCounts.size
    );
    this.updateFooter();
    this.updateModeButtons();
    this.updateVisibility();
    const mapActive = this.mode === "map" && Boolean(this.map);
    if (!mapActive) {
      if (this.offlineMap) {
        this.offlineMap.update(state);
      } else if (!this.offlineMapLoading && !this.offlineMapFailed) {
        void this.ensureOfflineOverview(state, counts.logs);
      } else if (this.offlineMapFailed) {
        // The error panel was already rendered by ensureOfflineOverview; do not
        // fall back to a built-in boundary map in the user-map-pack release.
      }
    } else {
      clearMapLogPanel(this.overviewEl);
    }
    if (this.map) this.renderMarkers();
  }

  private async ensureOfflineOverview(
    state: VisitedState,
    logsCount: number
  ): Promise<void> {
    if (this.offlineMap || this.offlineMapLoading) return;
    this.offlineMapLoading = true;
    try {
      this.overviewEl.addClass("travel-map__overview--leaflet");
      this.offlineMap = await createOfflineOverview(this.overviewEl, this.plugin, {
        state,
        logsCount,
        onSelect: (selection) => this.showOfflineSelection(selection),
      });
      this.offlineMapFailed = false;
      this.offlineMap.invalidateSize();
    } catch (error) {
      this.offlineMapFailed = true;
      this.overviewEl.removeClass("travel-map__overview--leaflet");
      renderOfflineMapError(this.overviewEl, errorText(error));
      new Notice(`离线地图加载失败：${errorText(error)}`);
    } finally {
      this.offlineMapLoading = false;
    }
  }

  private updateStats(
    counts: { places: number; logs: number; trips: number; legacy: number },
    litProvinces: number,
    litCities: number,
    litCounties: number
  ): void {
    this.sidebarStats.empty();
    this.sidebarStats.createDiv({
      cls: "travel-sidebar__stats-title",
      text: "当前档案",
    });
    const grid = this.sidebarStats.createDiv({ cls: "travel-sidebar__stats-grid" });
    for (const [label, value] of [
      ["地点", counts.places],
      ["日志", counts.logs],
      ["行程", counts.trips],
    ] as const) {
      const cell = grid.createDiv({ cls: "travel-sidebar__stat" });
      cell.createDiv({ cls: "travel-sidebar__stat-value", text: String(value) });
      cell.createDiv({ cls: "travel-sidebar__stat-label", text: label });
    }
    this.sidebarStats.createDiv({
      cls: "travel-sidebar__lit",
      text: `已点亮 ${litProvinces} 个省 · ${litCities} 个市 · ${litCounties} 个区县`,
    });
    if (counts.legacy > 0) {
      this.sidebarStats.createDiv({
        cls: "travel-sidebar__legacy",
        text: `${counts.legacy} 篇普通笔记只读兼容`,
      });
    }
    const actions = this.sidebarStats.createDiv({ cls: "travel-sidebar__actions" });
    createButton(actions, "地图日志", () => this.showAllMapLogs(), {
      icon: "list",
    });
    createButton(actions, "打开时间线", () => this.plugin.openTimeline(), {
      icon: "calendar-days",
    });
    createButton(actions, "新建行程", () => this.plugin.openNewTrip(), {
      icon: "route",
    });
  }

  private updateFooter(): void {
    if (!this.built) return;
    this.quotaTextEl.setText(
      `${formatQuotaText(this.plugin.amap.quotaSnapshot())} · 地图初始化 ${this.mapLoadCount} 次`
    );
  }

  private updateModeButtons(): void {
    if (!this.built) return;
    this.mapButton.classList.toggle("is-active", this.mode === "map");
    this.overviewButton.classList.toggle("is-active", this.mode === "overview");
    if (this.mapLoading) {
      this.statusChip.setText("加载中…");
      this.statusChip.className = "travel-status-chip is-loading";
    } else if (this.map && this.mode === "map") {
      this.statusChip.setText("在线地图");
      this.statusChip.className = "travel-status-chip is-online";
    } else if (this.mapError && this.mode === "map") {
      this.statusChip.setText("离线降级");
      this.statusChip.className = "travel-status-chip is-offline";
    } else {
      this.statusChip.setText("离线总览");
      this.statusChip.className = "travel-status-chip is-offline";
    }
  }

  private updateVisibility(): void {
    if (!this.built) return;
    const mapActive = this.mode === "map" && Boolean(this.map);
    this.mapEl.toggleClass("is-hidden", !mapActive);
    this.overviewEl.toggleClass("is-hidden", mapActive);
    if (mapActive) {
      (this.map as unknown as { resize?: () => void })?.resize?.();
    }
  }

  /** Public so callers can open the view directly in a chosen mode. */
  setMode(mode: ViewMode): void {
    this.mode = mode;
    if (!this.built) {
      if (mode === "map") this.pendingMapLoad = true;
      return;
    }
    if (mode === "overview") {
      this.pendingMapLoad = false;
      // Keep the already-initialised instance hidden. Destroying it here would
      // make switching back consume another billable map initialisation.
      this.updateModeButtons();
      this.updateVisibility();
      this.refreshAll();
      window.setTimeout(() => this.offlineMap?.invalidateSize(), 0);
      return;
    }
    this.pendingMapLoad = false;
    this.updateModeButtons();
    this.updateVisibility();
    if (this.map) this.renderMarkers();
    else void this.ensureMap();
  }

  private switchMode(mode: ViewMode): void {
    this.setMode(mode);
  }

  private async ensureMap(): Promise<void> {
    if (this.map || this.mapLoading) return;
    if (this.plugin.settings.mapMode === "offline") {
      // Deliberate offline mode is not an error: the overview is the product.
      this.mapError = null;
      this.updateModeButtons();
      this.updateVisibility();
      return;
    }
    this.mapLoading = true;
    this.mapError = null;
    this.updateModeButtons();
    this.showBanner("info", "正在加载高德 JS API…");
    try {
      const credentials = await this.plugin.amap.jsCredentials();
      if (!credentials.jsKey) {
        throw new Error(
          "未配置 JS API Key。Web 服务 Key 不能用于 JS API，需要在控制台单独创建。"
        );
      }
      const AMap = await loadAmapJs(credentials.jsKey, credentials.securityCode);
      this.mapEl.empty();
      const map = new AMap.Map(this.mapEl, {
        zoom: 4.4,
        center: [104.2, 35.6],
        viewMode: "2D",
        resizeEnable: true,
      });
      this.AMap = AMap;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
      const rendered =
        this.mapEl.children.length > 0 ||
        this.mapEl.querySelector(".amap-maps") !== null ||
        this.mapEl.querySelector("canvas") !== null;
      if (!rendered) {
        map.destroy();
        throw new Error(
          "地图容器没有渲染，可能是域名校验失败（INVALID_USER_DOMAIN）或脚本被 CSP 拦截。"
        );
      }
      this.map = map;
      this.mapError = null;
      this.fitOnce = false;
      this.mapLoadCount += 1;
      for (const event of ["click", "dragend", "zoomend", "movestart", "zoomstart"]) {
        map.on?.(event, () => this.armIdleTimer());
      }
      this.armIdleTimer();
      this.renderMarkers();
      this.updateVisibility();
      this.updateModeButtons();
      this.updateFooter();
      this.showBanner(
        "success",
        `高德地图已加载（本次会话第 ${this.mapLoadCount} 次初始化）。`
      );
      this.bannerTimer = window.setTimeout(() => this.clearBanner(), 3000);
    } catch (error) {
      this.map?.destroy();
      this.map = null;
      this.mapEl.empty();
      this.mapError = errorText(error);
      this.updateVisibility();
      this.updateModeButtons();
      this.showMapError();
    } finally {
      this.mapLoading = false;
      this.updateModeButtons();
    }
  }

  private showMapError(): void {
    const detail = (this.mapError ?? "未知错误").replace(/[。.!?！？]+$/u, "");
    const message = `在线地图不可用：${detail}。已显示离线总览，其它功能不受影响。`;
    this.showBanner("warning", message, [
      {
        label: "重试",
        cta: true,
        onClick: () => {
          resetAmapLoader();
          this.mapError = null;
          this.mapLoading = false;
          void this.ensureMap();
        },
      },
      { label: "打开设置", onClick: () => this.openPluginSettings() },
      {
        label: "仅用离线总览",
        onClick: () => this.switchMode("overview"),
      },
    ]);
  }

  private renderMarkers(): void {
    if (!this.map || !this.AMap) return;
    for (const marker of this.markers) {
      try {
        this.map.remove(marker);
      } catch {
        // Marker may already be gone after a map resize.
      }
    }
    this.markers = [];
    for (const place of this.plugin.index.getPlaces()) {
      if (typeof place.lat !== "number" || typeof place.lng !== "number") continue;
      const logCount = this.plugin.index.getLogsForPlace(place.id).length;
      const placeColor = /^#[0-9a-f]{6}$/i.test(this.plugin.settings.mapPlaceColor)
        ? this.plugin.settings.mapPlaceColor
        : "#ef4444";
      const marker = new this.AMap.Marker({
        position: [place.lng, place.lat],
        title: `${place.name}${logCount > 0 ? ` · ${logCount} 篇日志` : ""}`,
        map: this.map,
        anchor: "center",
        content: `<span class="travel-amap-dot" style="background:${placeColor}"></span>`,
      });
      marker.on?.("click", () => this.showPlaceLogs(place.id));
      this.markers.push(marker);
    }
    if (!this.fitOnce && this.markers.length > 0) {
      this.map.setFitView?.(this.markers, false, [60, 60, 60, 60]);
      this.fitOnce = true;
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    const minutes = Number(this.plugin.settings.mapIdleMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.mapIdleTimer = window.setTimeout(
      () => this.sleepOnlineMap(),
      Math.min(120, Math.max(1, minutes)) * 60_000
    );
  }

  private clearIdleTimer(): void {
    if (this.mapIdleTimer !== null) {
      window.clearTimeout(this.mapIdleTimer);
      this.mapIdleTimer = null;
    }
  }

  private sleepOnlineMap(): void {
    if (!this.map) return;
    const minutes = Math.min(
      120,
      Math.max(1, Number(this.plugin.settings.mapIdleMinutes) || 5)
    );
    this.destroyMap();
    this.mode = "overview";
    this.pendingMapLoad = false;
    this.updateModeButtons();
    this.updateVisibility();
    this.refreshAll();
    this.showBanner("info", `在线地图已休眠（${minutes} 分钟无操作）。`, [
      {
        label: "恢复在线地图",
        cta: true,
        onClick: () => this.setMode("map"),
      },
    ]);
  }

  private destroyMap(): void {
    this.clearIdleTimer();
    for (const marker of this.markers) {
      try {
        this.map?.remove(marker);
      } catch {
        // Ignore.
      }
    }
    this.markers = [];
    try {
      this.map?.destroy();
    } catch {
      // Ignore.
    }
    this.map = null;
    this.AMap = null;
  }

  private onQueryInput(): void {
    const value = this.queryInput.value.trim();
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.suggestionToken += 1;
    if (value.length < 2) {
      this.suggestionsEl.empty();
      return;
    }
    this.searchTimer = window.setTimeout(() => {
      void this.fetchSuggestions(value);
    }, 350);
  }

  private async fetchSuggestions(query: string): Promise<void> {
    const token = ++this.suggestionToken;
    this.suggestionsEl.empty();
    this.suggestionsEl.createDiv({
      cls: "travel-suggestion travel-suggestion--hint",
      text: "联想中…",
    });
    try {
      const suggestions = await this.plugin.amap.suggest(query, {
        city: this.cityInput.value.trim() || undefined,
      });
      if (token !== this.suggestionToken) return;
      this.suggestionsEl.empty();
      if (suggestions.length === 0) {
        this.suggestionsEl.createDiv({
          cls: "travel-suggestion travel-suggestion--hint",
          text: "没有联想结果。",
        });
        return;
      }
      for (const suggestion of suggestions.slice(0, 8)) {
        this.renderSuggestion(suggestion);
      }
    } catch (error) {
      if (token !== this.suggestionToken) return;
      this.suggestionsEl.empty();
      this.suggestionsEl.createDiv({
        cls: "travel-suggestion travel-suggestion--hint",
        text: this.describeAmapError(error),
      });
    }
  }

  private renderSuggestion(suggestion: AmapSuggestion): void {
    const button = this.suggestionsEl.createEl("button", {
      cls: "travel-suggestion",
    });
    button.type = "button";
    const main = button.createDiv({ cls: "travel-suggestion__main" });
    main.createSpan({ cls: "travel-suggestion__name", text: suggestion.name });
    const meta = [suggestion.district, suggestion.cityname].filter(Boolean).join(" · ");
    if (meta) main.createSpan({ cls: "travel-suggestion__meta", text: meta });
    button.addEventListener("click", () => {
      this.queryInput.value = suggestion.name;
      this.suggestionsEl.empty();
      void this.runSearch();
    });
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput.value.trim();
    if (!query) {
      new Notice("请输入要搜索的地点关键词。");
      return;
    }
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.suggestionToken += 1;
    this.suggestionsEl.empty();
    this.resultsEl.empty();
    this.resultsEl.createDiv({
      cls: "travel-suggestion travel-suggestion--hint",
      text: "搜索中…",
    });
    this.searchButton.disabled = true;
    const token = ++this.searchToken;
    try {
      const result = await this.plugin.amap.search(query, {
        city: this.cityInput.value.trim() || undefined,
      });
      if (token !== this.searchToken) return;
      this.results = result.pois;
      this.lastCount = result.count;
      this.lastQuery = query;
      this.renderResults(result.pois, result.count);
    } catch (error) {
      if (token !== this.searchToken) return;
      this.resultsEl.empty();
      this.handleAmapError(error);
    } finally {
      if (token === this.searchToken) this.searchButton.disabled = false;
    }
  }

  private renderResults(pois: AmapPoi[], count: string): void {
    this.resultsEl.empty();
    const query = this.lastQuery;
    const visible = this.includeSubPois
      ? pois
      : pois.filter((poi) => !poi.isSubPoi || queryMatchesSubSuffix(poi, query));
    const hidden = pois.length - visible.length;
    const header = this.resultsEl.createDiv({ cls: "travel-results__head" });
    header.createSpan({
      text: hidden > 0 ? `主景点 ${visible.length} 条 · 已隐藏 ${hidden} 个子景点` : `结果 ${visible.length} 条`,
    });
    if (count && count !== String(pois.length)) {
      header.createSpan({ cls: "travel-results__count", text: `高德返回 ${count}` });
    }
    if (visible.length === 0) {
      createEmptyState(
        this.resultsEl,
        "search",
        hidden > 0 ? "结果都是子景点" : "没有符合条件的地点",
        hidden > 0
          ? "勾选上方「显示子景点」可以查看午门、钟表馆这类附属点位。"
          : "高德没有返回结果，或 POI 分类白名单把结果过滤掉了。可在设置里调整分类码。"
      );
      return;
    }
    for (const poi of visible) {
      this.renderResultRow(poi);
    }
  }

  private renderResultRow(poi: AmapPoi): void {
    const existing = this.plugin.places.findExisting(poi);
    const row = this.resultsEl.createDiv({ cls: "travel-result" });
    if (poi.photos?.[0]?.url) {
      const thumb = row.createDiv({ cls: "travel-result__thumb" });
      const image = thumb.createEl("img", {
        attr: {
          src: poi.photos[0].url,
          alt: "",
          loading: "lazy",
          referrerpolicy: "no-referrer",
        },
      });
      image.addEventListener("error", () => thumb.remove());
    }
    const main = row.createDiv({ cls: "travel-result__main" });
    const nameRow = main.createDiv({ cls: "travel-result__name-row" });
    nameRow.createDiv({ cls: "travel-result__name", text: poi.name });
    if (poi.isSubPoi) {
      nameRow.createSpan({ cls: "travel-badge travel-badge--sub", text: "子景点" });
    }
    const meta = [poi.pname, poi.cityname, poi.adname].filter(Boolean).join(" · ");
    if (meta) main.createDiv({ cls: "travel-result__meta", text: meta });
    if (poi.type) main.createDiv({ cls: "travel-result__type", text: poi.type });
    if (poi.address) {
      main.createDiv({
        cls: "travel-result__address",
        text: Array.isArray(poi.address) ? poi.address.join(" ") : poi.address,
      });
    }
    const extra: string[] = [];
    if (poi.location) extra.push(`坐标 ${poi.location}`);
    if (poi.biz_ext?.rating) extra.push(`评分 ${poi.biz_ext.rating}`);
    if (extra.length > 0) {
      main.createDiv({ cls: "travel-result__extra", text: extra.join(" · ") });
    }

    const actions = row.createDiv({ cls: "travel-result__actions" });
    if (existing) {
      createButton(actions, "打开档案", () => this.openPlace(existing.id), {
        icon: "folder-open",
      });
    } else {
      createButton(
        actions,
        "保存地点",
        () => {
          void this.savePoi(poi);
        },
        { cta: true, icon: "plus" }
      );
    }
    if (this.map) {
      createButton(actions, "定位", () => this.focusPoi(poi), {
        icon: "crosshair",
      });
    }
  }

  private async savePoi(poi: AmapPoi): Promise<void> {
    try {
      const result = await this.plugin.places.savePoi(poi);
      new Notice(
        result.created
          ? `已保存地点：${result.place.name}`
          : `地点已存在，打开档案：${result.place.name}`
      );
      this.refreshAll();
      this.renderResults(this.results, this.lastCount);
      this.openPlace(result.place.id);
    } catch (error) {
      new Notice(`保存地点失败：${errorText(error)}`);
    }
  }

  private focusPoi(poi: AmapPoi): void {
    if (!this.map || !poi.location) return;
    const [lng, lat] = poi.location.split(",").map((part) => Number(part.trim()));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    this.map.setZoomAndCenter?.(13, [lng, lat]);
  }

  private showOfflineSelection(selection: OfflineSelection): void {
    if (selection.level === "place" && selection.placeId) {
      this.showPlaceLogs(selection.placeId);
      return;
    }
    if (!selection.adcode) return;
    const adcode = selection.adcode;
    const places = this.plugin.index.getPlaces().filter((place) => {
      const rolled = rollup(place.adcode);
      if (selection.level === "province") return rolled.province === adcode;
      if (selection.level === "city") {
        return rolled.city === adcode || place.adcode === adcode;
      }
      return rolled.county === adcode || place.adcode === adcode;
    });
    const placeIds = new Set(places.map((place) => place.id));
    const logs = this.plugin.index
      .getLogs()
      .filter((log) => placeIds.has(log.placeId))
      .sort((a, b) => (b.visitedStart ?? b.date ?? "").localeCompare(a.visitedStart ?? a.date ?? ""));
    showMapLogPanel(this.overviewEl, `${selection.name ?? adcode} · 旅行日志`, {
      logs,
      places,
      onOpenLog: (logId) => this.openLog(logId),
      onNewLog: (placeId) => this.openNewLog(placeId),
      onNewTrip: () => this.plugin.openNewTrip(),
      onOpenPlace: (placeId) => this.openPlace(placeId),
    });
  }

  private showPlaceLogs(placeId: string): void {
    const place = this.plugin.index.getPlace(placeId);
    if (!place) return;
    const logs = this.plugin.index
      .getLogsForPlace(placeId)
      .sort((a, b) => (b.visitedStart ?? b.date ?? "").localeCompare(a.visitedStart ?? a.date ?? ""));
    showMapLogPanel(
      this.mode === "map" && this.map ? this.mapEl : this.overviewEl,
      `${place.name} · 旅行日志`,
      {
        logs,
        places: [place],
        onOpenLog: (logId) => this.openLog(logId),
        onNewLog: (placeId) => this.openNewLog(placeId),
        onNewTrip: () => this.plugin.openNewTrip(),
        onOpenPlace: (placeId) => this.openPlace(placeId),
      }
    );
  }

  private showAllMapLogs(): void {
    const logs = this.plugin.index
      .getLogs()
      .sort((a, b) =>
        (b.visitedStart ?? b.date ?? "").localeCompare(a.visitedStart ?? a.date ?? "")
      );
    showMapLogPanel(
      this.mode === "map" && this.map ? this.mapEl : this.overviewEl,
      "地图日志",
      {
        logs,
        places: this.plugin.index.getPlaces(),
        onOpenLog: (logId) => this.openLog(logId),
        onNewLog: (placeId) => this.openNewLog(placeId),
        onNewTrip: () => this.plugin.openNewTrip(),
        onOpenPlace: (placeId) => this.openPlace(placeId),
      }
    );
  }

  private openLog(logId: string): void {
    const log = this.plugin.index.getLog(logId);
    if (!log) return;
    const file = this.plugin.repo.getFile(log.filePath);
    if (file) void this.plugin.repo.openFile(file);
  }

  private openNewLog(placeId?: string): void {
    if (placeId) {
      new JournalModal(this.plugin, placeId).open();
      return;
    }
    pickPlaceForJournal(this.plugin);
  }

  private openPlace(placeId: string): void {
    new PlaceDetailModal(this.plugin, placeId).open();
  }

  private clearSearch(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.queryInput.value = "";
    this.cityInput.value = "";
    this.suggestionsEl.empty();
    this.resultsEl.empty();
    this.results = [];
    this.lastCount = "";
    this.lastQuery = "";
    this.suggestionToken += 1;
    this.searchToken += 1;
  }

  private handleAmapError(error: unknown): void {
    const kind = error instanceof AmapError ? error.kind : "server";
    const message = this.describeAmapError(error);
    const actions: Array<{ label: string; onClick: () => void; cta?: boolean }> = [];
    if (kind === "key") {
      actions.push({ label: "打开设置", cta: true, onClick: () => this.openPluginSettings() });
    } else if (kind === "quota") {
      actions.push({
        label: "重置会话计数",
        cta: true,
        onClick: () => {
          this.plugin.amap.resetSessionCount();
          this.clearBanner();
          this.updateFooter();
        },
      });
    } else if (kind === "network" || kind === "offline") {
      actions.push({
        label: "重试",
        cta: true,
        onClick: () => {
          this.clearBanner();
          void this.runSearch();
        },
      });
    }
    const bannerKind: BannerKind =
      kind === "quota" || kind === "offline" ? "warning" : kind === "key" ? "error" : "error";
    this.showBanner(bannerKind, message, actions);
    new Notice(message, 6000);
  }

  private describeAmapError(error: unknown): string {
    if (error instanceof AmapError) return error.message;
    if (error instanceof Error) return error.message;
    return "搜索失败，请检查网络和 Key 配置。";
  }

  private showBanner(
    kind: BannerKind,
    message: string,
    actions: Array<{ label: string; onClick: () => void; cta?: boolean }> = []
  ): void {
    if (!this.bannerEl) return;
    this.clearBanner();
    createBanner(this.bannerEl, kind, message, actions);
  }

  private clearBanner(): void {
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.bannerEl?.empty();
  }

  private openPluginSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;
    setting?.open?.();
    setting?.openTabById?.("travel-map");
  }
}
