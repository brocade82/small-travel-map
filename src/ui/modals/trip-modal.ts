import { Modal, Notice } from "obsidian";
import type TravelMapPlugin from "../../main";
import { normalizeDate, todayIso } from "../../core/dates";
import { createButton, errorText } from "../dom";

export class TripModal extends Modal {
  private readonly plugin: TravelMapPlugin;
  private saving = false;

  private titleInput!: HTMLInputElement;
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private citiesInput!: HTMLInputElement;
  private tagsInput!: HTMLInputElement;
  private summaryInput!: HTMLTextAreaElement;

  constructor(plugin: TravelMapPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass("travel-modal");
    this.titleEl.setText("新建行程");
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "travel-modal__subtitle",
      text: "行程是一份可选的旅行计划/回顾，日志可以关联到它。",
    });

    const form = this.contentEl.createDiv({ cls: "travel-form" });
    this.titleInput = this.field(form, "标题").createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder: "例如：2026 杭州" },
    });
    const dates = form.createDiv({ cls: "travel-form__row" });
    this.startInput = this.dateField(dates, "开始");
    this.endInput = this.dateField(dates, "结束");
    this.citiesInput = this.field(form, "城市").createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder: "用逗号分隔，例如：杭州市" },
    });
    this.tagsInput = this.field(form, "标签").createEl("input", {
      type: "text",
      cls: "travel-input",
      attr: { placeholder: "例如：亲子, 自驾" },
    });
    this.summaryInput = this.field(form, "行程摘要").createEl("textarea", {
      cls: "travel-input travel-textarea",
      attr: {
        placeholder: "这次旅行的整体摘要，会显示在时间线的行程节点上",
        rows: "3",
      },
    });

    const actions = this.contentEl.createDiv({ cls: "travel-modal__actions" });
    createButton(actions, "创建行程", () => {
      void this.save();
    }, { cta: true, icon: "check" });
    createButton(actions, "取消", () => this.close());
    window.setTimeout(() => this.titleInput.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private field(parent: HTMLElement, label: string): HTMLElement {
    const wrapper = parent.createDiv({ cls: "travel-form__field" });
    wrapper.createDiv({ cls: "travel-form__label", text: label });
    return wrapper;
  }

  private dateField(parent: HTMLElement, label: string): HTMLInputElement {
    const wrapper = this.field(parent, label);
    const input = wrapper.createEl("input", { type: "date", cls: "travel-input" });
    input.value = todayIso();
    return input;
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const title = this.titleInput.value.trim();
    if (!title) {
      new Notice("请填写行程标题");
      return;
    }
    const start = normalizeDate(this.startInput.value) ?? undefined;
    const end = normalizeDate(this.endInput.value) ?? start;
    if (start && end && end < start) {
      new Notice("结束日期不能早于开始日期");
      return;
    }
    this.saving = true;
    try {
      const trip = await this.plugin.trips.create({
        title,
        start,
        end,
        cities: this.citiesInput.value
          .split(/[,，]/)
          .map((city) => city.trim())
          .filter(Boolean),
        tags: this.tagsInput.value
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        summary: this.summaryInput.value,
      });
      new Notice(`已创建行程：${trip.title}`);
      this.close();
      const file = this.plugin.repo.getFile(trip.filePath);
      if (file) await this.plugin.repo.openFile(file);
      this.plugin.refreshOpenViews();
    } catch (error) {
      new Notice(`创建行程失败：${errorText(error)}`);
    } finally {
      this.saving = false;
    }
  }
}
