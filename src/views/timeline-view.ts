import { ItemView, Notice, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import fs from "node:fs";
import type TravelMapPlugin from "../main";
import type { TripRecord } from "../types";
import type { TimelineItem } from "../core/timeline";
import { decorateTimelineItem, filterTimeline, sortTimeline, timelineCities, timelineTags } from "../core/timeline";
import { excerptFromMarkdown } from "../core/text";
import { resolveMediaField } from "../core/media";
import { createButton, createEmptyState, errorText } from "../ui/dom";
import { pickPlaceForJournal } from "../ui/modals/place-picker";

export const TRAVEL_TIMELINE_VIEW_TYPE = "travel-timeline-view";

interface ExcerptCache {
  mtime: number;
  excerpt: string;
}

interface TimelineTripGroup {
  trip: TripRecord;
  summary: string;
  logs: TimelineItem[];
}

export class TravelTimelineView extends ItemView {
  private readonly plugin: TravelMapPlugin;
  private built = false;
  private entries: TimelineItem[] = [];
  private tripGroups: TimelineTripGroup[] = [];
  private filter = { query: "", city: "", tag: "", pinnedOnly: false };
  private viewMode: "axis" | "board" = "axis";
  private excerptCache = new Map<string, ExcerptCache>();
  private tripSummaryCache = new Map<string, ExcerptCache>();
  private refreshSeq = 0;
  private offIndex: (() => void) | null = null;
  private coverUrls = new Set<string>();

  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private citySelect!: HTMLSelectElement;
  private tagSelect!: HTMLSelectElement;
  private pinnedInput!: HTMLInputElement;
  private emptySlot!: HTMLElement;
  private viewToggle!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: TravelMapPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRAVEL_TIMELINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "旅行时间线";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("travel-timeline-view");
    await this.plugin.index.whenReady();
    this.renderShell();
    this.offIndex = this.plugin.index.onChange(() => {
      void this.refresh();
    });
    await this.refresh();
  }

  onClose(): Promise<void> {
    this.offIndex?.();
    this.offIndex = null;
    this.clearCoverUrls();
    this.contentEl.empty();
    return Promise.resolve();
  }

  async refresh(): Promise<void> {
    if (!this.built) return;
    const seq = ++this.refreshSeq;
    const entries = await this.loadEntries();
    const tripGroups = await this.loadTripGroups(entries);
    if (seq !== this.refreshSeq) return;
    this.entries = entries;
    this.tripGroups = tripGroups;
    this.syncFilterOptions();
    this.renderList();
  }

  getState(): Record<string, unknown> {
    return { filter: { ...this.filter }, viewMode: this.viewMode };
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    const filter = (state?.filter ?? {}) as Partial<typeof this.filter>;
    this.filter = {
      query: typeof filter.query === "string" ? filter.query : "",
      city: typeof filter.city === "string" ? filter.city : "",
      tag: typeof filter.tag === "string" ? filter.tag : "",
      pinnedOnly: filter.pinnedOnly === true,
    };
    if (state?.viewMode === "axis" || state?.viewMode === "board") {
      this.viewMode = state.viewMode;
    }
    if (this.built) {
      this.applyFilterToControls();
      this.renderList();
    }
    await super.setState(state, result);
  }

  private renderShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "travel-timeline__header" });
    const heading = header.createDiv({ cls: "travel-timeline__heading" });
    const icon = heading.createSpan({ cls: "travel-timeline__icon" });
    setIcon(icon, "calendar-days");
    heading.createEl("h2", { text: "旅行时间线" });
    this.countEl = heading.createSpan({ cls: "travel-timeline__count", text: "0 篇" });

    const actions = header.createDiv({ cls: "travel-timeline__actions" });
    createButton(actions, "新建日志", () => pickPlaceForJournal(this.plugin), {
      cta: true,
      icon: "pen-line",
    });
    createButton(actions, "打开地图", () => this.plugin.openMap("overview"), { icon: "map" });
    this.viewToggle = createButton(
      actions,
      this.viewMode === "axis" ? "看板视图" : "时间轴",
      () => {
        this.viewMode = this.viewMode === "axis" ? "board" : "axis";
        this.syncViewToggle();
        this.renderList();
        this.leaf.setViewState({ type: TRAVEL_TIMELINE_VIEW_TYPE, state: this.getState() });
      },
      { icon: this.viewMode === "axis" ? "layout-grid" : "git-branch" }
    );

    const filters = contentEl.createDiv({ cls: "travel-timeline__filters" });
    this.searchInput = filters.createEl("input", {
      type: "search",
      cls: "travel-input travel-input--search",
      attr: { placeholder: "搜索标题、地点、标签…" },
    });
    this.citySelect = filters.createEl("select", { cls: "travel-input travel-select" });
    this.tagSelect = filters.createEl("select", { cls: "travel-input travel-select" });
    const pinnedLabel = filters.createEl("label", { cls: "travel-timeline__pinned" });
    this.pinnedInput = pinnedLabel.createEl("input", { type: "checkbox" });
    pinnedLabel.createSpan({ text: "只看置顶" });
    createButton(filters, "重置", () => {
      this.filter = { query: "", city: "", tag: "", pinnedOnly: false };
      this.applyFilterToControls();
      this.renderList();
    });

    this.searchInput.value = this.filter.query;
    this.searchInput.addEventListener("input", () => {
      this.filter.query = this.searchInput.value;
      this.renderList();
    });
    this.citySelect.addEventListener("change", () => {
      this.filter.city = this.citySelect.value;
      this.renderList();
    });
    this.tagSelect.addEventListener("change", () => {
      this.filter.tag = this.tagSelect.value;
      this.renderList();
    });
    this.pinnedInput.addEventListener("change", () => {
      this.filter.pinnedOnly = this.pinnedInput.checked;
      this.renderList();
    });

    this.emptySlot = contentEl.createDiv({ cls: "travel-timeline__empty" });
    this.listEl = contentEl.createDiv({ cls: "travel-timeline__list" });
    this.built = true;
    this.applyFilterToControls();
  }

  private applyFilterToControls(): void {
    if (!this.built) return;
    this.searchInput.value = this.filter.query;
    this.pinnedInput.checked = this.filter.pinnedOnly;
    if (Array.from(this.citySelect.options).some((option) => option.value === this.filter.city)) {
      this.citySelect.value = this.filter.city;
    }
    if (Array.from(this.tagSelect.options).some((option) => option.value === this.filter.tag)) {
      this.tagSelect.value = this.filter.tag;
    }
    this.syncViewToggle();
  }

  private syncViewToggle(): void {
    if (!this.viewToggle) return;
    this.viewToggle.setText(this.viewMode === "axis" ? "看板视图" : "时间轴");
  }

  private async loadEntries(): Promise<TimelineItem[]> {
    const items: TimelineItem[] = [];
    for (const log of this.plugin.index.getLogs()) {
      const place = this.plugin.index.getPlace(log.placeId);
      const file = this.plugin.repo.getFile(log.filePath);
      let excerpt = "";
      if (file) {
        const cached = this.excerptCache.get(log.filePath);
        if (cached && cached.mtime === file.stat.mtime) {
          excerpt = cached.excerpt;
        } else {
          try {
            const body = await this.plugin.repo.readBody(file);
            excerpt = excerptFromMarkdown(body);
            this.excerptCache.set(log.filePath, { mtime: file.stat.mtime, excerpt });
          } catch {
            excerpt = "";
          }
        }
      }
      items.push(
        decorateTimelineItem({
          id: log.id,
          filePath: log.filePath,
          title: log.title,
          placeId: log.placeId,
          placeName: place?.name ?? "未关联地点",
          adcode: place?.adcode,
          tags: log.tags,
          visitedStart: log.visitedStart,
          visitedEnd: log.visitedEnd,
          date: log.date,
          pinned: log.pinned,
          cover: log.cover,
          excerpt,
          mtime: log.mtime,
        })
      );
    }
    return sortTimeline(items);
  }

  private async loadTripGroups(entries: TimelineItem[]): Promise<TimelineTripGroup[]> {
    const logsByTrip = new Map<string, TimelineItem[]>();
    for (const item of entries) {
      const log = this.plugin.index.getLog(item.id);
      if (!log) continue;
      const trip = this.plugin.journals.tripOf(log);
      if (!trip) continue;
      const bucket = logsByTrip.get(trip.id) ?? [];
      bucket.push(item);
      logsByTrip.set(trip.id, bucket);
    }

    const groups: TimelineTripGroup[] = [];
    for (const trip of this.plugin.index.getTrips()) {
      const file = this.plugin.repo.getFile(trip.filePath);
      let summary = "";
      if (file) {
        const cached = this.tripSummaryCache.get(trip.filePath);
        if (cached && cached.mtime === file.stat.mtime) {
          summary = cached.excerpt;
        } else {
          try {
            const body = await this.plugin.repo.readBody(file);
            summary = excerptFromMarkdown(body, 220);
            this.tripSummaryCache.set(trip.filePath, {
              mtime: file.stat.mtime,
              excerpt: summary,
            });
          } catch {
            summary = "";
          }
        }
      }
      groups.push({
        trip,
        summary,
        logs: logsByTrip.get(trip.id) ?? [],
      });
    }
    return groups;
  }

  private syncFilterOptions(): void {
    const cities = new Set(timelineCities(this.entries));
    const tags = new Set(timelineTags(this.entries));
    for (const group of this.tripGroups) {
      for (const city of group.trip.cities) cities.add(city);
      for (const tag of group.trip.tags) tags.add(tag);
    }
    const cityOptions = ["", ...Array.from(cities).sort((a, b) => a.localeCompare(b, "zh"))];
    this.fillSelect(
      this.citySelect,
      cityOptions,
      this.filter.city,
      "全部城市",
      "城市"
    );
    const tagOptions = ["", ...Array.from(tags).sort((a, b) => a.localeCompare(b, "zh"))];
    this.fillSelect(this.tagSelect, tagOptions, this.filter.tag, "全部标签", "标签");
  }

  private fillSelect(
    select: HTMLSelectElement,
    values: string[],
    selected: string,
    allLabel: string,
    prefix: string
  ): void {
    select.empty();
    for (const value of values) {
      const option = select.createEl("option", {
        text: value || allLabel,
        value,
      });
      if (value === selected) option.selected = true;
    }
    select.setAttribute("aria-label", prefix);
  }

  private renderList(): void {
    this.clearCoverUrls();
    this.listEl.empty();
    this.emptySlot.empty();
    const filtered = filterTimeline(this.entries, this.filter);
    this.listEl.toggleClass("travel-timeline__list--axis", this.viewMode === "axis");
    if (this.viewMode === "axis") {
      this.renderTripAxis(filtered);
      return;
    }

    this.countEl.setText(`${filtered.length} / ${this.entries.length} 篇`);
    if (this.entries.length === 0) {
      const empty = createEmptyState(
        this.emptySlot,
        "calendar-days",
        "还没有旅行日志",
        "先保存一个地点，再为它写第一篇日志。日志可以只放照片和感想。"
      );
      createButton(empty, "新建日志", () => pickPlaceForJournal(this.plugin), {
        cta: true,
      });
      return;
    }
    if (filtered.length === 0) {
      createEmptyState(
        this.emptySlot,
        "filter",
        "没有匹配的日志",
        "换个城市、标签或搜索词试试。"
      );
      return;
    }

    for (const item of filtered) {
      this.renderCard(item, this.listEl);
    }
  }

  private hasActiveFilter(): boolean {
    return Boolean(
      this.filter.query.trim() ||
        this.filter.city ||
        this.filter.tag ||
        this.filter.pinnedOnly
    );
  }

  private tripMatchesFilter(group: TimelineTripGroup): boolean {
    const query = this.filter.query.trim().toLowerCase();
    const trip = group.trip;
    if (this.filter.city && !trip.cities.includes(this.filter.city)) {
      if (!group.logs.some((log) => log.city === this.filter.city)) return false;
    }
    if (this.filter.tag && !trip.tags.includes(this.filter.tag)) {
      if (!group.logs.some((log) => log.tags.includes(this.filter.tag))) return false;
    }
    if (this.filter.pinnedOnly && !group.logs.some((log) => log.pinned)) return false;
    if (query) {
      const haystack = [
        trip.title,
        group.summary,
        trip.cities.join(" "),
        trip.tags.join(" "),
        ...group.logs.flatMap((log) => [log.title, log.placeName, ...log.tags]),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  private tripMonthLabel(group: TimelineTripGroup): string {
    const date =
      group.trip.start ??
      group.trip.end ??
      group.logs[0]?.visitedStart ??
      group.logs[0]?.date ??
      "";
    return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "未定日期";
  }

  private renderTripAxis(filteredLogs: TimelineItem[]): void {
    const filteredIds = new Set(filteredLogs.map((item) => item.id));
    const active = this.hasActiveFilter();
    let visibleGroups: TimelineTripGroup[] = [];
    if (active) {
      for (const group of this.tripGroups) {
        const children = group.logs.filter((item) => filteredIds.has(item.id));
        if (!this.tripMatchesFilter(group) && children.length === 0) continue;
        visibleGroups.push({
          ...group,
          logs: children.length > 0 ? children : group.logs,
        });
      }
    } else {
      visibleGroups = [...this.tripGroups];
    }

    const assigned = new Set(
      this.tripGroups.flatMap((group) => group.logs.map((item) => item.id))
    );
    const orphans = filteredLogs.filter((item) => !assigned.has(item.id));
    if (active && visibleGroups.length === 0 && orphans.length === 0) {
      createEmptyState(
        this.emptySlot,
        "filter",
        "没有匹配的行程或日志",
        "换个城市、标签或搜索词试试。"
      );
      return;
    }
    if (!active && visibleGroups.length === 0 && this.entries.length === 0) {
      const empty = createEmptyState(
        this.emptySlot,
        "calendar-days",
        "还没有行程或日志",
        "先建一个行程写整体摘要，再把每天/每个地点的日志挂到行程上。"
      );
      createButton(empty, "新建行程", () => this.plugin.openNewTrip(), {
        cta: true,
      });
      createButton(empty, "新建日志", () => pickPlaceForJournal(this.plugin), {
        icon: "pen-line",
      });
      return;
    }

    const visibleLogCount =
      visibleGroups.reduce((sum, group) => sum + group.logs.length, 0) + orphans.length;
    this.countEl.setText(`${visibleGroups.length} 个行程 · ${visibleLogCount} 篇日志`);

    const axis = this.listEl.createDiv({ cls: "travel-axis travel-tree" });
    const groupsByMonth = new Map<string, TimelineTripGroup[]>();
    for (const group of visibleGroups) {
      const key = this.tripMonthLabel(group);
      const bucket = groupsByMonth.get(key) ?? [];
      bucket.push(group);
      groupsByMonth.set(key, bucket);
    }

    const addMonth = (label: string, groups: TimelineTripGroup[]) => {
      if (groups.length === 0) return;
      const month = axis.createDiv({ cls: "travel-axis__group travel-tree__month" });
      month.createDiv({ cls: "travel-axis__marker" });
      month.createDiv({ cls: "travel-axis__label", text: label });
      const cards = month.createDiv({ cls: "travel-axis__cards" });
      for (const group of groups) this.renderTripNode(cards, group);
    };

    for (const [key, groups] of groupsByMonth) {
      if (key === "未定日期") continue;
      const [year, month] = key.split("-");
      addMonth(`${year} 年 ${month} 月`, groups);
    }
    addMonth("未定日期", groupsByMonth.get("未定日期") ?? []);

    if (orphans.length > 0) {
      const month = axis.createDiv({ cls: "travel-axis__group travel-tree__month" });
      month.createDiv({ cls: "travel-axis__marker" });
      month.createDiv({ cls: "travel-axis__label", text: "未归入行程" });
      const cards = month.createDiv({ cls: "travel-axis__cards" });
      const node = cards.createDiv({ cls: "travel-trip-node travel-trip-node--orphan" });
      const head = node.createDiv({ cls: "travel-trip-node__head" });
      const main = head.createDiv({ cls: "travel-trip-node__main" });
      main.createDiv({ cls: "travel-trip-node__title", text: "未归入行程的日志" });
      main.createDiv({
        cls: "travel-trip-node__summary",
        text: `${orphans.length} 篇日志还没有关联行程；可以先写日志，之后再补行程。`,
      });
      const children = node.createDiv({ cls: "travel-trip-node__children is-collapsed" });
      for (const item of orphans) {
        const child = children.createDiv({ cls: "travel-tree__child" });
        this.renderCard(item, child, false);
      }
      this.wireTripToggle(node, head, children);
    }
  }

  private wireTripToggle(
    node: HTMLElement,
    head: HTMLElement,
    children: HTMLElement
  ): void {
    let expanded = false;
    const setExpanded = (next: boolean) => {
      expanded = next;
      children.toggleClass("is-collapsed", !expanded);
      node.toggleClass("is-expanded", expanded);
      const toggle = head.querySelector<HTMLElement>(".travel-trip-node__toggle");
      if (toggle) {
        toggle.empty();
        setIcon(toggle, expanded ? "chevron-down" : "chevron-right");
      }
    };
    const toggle = head.createEl("button", {
      cls: "travel-trip-node__toggle",
      attr: { type: "button", "aria-label": "展开或收起日志" },
    });
    setIcon(toggle, "chevron-right");
    toggle.addEventListener("click", () => setExpanded(!expanded));
    head.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      setExpanded(!expanded);
    });
  }

  private renderTripNode(parent: HTMLElement, group: TimelineTripGroup): void {
    const node = parent.createDiv({ cls: "travel-trip-node" });
    const head = node.createDiv({ cls: "travel-trip-node__head" });
    const main = head.createDiv({ cls: "travel-trip-node__main" });
    const titleRow = main.createDiv({ cls: "travel-trip-node__title-row" });
    const title = titleRow.createEl("button", {
      cls: "travel-trip-node__title",
      text: group.trip.title,
      attr: { type: "button" },
    });
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      const file = this.plugin.repo.getFile(group.trip.filePath);
      if (file) void this.plugin.repo.openFile(file);
    });
    const count = titleRow.createSpan({
      cls: "travel-trip-node__count",
      text: `${group.logs.length} 篇`,
    });
    const range = [group.trip.start, group.trip.end]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" – ");
    if (range) {
      main.createDiv({ cls: "travel-trip-node__range", text: range });
    }
    main.createDiv({
      cls: "travel-trip-node__summary",
      text: group.summary || "还没有填写行程摘要，可在行程笔记正文补充。",
    });
    const meta = [group.trip.cities.join(" · "), group.trip.tags.join(" · ")]
      .filter(Boolean)
      .join("  |  ");
    if (meta) main.createDiv({ cls: "travel-trip-node__meta", text: meta });

    const open = head.createEl("button", {
      cls: "travel-trip-node__open",
      text: "打开行程",
      attr: { type: "button" },
    });
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      const file = this.plugin.repo.getFile(group.trip.filePath);
      if (file) void this.plugin.repo.openFile(file);
    });

    const children = node.createDiv({ cls: "travel-trip-node__children is-collapsed" });
    if (group.logs.length === 0) {
      children.createDiv({
        cls: "travel-empty__hint",
        text: "还没有关联日志。写日志时选择这个行程即可。",
      });
    } else {
      for (const item of group.logs) {
        const child = children.createDiv({ cls: "travel-tree__child" });
        this.renderCard(item, child, false);
      }
    }
    this.wireTripToggle(node, head, children);
  }

  private async loadExternalCover(
    image: HTMLImageElement,
    cover: HTMLElement,
    absolutePath: string
  ): Promise<void> {
    try {
      const bytes = await fs.promises.readFile(absolutePath);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "image/jpeg" })
      );
      this.coverUrls.add(url);
      image.src = url;
    } catch {
      cover.remove();
    }
  }

  private clearCoverUrls(): void {
    for (const url of this.coverUrls) URL.revokeObjectURL(url);
    this.coverUrls.clear();
  }

  private renderCard(
    item: TimelineItem,
    parent: HTMLElement = this.listEl,
    showCover = true
  ): void {
    const card = parent.createDiv({ cls: "travel-card" });
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      void this.openLog(item);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.openLog(item);
      }
    });

    if (showCover && item.cover) {
      const externalCover = resolveMediaField(
        item.cover,
        this.plugin.settings.mediaRoot
      );
      const coverPath = externalCover
        ? null
        : this.plugin.repo.getFile(item.cover)?.path ??
          this.plugin.repo.getFile(`${this.plugin.repo.baseFolder()}/${item.cover}`)?.path;
      if (externalCover || coverPath) {
        const cover = card.createDiv({ cls: "travel-card__cover" });
        const image = cover.createEl("img", {
          attr: {
            alt: item.title,
            loading: "lazy",
            ...(externalCover
              ? {}
              : { src: this.plugin.repo.resourcePath(coverPath as string) }),
          },
        });
        if (externalCover) {
          void this.loadExternalCover(image, cover, externalCover);
        } else {
          image.addEventListener("error", () => cover.remove());
        }
      }
    }

    const body = card.createDiv({ cls: "travel-card__body" });
    const meta = body.createDiv({ cls: "travel-card__meta" });
    const dateText = item.visitedStart ?? item.date ?? "未写日期";
    meta.createSpan({ cls: "travel-card__date", text: dateText });
    if (item.city) meta.createSpan({ cls: "travel-card__city", text: item.city });
    if (item.pinned) meta.createSpan({ cls: "travel-badge", text: "置顶" });

    body.createEl("h3", { cls: "travel-card__title", text: item.title });
    body.createDiv({
      cls: "travel-card__place",
      text: `地点：${item.placeName}`,
    });
    if (item.excerpt) {
      body.createDiv({ cls: "travel-card__excerpt", text: item.excerpt });
    }
    if (item.tags.length > 0) {
      const tags = body.createDiv({ cls: "travel-card__tags" });
      for (const tag of item.tags.slice(0, 6)) {
        tags.createSpan({ cls: "travel-chip travel-chip--small", text: tag });
      }
    }

    const pin = card.createEl("button", {
      cls: "travel-card__pin",
      attr: {
        "aria-label": item.pinned ? "取消置顶" : "置顶",
        title: item.pinned ? "取消置顶" : "置顶",
      },
    });
    pin.type = "button";
    setIcon(pin, item.pinned ? "pin-off" : "pin");
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.togglePin(item);
    });
  }

  private async openLog(item: TimelineItem): Promise<void> {
    const file = this.plugin.repo.getFile(item.filePath);
    if (!file) {
      new Notice("日志文件不存在，运行「重建旅游索引」后再试。");
      return;
    }
    await this.plugin.repo.openFile(file);
  }

  private async togglePin(item: TimelineItem): Promise<void> {
    try {
      const pinned = await this.plugin.journals.togglePinned(item.id);
      new Notice(pinned ? "已置顶" : "已取消置顶");
    } catch (error) {
      new Notice(`操作失败：${errorText(error)}`);
    }
  }
}
