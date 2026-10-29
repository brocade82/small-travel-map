import { Modal, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import type { PlaceRecord } from "../../types";
import { formatRegionPath } from "../../core/regions";
import { errorText, createButton } from "../dom";
import { JournalModal } from "./journal-modal";

export class PlaceDetailModal extends Modal {
  private readonly plugin: TravelMapPlugin;
  private readonly placeId: string;

  constructor(plugin: TravelMapPlugin, placeId: string) {
    super(plugin.app);
    this.plugin = plugin;
    this.placeId = placeId;
  }

  onOpen(): void {
    this.modalEl.addClass("travel-modal");
    this.display();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private display(): void {
    const place = this.plugin.index.getPlace(this.placeId);
    const { contentEl } = this;
    contentEl.empty();
    if (!place) {
      this.titleEl.setText("地点不存在");
      contentEl.createDiv({
        cls: "travel-warning",
        text: "索引中没有这个地点，可能文件已被删除。运行「重建旅游索引」后再试。",
      });
      return;
    }

    this.titleEl.setText(place.name);
    const region = formatRegionPath(place.province, place.city, place.district);
    contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text: [region || "行政区未知", place.visited ? "已点亮" : "愿望清单"].join(" · "),
    });

    const meta = contentEl.createDiv({ cls: "travel-meta-grid" });
    this.metaRow(meta, "adcode", place.adcode ?? "—");
    this.metaRow(
      meta,
      "坐标",
      typeof place.lat === "number" && typeof place.lng === "number"
        ? `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}（GCJ-02）`
        : "—"
    );
    this.metaRow(meta, "高德 POI", place.amapPoiId ?? "—");
    this.metaRow(meta, "地点 ID", place.id);
    this.metaRow(meta, "创建", place.created ?? "—");
    this.metaRow(meta, "文件", place.filePath);

    const actions = contentEl.createDiv({ cls: "travel-modal__actions" });
    createButton(actions, "新建旅行日志", () => {
      this.close();
      new JournalModal(this.plugin, place.id).open();
    }, { cta: true, icon: "pen-line" });
    createButton(actions, "打开档案", () => {
      const file = this.plugin.repo.getFile(place.filePath);
      if (file) void this.plugin.repo.openFile(file);
      this.close();
    }, { icon: "file-text" });
    createButton(
      actions,
      place.visited ? "取消点亮" : "标记去过",
      () => {
        void this.toggleVisited(place);
      },
      { icon: place.visited ? "map-pin-off" : "map-pin" }
    );

    const journals = this.plugin.journals.logsForPlace(place.id);
    const section = contentEl.createDiv({ cls: "travel-modal__section" });
    section.createDiv({
      cls: "travel-modal__section-title",
      text: `旅行日志（${journals.length}）`,
    });
    if (journals.length === 0) {
      section.createDiv({
        cls: "travel-empty__hint",
        text: "还没有日志。新建一篇，记录照片、文字和库外视频链接。",
      });
    } else {
      const list = section.createDiv({ cls: "travel-journal-list" });
      for (const log of journals) {
        const row = list.createDiv({ cls: "travel-journal-row" });
        row.createDiv({
          cls: "travel-journal-row__date",
          text: log.visitedStart ?? log.date ?? "未写日期",
        });
        const main = row.createDiv({ cls: "travel-journal-row__main" });
        const title = main.createEl("button", {
          cls: "travel-journal-row__title",
          text: log.title,
        });
        title.type = "button";
        title.addEventListener("click", () => {
          const file = this.plugin.repo.getFile(log.filePath);
          if (file) void this.plugin.repo.openFile(file);
          this.close();
        });
        if (log.pinned) main.createSpan({ cls: "travel-badge", text: "置顶" });
      }
    }
  }

  private async toggleVisited(place: PlaceRecord): Promise<void> {
    try {
      await this.plugin.places.setVisited(place.id, !place.visited);
      new Notice(place.visited ? "已取消点亮" : "已标记为去过");
      this.display();
      this.plugin.refreshOpenViews();
    } catch (error) {
      new Notice(`操作失败：${errorText(error)}`);
    }
  }

  private metaRow(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "travel-meta-row" });
    row.createDiv({ cls: "travel-meta-row__label", text: label });
    row.createDiv({ cls: "travel-meta-row__value", text: value });
  }
}
