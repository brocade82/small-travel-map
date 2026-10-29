import {
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  type TravelMapSettings,
} from "./types";
import { sanitizeSettings } from "./core/settings";
import { TravelIndex } from "./services/indexer";
import { VaultRepository } from "./services/vault-repo";
import { PlaceService } from "./services/place-service";
import { JournalService } from "./services/journal-service";
import { TripService } from "./services/trip-service";
import { VisitedService } from "./services/visited-service";
import { AmapWebService } from "./services/amap-web";
import { ImportService } from "./services/import-service";
import { SelfCheckService } from "./services/self-check";
import { MediaManifestService } from "./services/media-manifest";
import {
  absoluteFileUrl,
  resolveVideoHref,
} from "./core/media";
import { TravelMapView, TRAVEL_MAP_VIEW_TYPE } from "./views/map-view";
import { TravelTimelineView, TRAVEL_TIMELINE_VIEW_TYPE } from "./views/timeline-view";
import { TravelMapSettingTab } from "./ui/settings-tab";
import { PlaceDetailModal } from "./ui/modals/place-modal";
import { JournalModal } from "./ui/modals/journal-modal";
import { TripModal } from "./ui/modals/trip-modal";
import { MediaPickerModal, VideoPickerModal } from "./ui/modals/media-modal";
import { ImportExternalModal, ImportFolderModal } from "./ui/modals/import-modal";
import { SelfCheckModal } from "./ui/modals/self-check-modal";
import { pickPlaceForJournal } from "./ui/modals/place-picker";
import { errorText } from "./ui/dom";

export default class TravelMapPlugin extends Plugin {
  settings: TravelMapSettings = { ...DEFAULT_SETTINGS };

  index!: TravelIndex;
  repo!: VaultRepository;
  places!: PlaceService;
  journals!: JournalService;
  trips!: TripService;
  visited!: VisitedService;
  amap!: AmapWebService;
  importer!: ImportService;
  selfCheck!: SelfCheckService;
  media!: MediaManifestService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.repo = new VaultRepository(this.app, () => this.settings);
    this.index = new TravelIndex(this.app, () => this.settings);
    this.places = new PlaceService(this.index, this.repo);
    this.journals = new JournalService(this.index, this.repo);
    this.trips = new TripService(this.index, this.repo);
    this.visited = new VisitedService(this.index);
    this.amap = new AmapWebService(
      () => this.settings,
      this.app.vault.getName(),
      () => this.refreshOpenViews(),
      () => this.vaultBasePath()
    );
    this.importer = new ImportService(this.app, () => this.settings, this.index, this.repo);
    this.selfCheck = new SelfCheckService(() => this.settings, this.index, this.repo);
    this.media = new MediaManifestService(() => this.settings, this.index, this.repo);

    this.registerView(TRAVEL_MAP_VIEW_TYPE, (leaf) => new TravelMapView(leaf, this));
    this.registerView(
      TRAVEL_TIMELINE_VIEW_TYPE,
      (leaf) => new TravelTimelineView(leaf, this)
    );

    this.addRibbonIcon("map", "打开旅游地图", () => {
      void this.openMap("overview");
    });
    this.addRibbonIcon("calendar-days", "打开旅行时间线", () => {
      void this.openTimeline();
    });

    this.addSettingTab(new TravelMapSettingTab(this.app, this));
    this.registerCommands();
    this.registerMarkdownPostProcessor((element) => this.renderLocalMedia(element));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => this.addFileMenu(menu, file))
    );

    void this.index.init().catch((error) => {
      console.error("[travel-map] 建立索引失败", error);
      new Notice(`旅游索引建立失败：${errorText(error)}`);
    });
  }

  onunload(): void {
    this.index?.dispose();
  }

  /** Used to reject key files placed inside the vault. */
  private vaultBasePath(): string | null {
    try {
      const adapter = this.app.vault.adapter as unknown as {
        getBasePath?: () => string;
      };
      return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
    } catch {
      return null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshOpenViews();
  }

  async reindex(): Promise<{ places: number; logs: number; trips: number; legacy: number }> {
    await this.index.rebuild();
    this.refreshOpenViews();
    return this.index.getCounts();
  }

  refreshOpenViews(): void {
    for (const type of [TRAVEL_MAP_VIEW_TYPE, TRAVEL_TIMELINE_VIEW_TYPE]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const view = leaf.view as unknown as { refresh?: () => void };
        try {
          view.refresh?.();
        } catch (error) {
          console.debug("[travel-map] 刷新视图失败", type, error);
        }
      }
    }
  }

  async openMap(mode: "map" | "overview" = "overview"): Promise<TravelMapView | null> {
    const existing = this.app.workspace.getLeavesOfType(TRAVEL_MAP_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: TRAVEL_MAP_VIEW_TYPE,
      active: true,
      state: { mode },
    });
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view instanceof TravelMapView ? leaf.view : null;
    // A brand-new ItemView calls getState() after onOpen(), which can overwrite
    // the state passed to setViewState; set the mode explicitly.
    view?.setMode(mode);
    return view;
  }

  async openTimeline(): Promise<TravelTimelineView | null> {
    const existing = this.app.workspace.getLeavesOfType(TRAVEL_TIMELINE_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: TRAVEL_TIMELINE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof TravelTimelineView ? leaf.view : null;
  }

  openNewTrip(): void {
    new TripModal(this).open();
  }

  openSelfCheck(): void {
    new SelfCheckModal(this).open();
  }

  openImport(): void {
    new ImportFolderModal(this).open();
  }

  openImportExternal(): void {
    new ImportExternalModal(this).open();
  }

  newJournal(): void {
    const active = this.app.workspace.getActiveFile();
    if (active) {
      const place = this.index.getPlaceByPath(active.path);
      if (place) {
        new JournalModal(this, place.id).open();
        return;
      }
    }
    pickPlaceForJournal(this);
  }

  async insertVideoLink(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请先打开一篇 Markdown 笔记，再插入库外视频链接。");
      return;
    }
    try {
      const entries = await this.media.scanVideos();
      if (entries.length === 0) {
        new Notice(`库外媒体目录里没有视频文件：${this.settings.mediaRoot}`);
        return;
      }
      new VideoPickerModal(this, entries).open();
    } catch (error) {
      new Notice(`扫描库外视频失败：${errorText(error)}`);
    }
  }

  async insertMediaLink(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请先打开一篇 Markdown 笔记，再插入库外照片/视频。");
      return;
    }
    try {
      const entries = await this.media.scanMedia();
      if (entries.length === 0) {
        new Notice(`库外媒体目录里没有照片或视频：${this.settings.mediaRoot}`);
        return;
      }
      new MediaPickerModal(this, entries).open();
    } catch (error) {
      new Notice(`扫描库外媒体失败：${errorText(error)}`);
    }
  }

  async runMediaManifest(): Promise<void> {
    try {
      const result = await this.media.update();
      const photos = result.entries.filter((entry) => entry.kind === "photo").length;
      const videos = result.entries.length - photos;
      new Notice(
        `媒体清单已更新：${photos} 张照片、${videos} 个视频，缺失引用 ${result.missing.length} 个`
      );
      await this.repo.openFile(result.file, true);
    } catch (error) {
      new Notice(`更新媒体清单失败：${errorText(error)}`);
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-map",
      name: "打开旅游地图",
      callback: () => {
        void this.openMap("overview");
      },
    });
    this.addCommand({
      id: "open-overview",
      name: "打开点亮总览",
      callback: () => {
        void this.openMap("overview");
      },
    });
    this.addCommand({
      id: "open-live-map",
      name: "打开在线地图（按次初始化）",
      callback: () => {
        void this.openMap("map");
      },
    });
    this.addCommand({
      id: "open-timeline",
      name: "打开旅行时间线",
      callback: () => {
        void this.openTimeline();
      },
    });
    this.addCommand({
      id: "search-place",
      name: "搜索并保存地点",
      callback: () => {
        void this.openMap("overview").then((view) => view?.focusSearch());
      },
    });
    this.addCommand({
      id: "new-journal",
      name: "新建旅行日志",
      callback: () => this.newJournal(),
    });
    this.addCommand({
      id: "new-trip",
      name: "新建行程",
      callback: () => this.openNewTrip(),
    });
    this.addCommand({
      id: "insert-video",
      name: "插入库外视频链接（绝对路径）",
      callback: () => {
        void this.insertVideoLink();
      },
    });
    this.addCommand({
      id: "insert-media",
      name: "插入库外照片/视频（绝对路径）",
      callback: () => {
        void this.insertMediaLink();
      },
    });
    this.addCommand({
      id: "rebuild-index",
      name: "重建旅游索引",
      callback: () => {
        void this.reindex().then((counts) => {
          new Notice(
            `索引已重建：${counts.places} 个地点，${counts.logs} 篇日志，${counts.trips} 个行程`
          );
        });
      },
    });
    this.addCommand({
      id: "self-check",
      name: "旅游数据自检",
      callback: () => this.openSelfCheck(),
    });
    this.addCommand({
      id: "import-legacy",
      name: "导入旧笔记…",
      callback: () => this.openImport(),
    });
    this.addCommand({
      id: "import-external",
      name: "导入外部文件夹…",
      callback: () => this.openImportExternal(),
    });
    this.addCommand({
      id: "media-manifest",
      name: "更新库外媒体清单",
      callback: () => {
        void this.runMediaManifest();
      },
    });
    this.addCommand({
      id: "reset-session-quota",
      name: "重置本次会话搜索计数",
      callback: () => {
        this.amap.resetSessionCount();
        new Notice("本次会话搜索计数已重置");
        this.refreshOpenViews();
      },
    });
  }

  private addFileMenu(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    const place = this.index.getPlaceByPath(file.path);
    if (!place) return;
    menu.addItem((item) =>
      item
        .setTitle("打开旅游地点详情")
        .setIcon("map-pin")
        .onClick(() => new PlaceDetailModal(this, place.id).open())
    );
  }

  /**
   * DLink handles file:/// (and absolute local-file://) media by converting the
   * original file to a blob URL. Do not replace those anchors with a native
   * <video src="local-file://...">, because local-file is not a playable
   * browser protocol and would show a black 0:00 player.
   */
  private renderLocalMedia(element: HTMLElement): void {
    const dlinkEnabled = this.isDlinkEnabled();
    const anchors = Array.from(
      element.querySelectorAll<HTMLAnchorElement>(
        'a[href^="local-file://"], a[href^="file:///"]'
      )
    );
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") ?? "";
      const resolved = resolveVideoHref(href, this.settings.mediaRoot);
      if (!resolved) continue;
      const label = anchor.textContent?.trim() || "库外视频";

      if (!dlinkEnabled) {
        const fallback = document.createElement("span");
        fallback.addClass("travel-video-fallback");
        fallback.setText(`${label}（需安装 DLink 等 local-file 协议插件）`);
        fallback.title = resolved.absolute;
        anchor.replaceWith(fallback);
        continue;
      }
      // Normalise root-relative old links so DLink can resolve them too.
      if (href.toLowerCase().startsWith("local-file://")) {
        anchor.setAttribute("href", absoluteFileUrl(resolved.absolute));
      }
    }

    for (const image of Array.from(
      element.querySelectorAll<HTMLImageElement>(
        'img[src^="local-file://"], img[src^="file:///"]'
      )
    )) {
      const href = image.getAttribute("src") ?? "";
      const resolved = resolveVideoHref(href, this.settings.mediaRoot);
      if (!resolved) continue;
      if (!dlinkEnabled) {
        const fallback = document.createElement("span");
        fallback.addClass("travel-video-fallback");
        fallback.setText(
          `${image.getAttribute("alt") || "库外照片"}（需安装 DLink 等 local-file 协议插件）`
        );
        fallback.title = resolved.absolute;
        image.replaceWith(fallback);
        continue;
      }
      if (href.toLowerCase().startsWith("local-file://")) {
        image.src = absoluteFileUrl(resolved.absolute);
      }
      image.loading = "lazy";
    }

    this.decorateLocalVideos(element);
  }

  /**
   * DLink replaces file:/// anchors with a native <video>. Wrap that player in
   * a stable frame so portrait clips do not fill the whole note width.
   * The observer also catches DLink's async replacement.
   */
  private decorateLocalVideos(element: HTMLElement): void {
    const decorate = (): number => {
      let wrapped = 0;
      for (const video of Array.from(element.querySelectorAll<HTMLVideoElement>("video"))) {
        if (video.closest(".travel-video-embed")) continue;
        const parent = video.parentElement;
        if (!parent) continue;
        const figure = document.createElement("figure");
        figure.addClass("travel-video-embed");
        const caption = document.createElement("figcaption");
        caption.setText("原始视频 · DLink 播放");
        parent.insertBefore(figure, video);
        figure.appendChild(video);
        figure.appendChild(caption);
        wrapped += 1;
      }
      return wrapped;
    };

    if (decorate() > 0) return;
    const observer = new MutationObserver(() => {
      if (decorate() > 0) observer.disconnect();
    });
    observer.observe(element, { childList: true, subtree: true });
    window.setTimeout(() => {
      decorate();
      observer.disconnect();
    }, 1500);
  }

  private isDlinkEnabled(): boolean {
    try {
      const plugins = (this.app as unknown as {
        plugins?: {
          enabledPlugins?: Set<string>;
          getPlugin?: (id: string) => unknown;
        };
      }).plugins;
      if (!plugins) return false;
      return Boolean(plugins.enabledPlugins?.has("dlink") || plugins.getPlugin?.("dlink"));
    } catch {
      return false;
    }
  }
}
