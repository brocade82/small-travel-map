import { Modal, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import { normalizeDate, todayIso } from "../../core/dates";
import { formatRegionPath } from "../../core/regions";
import { createButton, errorText } from "../dom";
import { MediaPickerModal } from "./media-modal";

export class JournalModal extends Modal {
  private readonly plugin: TravelMapPlugin;
  private readonly placeId: string;
  private saving = false;

  private titleInput!: HTMLInputElement;
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private tripSelect!: HTMLSelectElement;
  private tagsInput!: HTMLInputElement;
  private pinnedInput!: HTMLInputElement;
  private coverInput!: HTMLInputElement;
  private bodyInput!: HTMLTextAreaElement;

  constructor(plugin: TravelMapPlugin, placeId: string) {
    super(plugin.app);
    this.plugin = plugin;
    this.placeId = placeId;
  }

  onOpen(): void {
    const place = this.plugin.index.getPlace(this.placeId);
    if (!place) {
      new Notice("地点不存在，无法新建日志。");
      this.close();
      return;
    }
    this.modalEl.addClass("travel-modal");
    this.titleEl.setText(`新建旅行日志 · ${place.name}`);
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text: formatRegionPath(place.province, place.city, place.district) || "行政区未知",
    });

    const form = this.contentEl.createDiv({ cls: "travel-form" });
    this.titleInput = this.textField(form, "标题（可选）", "留空则使用地点名作为文件名");
    const dates = form.createDiv({ cls: "travel-form__row" });
    this.startInput = this.dateField(dates, "开始日期", todayIso());
    this.endInput = this.dateField(dates, "结束日期", todayIso());

    const tripRow = this.field(form, "行程（可选）");
    this.tripSelect = tripRow.createEl("select", { cls: "travel-input" });
    this.tripSelect.createEl("option", { text: "（不关联行程）", value: "" });
    for (const trip of this.plugin.trips.list()) {
      this.tripSelect.createEl("option", {
        text: trip.title,
        value: trip.id,
      });
    }

    this.tagsInput = this.textField(form, "标签", "用逗号分隔，例如：日落, 徒步");
    this.coverInput = this.textField(
      form,
      "封面（可选）",
      "Vault 相对路径，或库外绝对路径例如 D:\\TravelMedia\\杭州\\西湖\\01.jpg"
    );
    const coverActions = this.coverInput.parentElement?.createDiv({
      cls: "travel-form__row",
    });
    if (coverActions) {
      createButton(
        coverActions,
        "从媒体库选择…",
        () => {
          void this.pickCover();
        },
        { icon: "image" }
      );
    }

    const pinnedRow = form.createDiv({ cls: "travel-form__checkbox-row" });
    this.pinnedInput = pinnedRow.createEl("input", { type: "checkbox" });
    this.pinnedInput.id = "travel-map-pinned";
    pinnedRow.createEl("label", { text: "在时间线中置顶", attr: { for: "travel-map-pinned" } });

    const bodyField = this.field(form, "正文", "照片用 ![[照片.jpg]] 嵌入；库外视频用「插入库外视频链接」命令生成。");
    this.bodyInput = bodyField.createEl("textarea", {
      cls: "travel-input travel-textarea",
      attr: {
        rows: "12",
        placeholder: `## ${place.name}\n\n写下这次旅行的见闻…`,
      },
    });
    this.bodyInput.value = `## ${place.name}\n\n`;

    const actions = this.contentEl.createDiv({ cls: "travel-modal__actions" });
    createButton(actions, "创建日志", () => {
      void this.save(place.id);
    }, { cta: true, icon: "check" });
    createButton(actions, "取消", () => this.close());

    this.contentEl.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void this.save(place.id);
      }
    });
    window.setTimeout(() => this.titleInput.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private field(parent: HTMLElement, label: string, hint?: string): HTMLElement {
    const wrapper = parent.createDiv({ cls: "travel-form__field" });
    wrapper.createDiv({ cls: "travel-form__label", text: label });
    if (hint) wrapper.createDiv({ cls: "travel-form__hint", text: hint });
    return wrapper;
  }

  private textField(
    parent: HTMLElement,
    label: string,
    placeholder: string
  ): HTMLInputElement {
    const wrapper = this.field(parent, label);
    return wrapper.createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder },
    });
  }

  private dateField(
    parent: HTMLElement,
    label: string,
    value: string
  ): HTMLInputElement {
    const wrapper = this.field(parent, label);
    const input = wrapper.createEl("input", { type: "date", cls: "travel-input" });
    input.value = value;
    return input;
  }

  private async pickCover(): Promise<void> {
    try {
      const photos = (await this.plugin.media.scanMedia()).filter(
        (entry) => entry.kind === "photo"
      );
      if (photos.length === 0) {
        new Notice(`媒体根目录里没有照片：${this.plugin.settings.mediaRoot}`);
        return;
      }
      new MediaPickerModal(this.plugin, photos, (entry) => {
        this.coverInput.value = entry.absolutePath;
      }).open();
    } catch (error) {
      new Notice(`扫描媒体失败：${errorText(error)}`);
    }
  }

  private async save(placeId: string): Promise<void> {
    if (this.saving) return;
    const start = normalizeDate(this.startInput.value) ?? todayIso();
    const end = normalizeDate(this.endInput.value) ?? start;
    if (end < start) {
      new Notice("结束日期不能早于开始日期");
      return;
    }
    this.saving = true;
    try {
      const tags = this.tagsInput.value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const log = await this.plugin.journals.create(placeId, {
        title: this.titleInput.value,
        visitedStart: start,
        visitedEnd: end,
        tripId: this.tripSelect.value || undefined,
        tags,
        pinned: this.pinnedInput.checked,
        cover: this.coverInput.value.trim() || undefined,
        body: this.bodyInput.value,
      });
      new Notice(`已创建旅行日志：${log.title}`);
      this.close();
      const file = this.plugin.repo.getFile(log.filePath);
      if (file) await this.plugin.repo.openFile(file);
      this.plugin.refreshOpenViews();
    } catch (error) {
      new Notice(`创建日志失败：${errorText(error)}`);
    } finally {
      this.saving = false;
    }
  }
}
